import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { D1AdminMasterService, type PasswordResetRequester } from "./service";
import { createWorkerId } from "../worker-crypto";
import { createPasswordResetDeliveryChannel } from "../auth";

type Bound = { bind(...values: unknown[]): Bound; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> };
const d1For = (database: Database, beforeBatch?: () => void) => {
  let pending = Promise.resolve();
  return {
  prepare(query: string) { const create = (values: unknown[]): Bound => { const statement = database.query(query) as unknown as { get(...v: unknown[]): unknown; all(...v: unknown[]): unknown; run(...v: unknown[]): { changes: number } }; return { bind: (...next) => create(next), first: async <T>() => statement.get(...values) as T | null, all: async <T>() => ({ results: statement.all(...values) as T[] }), run: async () => ({ meta: { changes: statement.run(...values).changes } }) }; }; return create([]); },
  async batch(statements: Bound[]) {
    let release: (() => void) | undefined;
    const previous = pending;
    pending = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    beforeBatch?.();
    database.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; } catch (error) { database.exec("ROLLBACK"); throw error; } finally { release?.(); }
  },
  } as unknown as D1Database;
};

const setup = (beforeBatch?: () => void, requestPasswordReset?: PasswordResetRequester) => {
  const database = new Database(":memory:"); database.exec(`
    CREATE TABLE user (id text primary key, name text not null, email text not null unique, role text not null, status text not null, must_change_password integer not null, created_at integer, updated_at integer);
    CREATE TABLE account (id text primary key, account_id text not null, provider_id text not null, user_id text not null, password text, created_at integer, updated_at integer);
    CREATE TABLE session (id text primary key, user_id text not null);
    CREATE TABLE academic_years (year integer primary key, is_current integer not null, selected_by_user_id text, selected_at integer, created_at integer, updated_at integer);
    CREATE UNIQUE INDEX current_year ON academic_years(is_current) WHERE is_current=1;
    CREATE TABLE courses (id text primary key, name text not null);
    CREATE TABLE students (id text primary key, student_number text not null unique, name text not null, name_kana text not null, birth_date text not null, gender text not null, email text, phone text, postal_code text, address text, course_id text not null, enrollment_year integer not null, status text not null, status_effective_academic_year integer, status_changed_at integer, status_changed_by_user_id text, created_at integer, updated_at integer);
    CREATE TABLE student_status_history (id text primary key, student_id text not null, status text not null, effective_academic_year integer not null, changed_at integer, changed_by_user_id text, reason text);
    CREATE TABLE subjects (id text primary key, academic_year integer not null, name text not null, grade_level integer not null, teacher_user_id text not null, created_at integer, updated_at integer, unique(academic_year,name,grade_level));
    CREATE TABLE subject_courses (subject_id text, course_id text, primary key(subject_id,course_id));
    CREATE TABLE subject_term_statuses (subject_id text, term integer, is_finalized integer not null, created_at integer, updated_at integer, primary key(subject_id,term));
    CREATE TABLE audit_logs (id text primary key, actor_user_id text, action text, entity_type text, entity_id text, academic_year integer, payload_json text);
    INSERT INTO user VALUES ('admin','職員','admin@example.test','admin','active',0,0,0),('teacher','講師','teacher@example.test','teacher','active',0,0,0);
    INSERT INTO academic_years VALUES (2026,1,'admin',0,0,0); INSERT INTO courses VALUES ('course-1','IT');
  `);
  let sequence = 0; return { database, service: new D1AdminMasterService(d1For(database, beforeBatch), () => `id-${++sequence}`, async (value) => `hash:${value}`, () => "Temp!Password99", undefined, requestPasswordReset) };
};

describe("D1 admin master service", () => {
  it("initializes the empty admin year list from the injected Japan school-year clock", async () => {
    const database = new Database(":memory:");
    database.exec("CREATE TABLE academic_years (year integer primary key, is_current integer not null, selected_at integer); CREATE UNIQUE INDEX current_year ON academic_years(is_current) WHERE is_current=1;");
    const service = new D1AdminMasterService(d1For(database), () => "id", async () => "hash", () => "password", () => new Date("2026-03-31T15:00:00.000Z"));

    expect(await service.years()).toEqual({ years: [{ year: 2026, isCurrent: true, selectedAt: null }] });
  });

  it("keeps the Web Crypto receiver when generating default IDs", () => {
    let receiver: unknown = null;
    const webCrypto = { randomUUID() { receiver = this; return "worker-id"; } };

    expect(createWorkerId(webCrypto)).toBe("worker-id");
    expect(receiver).toBe(webCrypto);
  });

  it("changes the single current year idempotently and appends one audit for a new selection", async () => {
    const { database, service } = setup();
    await service.selectCurrentYear("admin", 2027);
    expect(database.query("SELECT year FROM academic_years WHERE is_current=1").get()).toEqual({ year: 2027 });
    expect(await service.selectCurrentYear("admin", 2027)).toMatchObject({ alreadySelected: true });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='academic_year_selected'").get()).toEqual({ count: 1 });
    expect(database.query("SELECT academic_year FROM audit_logs WHERE action='academic_year_selected'").get()).toEqual({ academic_year: 2027 });
  });

  it("rejects an unregistered enrollment year before a student write", async () => {
    const { database, service } = setup();
    await expect(service.createStudent("admin", { studentNumber: "2023-1", name: "学生", nameKana: "ガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2023 })).rejects.toMatchObject({ code: "ACADEMIC_YEAR_NOT_FOUND", status: 404 });
    expect(database.query("SELECT count(*) AS count FROM students").get()).toEqual({ count: 0 });
  });

  it("keeps student status history and audit in the same D1 batch", async () => {
    const { database, service } = setup(); const created = await service.createStudent("admin", { studentNumber: "100", name: "同名", nameKana: "ドウメイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 });
    await service.changeStudentStatus("admin", created.id, "suspended", 2026, "休学届");
    expect(database.query("SELECT status FROM students WHERE id=?").get(created.id)).toEqual({ status: "suspended" });
    expect(database.query("SELECT reason FROM student_status_history WHERE student_id=?").get(created.id)).toEqual({ reason: "休学届" });
    await expect(service.createStudent("admin", { studentNumber: "100", name: "別人", nameKana: "ベツジン", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 })).rejects.toMatchObject({ code: "DUPLICATE_STUDENT_NUMBER" });
  });

  it("accepts status changes only for the server-resolved current academic year without historical mutations", async () => {
    const { database, service } = setup();
    const student = await service.createStudent("admin", { studentNumber: "status-year", name: "学生", nameKana: "ガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 });
    for (const requestedYear of [2025, 2027]) {
      await expect(service.changeStudentStatus("admin", student.id, "suspended", requestedYear, "履歴を変えない")).rejects.toMatchObject({ code: "STATUS_EFFECTIVE_YEAR_NOT_CURRENT", status: 409 });
      expect(database.query("SELECT status, status_effective_academic_year FROM students WHERE id=?").get(student.id)).toEqual({ status: "enrolled", status_effective_academic_year: null });
      expect(database.query("SELECT count(*) AS count FROM student_status_history WHERE student_id=?").get(student.id)).toEqual({ count: 0 });
      expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='student_status_changed' AND entity_id=?").get(student.id)).toEqual({ count: 0 });
    }
    await expect(service.changeStudentStatus("admin", student.id, "suspended", 2026, "現在年度の休学")).resolves.toEqual({ id: student.id, status: "suspended" });
    expect(database.query("SELECT status, status_effective_academic_year FROM students WHERE id=?").get(student.id)).toEqual({ status: "suspended", status_effective_academic_year: 2026 });
    expect(database.query("SELECT count(*) AS count FROM student_status_history WHERE student_id=?").get(student.id)).toEqual({ count: 1 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='student_status_changed' AND entity_id=?").get(student.id)).toEqual({ count: 1 });
  });

  it("does not write a status change when the current academic year changes before its batch", async () => {
    let switchYearBeforeBatch = false;
    let database!: Database;
    const setupResult = setup(() => {
      if (!switchYearBeforeBatch) return;
      switchYearBeforeBatch = false;
      database.exec("UPDATE academic_years SET is_current=0 WHERE year=2026; INSERT INTO academic_years VALUES (2027,1,'admin',0,0,0)");
    });
    database = setupResult.database;
    const student = await setupResult.service.createStudent("admin", { studentNumber: "status-race", name: "学生", nameKana: "ガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 });
    switchYearBeforeBatch = true;

    await expect(setupResult.service.changeStudentStatus("admin", student.id, "suspended", 2026, "年度切替競合")).rejects.toMatchObject({ code: "STATUS_EFFECTIVE_YEAR_NOT_CURRENT", status: 409 });
    expect(database.query("SELECT status, status_effective_academic_year FROM students WHERE id=?").get(student.id)).toEqual({ status: "enrolled", status_effective_academic_year: null });
    expect(database.query("SELECT count(*) AS count FROM student_status_history WHERE student_id=?").get(student.id)).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='student_status_changed' AND entity_id=?").get(student.id)).toEqual({ count: 0 });
  });

  it("calculates and filters student grades using the requested academic year", async () => {
    const { database, service } = setup();
    await service.selectCurrentYear("admin", 2027);
    await service.createStudent("admin", { studentNumber: "2026-1", name: "進級学生", nameKana: "シンキュウガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 });

    await expect(service.students({ page: 1, pageSize: 20 })).resolves.toMatchObject({ currentAcademicYear: 2027, academicYear: 2027, items: [{ gradeLevel: 2 }] });
    await expect(service.students({ page: 1, pageSize: 20, academicYear: 2026, gradeLevel: 1 })).resolves.toMatchObject({ currentAcademicYear: 2027, academicYear: 2026, total: 1, items: [{ gradeLevel: 1 }] });
    await expect(service.students({ page: 1, pageSize: 20, academicYear: 2026, gradeLevel: 2 })).resolves.toMatchObject({ academicYear: 2026, total: 0, items: [] });
    expect(database.query("SELECT count(*) AS count FROM students").get()).toEqual({ count: 1 });
  });

  it("returns a bounded, historical student status snapshot for the requested academic year", async () => {
    const { database, service } = setup();
    await service.selectCurrentYear("admin", 2027);
    database.exec("INSERT INTO academic_years VALUES (2024,0,NULL,0,0,0), (2025,0,NULL,0,0,0), (2028,0,NULL,0,0,0)");
    const create = (studentNumber: string, enrollmentYear: number) => service.createStudent("admin", { studentNumber, name: studentNumber, nameKana: "ガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear });
    const secondYear = await create("2026", 2026);
    const futureStatus = await create("2026-future-status", 2026);
    const future = await create("2028-future", 2028);
    const outsideThreeYears = await create("2024-outside", 2024);
    await create("2025-third", 2025);
    const withdrawn = await create("2025-withdrawn", 2025);
    const restored = await create("2025-restored", 2025);
    database.query("INSERT INTO student_status_history VALUES (?, ?, ?, ?, ?, ?, ?)").run("withdrawn-2026", withdrawn.id, "withdrawn", 2026, 10, "admin", "退学");
    database.query("INSERT INTO student_status_history VALUES (?, ?, ?, ?, ?, ?, ?)").run("restored-2025", restored.id, "suspended", 2025, 10, "admin", "休学");
    database.query("INSERT INTO student_status_history VALUES (?, ?, ?, ?, ?, ?, ?)").run("restored-2026", restored.id, "enrolled", 2026, 20, "admin", "復学");
    database.query("UPDATE students SET status='suspended', status_effective_academic_year=2028 WHERE id=?").run(futureStatus.id);

    const current = await service.students({ page: 1, pageSize: 20 });
    expect(current).toMatchObject({ academicYear: 2027, total: 4 });
    expect(current.items.find((student) => student.id === secondYear.id)).toMatchObject({ gradeLevel: 2 });
    expect(current.items.find((student) => student.id === futureStatus.id)).toMatchObject({ status: "enrolled", statusEffectiveAcademicYear: null });
    expect(current.items.find((student) => student.id === future.id || student.id === outsideThreeYears.id || student.id === withdrawn.id)).toBeUndefined();
    const inWithdrawalYear = await service.students({ page: 1, pageSize: 20, academicYear: 2026 });
    expect(inWithdrawalYear.items.find((student) => student.id === withdrawn.id)).toMatchObject({ status: "withdrawn", statusEffectiveAcademicYear: 2026, gradeLevel: 2 });
    const beforeRestore = await service.students({ page: 1, pageSize: 20, academicYear: 2025, status: "suspended" });
    expect(beforeRestore).toMatchObject({ total: 1, items: [{ id: restored.id, status: "suspended", statusEffectiveAcademicYear: 2025, gradeLevel: 1 }] });
    const afterRestore = await service.students({ page: 1, pageSize: 20, academicYear: 2026, status: "enrolled" });
    expect(afterRestore.items.find((student) => student.id === restored.id)).toMatchObject({ status: "enrolled", statusEffectiveAcademicYear: 2026 });
    await expect(service.students({ page: 1, pageSize: 20, academicYear: 2027, gradeLevel: 4 as never })).rejects.toMatchObject({ code: "INVALID_GRADE_LEVEL" });
  });

  it("creates a Better Auth credential teacher and subject courses atomically", async () => {
    const { database, service } = setup(); const teacher = await service.createTeacher("admin", { name: "新講師", email: "new@example.test" });
    expect(teacher.temporaryPassword).toBe("Temp!Password99"); expect(database.query("SELECT password FROM account WHERE user_id=?").get(teacher.id)).toEqual({ password: "hash:Temp!Password99" });
    const subject = await service.createSubject("admin", { name: "基礎", gradeLevel: 1, teacherUserId: teacher.id, courseIds: ["course-1"] });
    expect(database.query("SELECT count(*) AS count FROM subject_courses WHERE subject_id=?").get(subject.id)).toEqual({ count: 1 });
    expect(database.query("SELECT count(*) AS count FROM subject_term_statuses WHERE subject_id=?").get(subject.id)).toEqual({ count: 2 });
  });

  it("lists each subject course once when term statuses are also joined", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO courses VALUES ('course-2','デザイン')");
    const teacher = await service.createTeacher("admin", { name: "新講師", email: "subject-list@example.test" });
    await service.createSubject("admin", { name: "共通科目", gradeLevel: 1, teacherUserId: teacher.id, courseIds: ["course-1", "course-2"] });
    expect((await service.subjects()).items.find((item) => item.name === "共通科目")?.courseIds.sort()).toEqual(["course-1", "course-2"]);
  });

  it("does not append audits when an update target does not exist", async () => {
    const { database, service } = setup();
    const student = { studentNumber: "404", name: "不在", nameKana: "フザイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 };
    await expect(service.updateStudent("admin", "missing", student)).rejects.toMatchObject({ code: "STUDENT_NOT_FOUND" });
    await expect(service.changeStudentStatus("admin", "missing", "suspended", 2026, "理由")).rejects.toMatchObject({ code: "STUDENT_NOT_FOUND" });
    await expect(service.changeTeacherStatus("admin", "missing", "leave")).rejects.toMatchObject({ code: "TEACHER_NOT_FOUND" });
    expect(database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });

  it("writes explicit academic years for year-scoped audit actions only", async () => {
    const { database, service } = setup();
    const student = await service.createStudent("admin", { studentNumber: "2026-1", name: "学生", nameKana: "ガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 });
    await service.updateStudent("admin", student.id, { studentNumber: "2026-1", name: "学生更新", nameKana: "ガクセイコウシン", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 });
    await service.changeStudentStatus("admin", student.id, "suspended", 2026, "理由");
    const teacher = await service.createTeacher("admin", { name: "講師", email: "audit-teacher@example.test" });
    await service.createSubject("admin", { name: "監査科目", gradeLevel: 1, teacherUserId: teacher.id, courseIds: ["course-1"] });
    await service.changeTeacherStatus("admin", teacher.id, "leave");
    expect(database.query("SELECT action, academic_year FROM audit_logs ORDER BY rowid").all()).toEqual([
      { action: "student_created", academic_year: 2026 }, { action: "student_updated", academic_year: 2026 }, { action: "student_status_changed", academic_year: 2026 },
      { action: "teacher_created", academic_year: null }, { action: "subject_created", academic_year: 2026 }, { action: "teacher_status_changed", academic_year: null },
    ]);
  });

  it("enforces the 30-person teacher cap in the write statement and does not audit an overflow", async () => {
    const { database, service } = setup();
    for (let index = 0; index < 28; index += 1) database.query("INSERT INTO user VALUES (?, ?, ?, 'teacher', 'active', 0, 0, 0)").run(`teacher-cap-${index}`, `講師${index}`, `teacher-cap-${index}@example.test`);

    await service.createTeacher("admin", { name: "30人目", email: "teacher-30@example.test" });
    expect(database.query("SELECT count(*) AS count FROM user WHERE role='teacher' AND status!='retired'").get()).toEqual({ count: 30 });
    await expect(service.createTeacher("admin", { name: "上限超過", email: "teacher-over@example.test" })).rejects.toMatchObject({ code: "ACCOUNT_CAP_REACHED" });
    expect(database.query("SELECT count(*) AS count FROM user WHERE email='teacher-over@example.test'").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='teacher_created'").get()).toEqual({ count: 1 });
  });

  it("allows a retired teacher replacement but rejects a cap-breaking reactivation without an audit", async () => {
    const { database, service } = setup();
    for (let index = 0; index < 28; index += 1) database.query("INSERT INTO user VALUES (?, ?, ?, 'teacher', 'active', 0, 0, 0)").run(`teacher-replace-${index}`, `講師${index}`, `teacher-replace-${index}@example.test`);
    database.query("INSERT INTO user VALUES ('teacher-retired', '退職講師', 'retired@example.test', 'teacher', 'retired', 0, 0, 0)").run();

    await service.createTeacher("admin", { name: "後任講師", email: "replacement@example.test" });
    await expect(service.changeTeacherStatus("admin", "teacher-retired", "active")).rejects.toMatchObject({ code: "ACCOUNT_CAP_REACHED" });
    expect(database.query("SELECT status FROM user WHERE id='teacher-retired'").get()).toEqual({ status: "retired" });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='teacher_status_changed'").get()).toEqual({ count: 0 });
  });

  it("creates at most three non-retired dedicated staff with a Better Auth credential", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO user VALUES ('staff-1','職員1','staff-1@example.test','admin','leave',0,0,0),('staff-2','職員2','staff-2@example.test','admin','active',0,0,0)");

    await expect(service.createStaff("admin", { name: "上限超過職員", email: "staff-over@example.test" })).rejects.toMatchObject({ code: "ACCOUNT_CAP_REACHED" });
    database.query("UPDATE user SET status='retired' WHERE id='staff-2'").run();
    const staff = await service.createStaff("admin", { name: "新任職員", email: "new-staff@example.test" });
    expect(staff.temporaryPassword).toBe("Temp!Password99");
    expect(database.query("SELECT role, must_change_password FROM user WHERE id=?").get(staff.id)).toEqual({ role: "admin", must_change_password: 1 });
    expect(database.query("SELECT password FROM account WHERE user_id=?").get(staff.id)).toEqual({ password: "hash:Temp!Password99" });
    expect(database.query("SELECT payload_json FROM audit_logs WHERE action='staff_created'").get()).toEqual({ payload_json: '{"role":"admin"}' });
  });

  it("rejects self disable and leaving no active dedicated staff", async () => {
    const { database, service } = setup();
    await expect(service.changeStaffStatus("admin", "admin", "leave")).rejects.toMatchObject({ code: "SELF_STATUS_CHANGE_FORBIDDEN" });
    await expect(service.changeStaffStatus("teacher", "admin", "retired")).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
    expect(database.query("SELECT status FROM user WHERE id='admin'").get()).toEqual({ status: "active" });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='staff_status_changed'").get()).toEqual({ count: 0 });
  });

  it("keeps concurrent staff creation at the cap and records exactly one creation", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO user VALUES ('staff-concurrent-1','職員1','staff-concurrent-1@example.test','admin','active',0,0,0)");

    const outcomes = await Promise.allSettled([
      service.createStaff("admin", { name: "同時職員A", email: "staff-concurrent-a@example.test" }),
      service.createStaff("admin", { name: "同時職員B", email: "staff-concurrent-b@example.test" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(database.query("SELECT count(*) AS count FROM user WHERE role='admin' AND status!='retired'").get()).toEqual({ count: 3 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='staff_created'").get()).toEqual({ count: 1 });
  });

  it("checks the target row status at execution time when a teacher is retired between read and update", async () => {
    let database: Database | undefined;
    const fixture = setup(() => {
      database?.query("UPDATE user SET status='retired' WHERE id='teacher'").run();
      for (let index = 0; index < 30; index += 1) database?.query("INSERT INTO user VALUES (?, ?, ?, 'teacher', 'active', 0, 0, 0)").run(`teacher-race-${index}`, `競合講師${index}`, `teacher-race-${index}@example.test`);
    });
    database = fixture.database;

    await expect(fixture.service.changeTeacherStatus("admin", "teacher", "active")).rejects.toMatchObject({ code: "ACCOUNT_CAP_REACHED" });
    expect(database.query("SELECT count(*) AS count FROM user WHERE role='teacher' AND status!='retired'").get()).toEqual({ count: 30 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='teacher_status_changed'").get()).toEqual({ count: 0 });
  });

  it("checks the target row status at execution time when dedicated-staff reactivation races with a full cap", async () => {
    let database: Database | undefined;
    const fixture = setup(() => {
      database?.query("UPDATE user SET status='retired' WHERE id='admin'").run();
      for (let index = 0; index < 3; index += 1) database?.query("INSERT INTO user VALUES (?, ?, ?, 'admin', 'active', 0, 0, 0)").run(`staff-race-${index}`, `競合職員${index}`, `staff-race-${index}@example.test`);
    });
    database = fixture.database;

    await expect(fixture.service.changeStaffStatus("teacher", "admin", "active")).rejects.toMatchObject({ code: "ACCOUNT_CAP_REACHED" });
    expect(database.query("SELECT count(*) AS count FROM user WHERE role='admin' AND status!='retired'").get()).toEqual({ count: 3 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='staff_status_changed'").get()).toEqual({ count: 0 });
  });

  it("uses the server-resolved account email for a password reset and audits no secret data", async () => {
    let received: string | undefined;
    const { database, service } = setup(undefined, async (email) => { received = email; });

    await expect(service.requestAccountPasswordReset("admin", "teacher")).resolves.toEqual({ id: "teacher" });
    expect(received).toBe("teacher@example.test");
    const audit = database.query("SELECT payload_json FROM audit_logs WHERE action='password_reset_requested'").get() as { payload_json: string };
    expect(audit.payload_json).toBe('{"role":"teacher"}');
    expect(audit.payload_json).not.toContain("@");
  });

  it("rejects retired or missing accounts and keeps email delivery failures safe and unaudited", async () => {
    let calls = 0;
    const { database, service } = setup(undefined, async () => { calls += 1; throw new Error("delivery secret"); });
    await expect(service.requestAccountPasswordReset("admin", "teacher")).rejects.toMatchObject({ code: "PASSWORD_RESET_UNAVAILABLE", status: 503 });
    database.query("UPDATE user SET status='retired' WHERE id='teacher'").run();
    await expect(service.requestAccountPasswordReset("admin", "teacher")).rejects.toMatchObject({ code: "ACCOUNT_RETIRED" });
    await expect(service.requestAccountPasswordReset("admin", "missing")).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    expect(calls).toBe(1);
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='password_reset_requested'").get()).toEqual({ count: 0 });
  });

  it("does not audit an admin reset when the Better Auth delivery callback never settles", async () => {
    const channel = createPasswordResetDeliveryChannel(async () => new Promise<void>(() => undefined), undefined, 5);
    const { database, service } = setup(undefined, (email) => channel.requestAndWait(email, async () => {
      await channel.sendResetPassword({ user: { email }, url: "https://example.test/reset" });
    }));
    await expect(service.requestAccountPasswordReset("admin", "teacher")).rejects.toMatchObject({ code: "PASSWORD_RESET_UNAVAILABLE", status: 503 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='password_reset_requested'").get()).toEqual({ count: 0 });
  });
});
