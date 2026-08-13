import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { D1GradeService, GradeDomainError } from "./service";

type Bound = { bind(...values: unknown[]): Bound; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> };

/** SQLite-backed D1 adapter: exercises the exact D1 SQL, not a mocked service. */
const d1For = (database: Database) => {
  // D1 serializes each batch. Keep that property in this real SQLite adapter
  // so concurrent service calls exercise the SQL conditional guard.
  let queued = Promise.resolve();
  return {
  prepare(query: string) {
    const create = (values: unknown[]): Bound => {
        const statement = database.query(query);
        const queryWithUnknownBindings = statement as unknown as {
          get: (...bindings: unknown[]) => unknown;
          all: (...bindings: unknown[]) => unknown;
          run: (...bindings: unknown[]) => { changes: number };
        };
        return {
          bind: (...nextValues) => create(nextValues),
          first: async <T>() => (queryWithUnknownBindings.get(...values) as T | null) ?? null,
          all: async <T>() => ({ results: queryWithUnknownBindings.all(...values) as T[] }),
          run: async () => {
            const result = queryWithUnknownBindings.run(...values);
            return { meta: { changes: result.changes } };
          },
        };
    };
    return create([]);
  },
  async batch(statements: Bound[]) {
    let release: (() => void) | undefined;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = queued; queued = queued.then(() => turn);
    await previous;
    database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      release?.();
    }
  },
  } as unknown as D1Database;
};

const setup = () => {
  const database = new Database(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE user (id text primary key, name text not null, email text not null unique, email_verified integer not null default 0, role text not null default 'teacher', status text not null default 'active', must_change_password integer not null default 0, created_at integer not null default 0, updated_at integer not null default 0);
    CREATE TABLE academic_years (year integer primary key, is_current integer not null);
    CREATE TABLE courses (id text primary key, name text not null);
    CREATE TABLE subjects (id text primary key, academic_year integer not null, name text not null, grade_level integer not null, teacher_user_id text not null, created_at integer not null default 0, updated_at integer not null default 0, unique(id, academic_year));
    CREATE TABLE subject_courses (subject_id text not null, course_id text not null, primary key(subject_id, course_id));
    CREATE TABLE students (id text primary key, student_number text not null, name text not null, course_id text not null, enrollment_year integer not null, status text not null, status_effective_academic_year integer, has_failed_history integer not null default 0, updated_at integer not null default 0);
    CREATE TABLE student_status_history (id text primary key, student_id text not null, status text not null, effective_academic_year integer not null, changed_at integer not null);
    CREATE TABLE grade_weights (id text primary key, subject_id text not null, term integer not null, attendance_weight integer not null, attitude_weight integer not null, assignment_weight integer not null, created_at integer not null default 0, updated_at integer not null default 0, unique(subject_id, term));
    CREATE TABLE subject_term_statuses (subject_id text not null, term integer not null, is_finalized integer not null default 0, finalized_by_user_id text, finalized_at integer, reopened_by_user_id text, reopened_at integer, reopened_reason text, last_transition_id text unique, created_at integer not null default 0, updated_at integer not null default 0, primary key(subject_id,term));
    CREATE TABLE grades (id text primary key, student_id text not null, subject_id text not null, academic_year integer not null, term integer not null, attempt integer not null default 1, attendance_rate integer, attitude integer, assignment integer, final_score_numerator integer, final_score_denominator integer, letter_grade text, entered_by_user_id text, last_updated_by_user_id text, created_at integer not null default 0, updated_at integer not null default 0, unique(student_id,subject_id,term,attempt));
    CREATE TABLE audit_logs (id text primary key, actor_user_id text, action text not null, entity_type text not null, entity_id text not null, academic_year integer, payload_json text, created_at integer not null default 0);
    INSERT INTO academic_years VALUES (2026, 1), (2025, 0), (2024, 0), (2023, 0), (2022, 0);
    INSERT INTO courses VALUES ('course-1', 'コース');
    INSERT INTO user (id,name,email,role) VALUES ('teacher-1','講師','teacher@example.test','teacher'), ('admin-1','職員','admin@example.test','admin');
    INSERT INTO subjects (id,academic_year,name,grade_level,teacher_user_id) VALUES ('subject-1',2026,'科目',1,'teacher-1'), ('subject-old',2023,'過去科目',1,'teacher-1');
    INSERT INTO subject_courses VALUES ('subject-1','course-1'), ('subject-old','course-1');
    INSERT INTO students (id,student_number,name,course_id,enrollment_year,status) VALUES ('student-1','1','学生','course-1',2026,'enrolled'), ('student-old','2','過去学生','course-1',2023,'enrolled');
    INSERT INTO grade_weights (id,subject_id,term,attendance_weight,attitude_weight,assignment_weight) VALUES ('weight-1','subject-1',1,100,0,0);
  `);
  let sequence = 0;
  return { database, service: new D1GradeService(d1For(database), () => `id-${++sequence}`) };
};

describe("D1 grade service integration", () => {
  it("only serves the current input term as editable and keeps both finalized terms readable", async () => {
    const { database, service } = setup();
    await expect(service.teacherGrades("teacher-1", "subject-1", 2)).rejects.toMatchObject({
      code: "TERM_NOT_CURRENTLY_EDITABLE", status: 409, details: { currentTerm: 1 },
    } satisfies Partial<GradeDomainError>);

    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',1,1,'admin-1',1)");
    await expect(service.teacherGrades("teacher-1", "subject-1", 1)).rejects.toMatchObject({
      code: "TERM_NOT_CURRENTLY_EDITABLE", details: { currentTerm: 2 },
    } satisfies Partial<GradeDomainError>);
    expect(await service.teacherGrades("teacher-1", "subject-1", 2)).toMatchObject({ editable: true, isFinalized: false });

    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',2,1,'admin-1',1)");
    expect(await service.teacherGrades("teacher-1", "subject-1", 1)).toMatchObject({ editable: false, isFinalized: true });
    expect(await service.teacherGrades("teacher-1", "subject-1", 2)).toMatchObject({ editable: false, isFinalized: true });
  });

  it("writes before finalization, recalculates after a weight change, and refuses later writes", async () => {
    const { database, service } = setup();
    await service.saveTeacherGrades("teacher-1", "subject-1", 1, [{ studentId: "student-1", attendanceRate: 80, attitude: 10, assignment: 10 }]);
    expect(database.query("SELECT final_score_numerator FROM grades").get()).toEqual({ final_score_numerator: 8000 });
    await service.saveTeacherWeights("teacher-1", "subject-1", 1, { attendanceWeight: 50, attitudeWeight: 25, assignmentWeight: 25 });
    expect(database.query("SELECT final_score_numerator, letter_grade FROM grades").get()).toEqual({ final_score_numerator: 9000, letter_grade: "S" });
    expect((await service.finalize("admin-1", "subject-1", 1)).alreadyFinalized).toBeFalse();
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action = 'subject_term_finalized'").get()).toEqual({ count: 1 });
    await expect(service.saveTeacherGrades("teacher-1", "subject-1", 1, [{ studentId: "student-1", attendanceRate: 70, attitude: 0, assignment: 0 }])).rejects.toMatchObject({ code: "TERM_NOT_EDITABLE" } satisfies Partial<GradeDomainError>);
    expect(database.query("SELECT attendance_rate FROM grades").get()).toEqual({ attendance_rate: 80 });
  });

  it("sets sticky F history only when a term is finalized, not for a teacher draft", async () => {
    const { database, service } = setup();
    await service.saveTeacherGrades("teacher-1", "subject-1", 1, [{ studentId: "student-1", attendanceRate: 50, attitude: 0, assignment: 0 }]);
    const gradeId = String((database.query("SELECT id FROM grades WHERE student_id='student-1'").get() as { id: string }).id);
    expect(database.query("SELECT has_failed_history FROM students WHERE id='student-1'").get()).toEqual({ has_failed_history: 0 });
    expect((await service.teacherGrades("teacher-1", "subject-1", 1)).students[0]?.hasFailedHistory).toBeFalse();
    expect((await service.adminGradeDetail(gradeId)).attempts[0]?.hasFailedHistory).toBeFalse();
    expect((await service.adminGrades({ limit: 20 })).items[0]?.latest.hasFailedHistory).toBeFalse();
    await service.finalize("admin-1", "subject-1", 1);
    expect(database.query("SELECT has_failed_history FROM students WHERE id='student-1'").get()).toEqual({ has_failed_history: 1 });
    expect((await service.adminGradeDetail(gradeId)).attempts[0]?.hasFailedHistory).toBeTrue();
    expect((await service.adminGrades({ limit: 20 })).items[0]?.latest.hasFailedHistory).toBeTrue();
    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',2,1,'admin-1',1)");
    expect((await service.teacherGrades("teacher-1", "subject-1", 1)).students[0]?.hasFailedHistory).toBeTrue();
    const retake = await service.createRetake("admin-1", gradeId, { attendanceRate: 70, attitude: 0, assignment: 0 }, "再試験許可");
    expect((await service.teacherGrades("teacher-1", "subject-1", 1)).students[0]?.hasFailedHistory).toBeTrue();
    expect((await service.adminGradeDetail(retake.id)).attempts[0]?.hasFailedHistory).toBeTrue();
    expect((await service.adminGrades({ limit: 20 })).items[0]?.latest).toMatchObject({ id: retake.id, letterGrade: "B", hasFailedHistory: true });
  });

  it("makes duplicate finalization idempotent without another audit and preserves historical status", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO student_status_history VALUES ('history-1','student-old','suspended',2025,1)");
    const historical = await service.adminSubjects(2023);
    expect(historical.subjects[0]?.completion[1].eligible).toBe(1);
    expect(await service.teacherGrades("teacher-1", "subject-old", 1, 2023)).toMatchObject({ academicYear: 2023, editable: false });
    await service.saveTeacherGrades("teacher-1", "subject-1", 1, [{ studentId: "student-1", attendanceRate: 100, attitude: 10, assignment: 10 }]);
    await service.finalize("admin-1", "subject-1", 1);
    expect((await service.finalize("admin-1", "subject-1", 1)).alreadyFinalized).toBeTrue();
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action = 'subject_term_finalized'").get()).toEqual({ count: 1 });
    expect(database.query("SELECT academic_year FROM audit_logs WHERE action = 'subject_term_finalized'").get()).toEqual({ academic_year: 2026 });
    await service.reopen("admin-1", "subject-1", 1, "訂正が必要です");
    expect(database.query("SELECT academic_year FROM audit_logs WHERE action = 'subject_term_reopened'").get()).toEqual({ academic_year: 2026 });
    await expect(service.teacherSubjects("teacher-1", 2022)).rejects.toMatchObject({ code: "INVALID_ACADEMIC_YEAR" } satisfies Partial<GradeDomainError>);
  });

  it("keeps a failed finalized attempt immutable by creating a passing retake and exposes failed history", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',1,1,'admin-1',1); INSERT INTO grades VALUES ('grade-f','student-1','subject-1',2026,1,1,50,0,0,5000,100,'F','teacher-1','teacher-1',0,0)");
    const retake = await service.createRetake("admin-1", "grade-f", { attendanceRate: 70, attitude: 0, assignment: 0 }, "再試験許可");
    expect(retake).toMatchObject({ attempt: 2, letterGrade: "B" });
    expect(database.query("SELECT letter_grade FROM grades WHERE id='grade-f'").get()).toEqual({ letter_grade: "F" });
    expect(database.query("SELECT has_failed_history FROM students WHERE id='student-1'").get()).toEqual({ has_failed_history: 1 });
    const detail = await service.adminGradeDetail(retake.id);
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts.every((attempt) => attempt.hasFailedHistory)).toBeTrue();
    expect(database.query("SELECT payload_json FROM audit_logs WHERE action='grade_retake_created'").get()).toEqual({ payload_json: '{"attempt":"next","previousGrade":"F","newGrade":"B"}' });
  });

  it("rejects retakes for a non-F or stale attempt and records no audit", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',1,1,'admin-1',1); INSERT INTO grades VALUES ('grade-pass','student-1','subject-1',2026,1,1,70,0,0,7000,100,'B','teacher-1','teacher-1',0,0)");
    await expect(service.createRetake("admin-1", "grade-pass", { attendanceRate: 80, attitude: 0, assignment: 0 }, "理由")).rejects.toMatchObject({ code: "RETAKE_NOT_AVAILABLE" });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='grade_retake_created'").get()).toEqual({ count: 0 });
  });

  it("allows exactly one of two concurrent retake requests and records one audit", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',1,1,'admin-1',1); INSERT INTO grades VALUES ('grade-f','student-1','subject-1',2026,1,1,50,0,0,5000,100,'F','teacher-1','teacher-1',0,0)");
    const outcomes = await Promise.allSettled([
      service.createRetake("admin-1", "grade-f", { attendanceRate: 70, attitude: 0, assignment: 0 }, "再試験許可"),
      service.createRetake("admin-1", "grade-f", { attendanceRate: 80, attitude: 0, assignment: 0 }, "再試験許可"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "RETAKE_NOT_AVAILABLE", status: 409 });
    expect(database.query("SELECT count(*) AS count FROM grades WHERE student_id='student-1'").get()).toEqual({ count: 2 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='grade_retake_created'").get()).toEqual({ count: 1 });
  });

  it("allows an administrator to correct only the latest attempt and audits no free-text reason", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO grades VALUES ('grade-current','student-1','subject-1',2026,1,1,50,0,0,5000,100,'F','teacher-1','teacher-1',0,0)");
    await expect(service.correctAdminGrade("admin-1", "grade-current", { attendanceRate: 90, attitude: 0, assignment: 0 }, "配慮事項の詳細")).resolves.toMatchObject({ letterGrade: "S" });
    const audit = database.query("SELECT payload_json FROM audit_logs WHERE action='grade_corrected'").get() as { payload_json: string };
    expect(audit.payload_json).not.toContain("配慮事項");
    expect(audit.payload_json).toContain('"previousGrade":"F"');
  });

  it("keeps a finalized correction's F history after a later passing correction", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,finalized_by_user_id,finalized_at) VALUES ('subject-1',1,1,'admin-1',1); INSERT INTO grades VALUES ('grade-current','student-1','subject-1',2026,1,1,70,0,0,7000,100,'B','teacher-1','teacher-1',0,0)");
    await service.correctAdminGrade("admin-1", "grade-current", { attendanceRate: 50, attitude: 0, assignment: 0 }, "確定後の訂正");
    expect(database.query("SELECT has_failed_history FROM students WHERE id='student-1'").get()).toEqual({ has_failed_history: 1 });
    await service.correctAdminGrade("admin-1", "grade-current", { attendanceRate: 80, attitude: 0, assignment: 0 }, "再訂正");
    expect(database.query("SELECT has_failed_history FROM students WHERE id='student-1'").get()).toEqual({ has_failed_history: 1 });
  });
});
