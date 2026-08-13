import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { D1NormalImportService } from "./import-service";
import { parseImport } from "./imports";

type Bound = { bind(...values: unknown[]): Bound; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> };
const adapter = (database: Database, batches: number[]) => {
  let beforeBatch: (() => void) | undefined;
  const binding = {
    prepare(query: string) {
      const build = (values: unknown[]): Bound => {
        const statement = database.query(query) as unknown as { get(...values: unknown[]): unknown; all(...values: unknown[]): unknown; run(...values: unknown[]): { changes: number } };
        return { bind: (...next) => build(next), first: async <T>() => statement.get(...values) as T | null, all: async <T>() => ({ results: statement.all(...values) as T[] }), run: async () => ({ meta: { changes: statement.run(...values).changes } }) };
      };
      return build([]);
    },
    async batch(statements: Bound[]) {
      batches.push(statements.length);
      const hook = beforeBatch; beforeBatch = undefined; hook?.();
      database.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { binding, beforeNextBatch: (hook: () => void) => { beforeBatch = hook; } };
};
const studentCsv = (number = "S-001") => `学籍番号,氏名,氏名（ひらがな）,年齢,生年月日,性別,メールアドレス,電話番号,郵便番号,住所,専攻\r\n${number},学生一郎,がくせいいちろう,21,2004年11月19日,男,student@example.test,090,100-0001,東京都,システムエンジニア\r\n`;
const userCsv = (name = "講師一郎", email = "teacher@example.test") => `氏名,氏名（ひらがな）,年齢,性別,メールアドレス\r\n${name},こうしいちろう,40,男,${email}\r\n`;
const subjectCsv = () => "専攻,科目名,担当講師\r\n共通,基礎情報,講師一郎\r\n";
const input = (kind: "students" | "teachers" | "staff" | "subjects", csv: string, gradeLevel?: 1 | 2 | 3) => ({ academicYear: 2027, kind, csv, ...(gradeLevel ? { gradeLevel } : {}) });
const setup = () => {
  const database = new Database(":memory:"); database.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE user(id text primary key,name text not null,email text not null unique,role text not null check(role in ('teacher','admin')),status text not null check(status in ('active','leave','retired')),must_change_password integer not null,created_at integer not null,updated_at integer not null);
 CREATE TABLE account(id text primary key,account_id text not null,provider_id text not null,user_id text not null references user(id),password text not null,created_at integer not null,updated_at integer not null);
 CREATE TABLE academic_years(year integer primary key,is_current integer not null);
 CREATE TABLE courses(id text primary key,name text not null unique);
 CREATE TABLE students(id text primary key,student_number text not null unique,name text not null,name_kana text not null,birth_date text not null,gender text not null,email text unique,phone text,postal_code text,address text,course_id text not null references courses(id),enrollment_year integer not null references academic_years(year),status text not null,status_changed_at integer not null,status_changed_by_user_id text not null references user(id),created_at integer not null,updated_at integer not null);
 CREATE TABLE student_status_history(id text primary key,student_id text not null references students(id),status text not null,effective_academic_year integer not null references academic_years(year),changed_at integer not null,changed_by_user_id text not null references user(id),reason text not null);
 CREATE TABLE subjects(id text primary key,academic_year integer not null references academic_years(year),name text not null,grade_level integer not null check(grade_level between 1 and 3),teacher_user_id text not null references user(id),created_at integer not null,updated_at integer not null,unique(academic_year,name,grade_level));
 CREATE TABLE subject_courses(subject_id text not null references subjects(id),course_id text not null references courses(id),primary key(subject_id,course_id));
 CREATE TABLE subject_term_statuses(subject_id text not null references subjects(id),term integer not null,is_finalized integer not null,created_at integer not null,updated_at integer not null,primary key(subject_id,term));
 CREATE TABLE grades(id text primary key,subject_id text not null references subjects(id));
 CREATE TABLE idempotency_operations(id text primary key,operation_type text not null,idempotency_key text not null unique,status text not null,academic_year integer references academic_years(year),payload_hash text not null,result_json text,created_by_user_id text not null references user(id),completed_at integer,created_at integer not null,updated_at integer not null);
 CREATE TABLE import_snapshots(id text primary key,owner_user_id text not null references user(id),academic_year integer not null references academic_years(year),payload_json text not null,payload_hash text not null,expires_at integer not null,claim_id text unique,claimed_at integer,created_at integer not null);
 CREATE TABLE audit_logs(id text primary key,actor_user_id text not null references user(id),action text not null,entity_type text not null,entity_id text not null,academic_year integer references academic_years(year),payload_json text not null);
 INSERT INTO user VALUES('admin','職員','admin@example.test','admin','active',0,0,0); INSERT INTO academic_years VALUES(2027,1); INSERT INTO courses VALUES('system-engineer','システムエンジニア'),('web-designer','Webデザイナー');`);
  let id = 0; const batches: number[] = []; const d1 = adapter(database, batches);
  return { database, batches, beforeNextBatch: d1.beforeNextBatch, service: new D1NormalImportService(d1.binding, () => `import-token-${++id}-0123456789`, async (value) => `hash:${value}`, () => "Temp-Password-123") };
};

describe("individual normal CSV imports (SQLite)", () => {
  it("accepts the Drive sample headers and Japanese date for each individual kind", () => {
    expect(parseImport(input("students", studentCsv())).errors).toEqual([]);
    expect(parseImport(input("teachers", userCsv())).errors).toEqual([]);
    expect(parseImport(input("staff", userCsv("職員一郎", "staff@example.test"))).errors).toEqual([]);
    expect(parseImport(input("subjects", subjectCsv(), 1)).errors).toEqual([]);
    expect(() => parseImport(input("subjects", subjectCsv()))).toThrow("対象学年");
    expect(() => parseImport(input("students", studentCsv(), 1))).toThrow("対象学年");
  });
  it("previews and applies only the selected student domain, preserving omitted students", async () => {
    const { database, service } = setup(); database.exec("INSERT INTO students VALUES('old','OLD','既存','きそん','2000-01-01','男','old@example.test','','','','system-engineer',2027,'enrolled',0,'admin',0,0)");
    const preview = await service.preview("admin", input("students", studentCsv())); expect(preview.errors).toEqual([]); expect(database.query("SELECT count(*) AS count FROM students WHERE id!='old'").get()).toEqual({ count: 0 });
    await service.apply("admin", { token: preview.token!, idempotencyKey: "students-one" });
    expect(database.query("SELECT count(*) AS count FROM students").get()).toEqual({ count: 2 }); expect(database.query("SELECT count(*) AS count FROM user WHERE role='teacher'").get()).toEqual({ count: 0 });
  });
  it("creates one teacher credential once and never stores its password in audit or replay", async () => {
    const { database, service } = setup(); const preview = await service.preview("admin", input("teachers", userCsv())); const first = await service.apply("admin", { token: preview.token!, idempotencyKey: "teacher-one" }); expect(first.credentials).toEqual([expect.objectContaining({ role: "teacher", temporaryPassword: "Temp-Password-123" })]); const replay = await service.apply("admin", { token: preview.token!, idempotencyKey: "teacher-one" }); expect(replay).toMatchObject({ replayed: true, credentialsAlreadyIssued: true, credentials: [] }); const stored = JSON.stringify(database.query("SELECT payload_json FROM audit_logs").all()) + JSON.stringify(database.query("SELECT result_json FROM idempotency_operations").all()); expect(stored).not.toContain("Temp-Password-123");
  });
  it("keeps individual preview tokens owner-bound, expiring, and single-consumer", async () => {
    const { database, service } = setup(); const preview = await service.preview("admin", input("teachers", userCsv()));
    await expect(service.apply("other-admin", { token: preview.token!, idempotencyKey: "wrong-owner" })).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_NOT_FOUND", status: 404 });
    const both = await Promise.allSettled([service.apply("admin", { token: preview.token!, idempotencyKey: "claim-one" }), service.apply("admin", { token: preview.token!, idempotencyKey: "claim-two" })]); expect(both.filter((item) => item.status === "fulfilled")).toHaveLength(1); expect(database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 1 });
    const expired = await service.preview("admin", input("students", studentCsv("S-EXPIRED"))); database.exec(`UPDATE import_snapshots SET expires_at=0 WHERE id='${expired.token}'`); await expect(service.apply("admin", { token: expired.token!, idempotencyKey: "expired" })).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_EXPIRED", status: 410 });
  });
  it("imports a selected-grade subject only after an active uniquely named teacher exists", async () => {
    const { database, service } = setup(); database.exec("INSERT INTO user VALUES('teacher','講師一郎','teacher@example.test','teacher','active',0,0,0)"); const preview = await service.preview("admin", input("subjects", subjectCsv(), 2)); expect(preview.errors).toEqual([]); await service.apply("admin", { token: preview.token!, idempotencyKey: "subject-two" }); expect(database.query("SELECT grade_level FROM subjects").get()).toEqual({ grade_level: 2 }); expect(database.query("SELECT count(*) AS count FROM subject_term_statuses").get()).toEqual({ count: 2 });
  });
  it("rejects an existing inactive staff account without creating a confirmation snapshot", async () => {
    const { database, service } = setup();
    database.exec("INSERT INTO user VALUES('leave-staff','休職職員','leave-staff@example.test','admin','leave',0,0,0)");
    const preview = await service.preview("admin", input("staff", userCsv("休職職員", "leave-staff@example.test")));
    expect(preview.token).toBeUndefined();
    expect(preview.errors).toContainEqual(expect.objectContaining({ file: "専任職員CSV", row: 2, field: "メールアドレス" }));
    expect(database.query("SELECT count(*) AS count FROM import_snapshots").get()).toEqual({ count: 0 });
  });
  it("enforces the teacher and staff caps in preview and keeps the batch fixed for 1,000 students", async () => {
    const { database, service, batches } = setup(); for (let index = 0; index < 30; index += 1) database.exec(`INSERT INTO user VALUES('t${index}','T${index}','t${index}@example.test','teacher','active',0,0,0)`); expect((await service.preview("admin", input("teachers", userCsv()))).errors).not.toEqual([]);
    for (let index = 0; index < 2; index += 1) database.exec(`INSERT INTO user VALUES('s${index}','S${index}','s${index}@example.test','admin','active',0,0,0)`); expect((await service.preview("admin", input("staff", userCsv("新任職員", "new-staff@example.test")))).errors).not.toEqual([]);
    const rows = Array.from({ length: 1_000 }, (_, index) => `S-${index},学生${index},がくせい,21,2004年11月19日,男,s${index}@example.test,090,100,東京,システムエンジニア`).join("\r\n"); const many = `学籍番号,氏名,氏名（ひらがな）,年齢,生年月日,性別,メールアドレス,電話番号,郵便番号,住所,専攻\r\n${rows}\r\n`; const second = setup(); const preview = await second.service.preview("admin", input("students", many)); await second.service.apply("admin", { token: preview.token!, idempotencyKey: "many-students" }); expect(second.batches.at(-1)).toBeLessThan(40);
  });
  it("rolls back the whole import when the teacher cap fills after preview", async () => {
    const { database, service, beforeNextBatch } = setup();
    const preview = await service.preview("admin", input("teachers", userCsv("競合講師", "race-teacher@example.test")));
    beforeNextBatch(() => { for (let index = 0; index < 30; index += 1) database.exec(`INSERT INTO user VALUES('race-t${index}','Race ${index}','race-t${index}@example.test','teacher','active',0,0,0)`); });
    await expect(service.apply("admin", { token: preview.token!, idempotencyKey: "race-teacher-cap" })).rejects.toMatchObject({ code: "IMPORT_STATE_CHANGED", status: 409 });
    expect(database.query("SELECT count(*) AS count FROM user WHERE email='race-teacher@example.test'").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM account").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM idempotency_operations").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM import_snapshots").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM user WHERE role='teacher' AND status='active'").get()).toEqual({ count: 30 });
  });
  it("rolls back the whole import when the staff cap fills after preview", async () => {
    const { database, service, beforeNextBatch } = setup();
    const preview = await service.preview("admin", input("staff", userCsv("競合職員", "race-staff@example.test")));
    beforeNextBatch(() => { for (let index = 0; index < 2; index += 1) database.exec(`INSERT INTO user VALUES('race-s${index}','Race ${index}','race-s${index}@example.test','admin','active',0,0,0)`); });
    await expect(service.apply("admin", { token: preview.token!, idempotencyKey: "race-staff-cap" })).rejects.toMatchObject({ code: "IMPORT_STATE_CHANGED", status: 409 });
    expect(database.query("SELECT count(*) AS count FROM user WHERE email='race-staff@example.test'").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM account").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM idempotency_operations").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM import_snapshots").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM user WHERE role='admin' AND status='active'").get()).toEqual({ count: 3 });
  });
  it("rolls back the whole import when a subject becomes locked after preview", async () => {
    const { database, service, beforeNextBatch } = setup();
    database.exec("INSERT INTO user VALUES('teacher','講師一郎','teacher@example.test','teacher','active',0,0,0); INSERT INTO subjects VALUES('subject',2027,'基礎情報',2,'teacher',0,0)");
    const preview = await service.preview("admin", input("subjects", subjectCsv(), 2));
    expect(preview.errors).toEqual([]);
    beforeNextBatch(() => database.exec("INSERT INTO grades VALUES('late-grade','subject')"));
    await expect(service.apply("admin", { token: preview.token!, idempotencyKey: "race-subject-lock" })).rejects.toMatchObject({ code: "IMPORT_STATE_CHANGED", status: 409 });
    expect(database.query("SELECT teacher_user_id FROM subjects WHERE id='subject'").get()).toEqual({ teacher_user_id: "teacher" });
    expect(database.query("SELECT count(*) AS count FROM grades WHERE subject_id='subject'").get()).toEqual({ count: 1 });
    expect(database.query("SELECT count(*) AS count FROM subject_courses").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM account").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM idempotency_operations").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM import_snapshots").get()).toEqual({ count: 0 });
  });
});
