import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { D1RolloverService, parseCsv } from "./rollover";

type Bound = { bind(...values: unknown[]): Bound; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> };
const d1 = (database: Database) => {
  let lastBatchStatementCount = 0;
  let beforeBatch: (() => void) | undefined;
  return {
    database: {
      prepare(query: string) { const build = (values: unknown[]): Bound => { const statement = database.query(query) as unknown as { get(...v: unknown[]): unknown; all(...v: unknown[]): unknown; run(...v: unknown[]): { changes: number } }; return { bind: (...next) => build(next), first: async <T>() => statement.get(...values) as T | null, all: async <T>() => ({ results: statement.all(...values) as T[] }), run: async () => ({ meta: { changes: statement.run(...values).changes } }) }; }; return build([]); },
      async batch(statements: Bound[]) { lastBatchStatementCount = statements.length; const hook = beforeBatch; beforeBatch = undefined; hook?.(); database.exec("BEGIN"); try { const result = []; for (const statement of statements) result.push(await statement.run()); database.exec("COMMIT"); return result; } catch (error) { database.exec("ROLLBACK"); throw error; } },
    } as unknown as D1Database,
    lastBatchStatementCount: () => lastBatchStatementCount,
    setBeforeBatch: (hook: () => void) => { beforeBatch = hook; },
  };
};
const csv = {
  teachers: "氏名,ひらがな,年齢,性別,メールアドレス\r\n山田講師,やまだ,40,男,teacher@example.test\r\n",
  grade1: "専攻,科目名,担当講師\r\n共通,\"基礎,情報\",山田講師\r\n", grade2: "専攻,科目名,担当講師\r\n", grade3: "専攻,科目名,担当講師\r\n",
  students: "学籍番号,氏名,ひらがな,年齢,生年月日,性別,メール,電話,郵便番号,住所,専攻\r\nD27-001,新入生,しんにゅうせい,19,2008-04-01,女,new@example.test,090,100-0001,東京都,システムエンジニア\r\n",
};
const input = (key = "rollover-2027") => ({ targetYear: 2027, idempotencyKey: key, teachersCsv: csv.teachers, grade1SubjectsCsv: csv.grade1, grade2SubjectsCsv: csv.grade2, grade3SubjectsCsv: csv.grade3, newStudentsCsv: csv.students });
const setup = (clock: () => Date = () => new Date()) => { const database = new Database(":memory:"); database.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE user (id text primary key,name text not null,email text not null unique,role text not null,status text not null,must_change_password integer not null,created_at integer,updated_at integer);
  CREATE TABLE academic_years (year integer primary key,is_current integer not null,selected_by_user_id text references user(id),selected_at integer,created_at integer,updated_at integer);
  CREATE TABLE courses (id text primary key); INSERT INTO courses VALUES ('system-engineer'),('web-designer');
  CREATE TABLE students (id text primary key,student_number text unique,name text,name_kana text,birth_date text,gender text,email text,phone text,postal_code text,address text,course_id text references courses(id),enrollment_year integer references academic_years(year),status text,status_effective_academic_year integer references academic_years(year),status_changed_at integer,status_changed_by_user_id text references user(id),has_failed_history integer not null default 0,created_at integer,updated_at integer);
  CREATE TABLE student_status_history (id text primary key,student_id text references students(id),status text,effective_academic_year integer references academic_years(year),changed_at integer,changed_by_user_id text references user(id),reason text);
  CREATE TABLE subjects (id text primary key,academic_year integer references academic_years(year),name text,grade_level integer,teacher_user_id text references user(id),created_at integer,updated_at integer,unique(academic_year,name,grade_level));
  CREATE TABLE subject_courses (subject_id text references subjects(id),course_id text references courses(id),primary key(subject_id,course_id)); CREATE TABLE subject_term_statuses (subject_id text references subjects(id),term integer,is_finalized integer,created_at integer,updated_at integer,primary key(subject_id,term));
  CREATE TABLE idempotency_operations (id text primary key,operation_type text,idempotency_key text unique,status text,academic_year integer references academic_years(year),payload_hash text,result_json text,created_by_user_id text references user(id),completed_at integer,created_at integer,updated_at integer); CREATE UNIQUE INDEX idempotency_operations_rollover_success_year_unique ON idempotency_operations(academic_year) WHERE operation_type='annual_rollover' AND status='succeeded';
  CREATE TABLE audit_logs (id text primary key,actor_user_id text references user(id),action text,entity_type text,entity_id text,academic_year integer references academic_years(year),payload_json text);
  INSERT INTO user VALUES ('admin','職員','admin@example.test','admin','active',0,0,0),('teacher','旧名','teacher@example.test','teacher','active',0,0,0); INSERT INTO academic_years VALUES (2023,0,'admin',0,0,0),(2026,1,'admin',0,0,0); INSERT INTO students VALUES ('old','OLD-1','卒業候補','そつぎょう','2005-04-01','男',NULL,NULL,NULL,NULL,'system-engineer',2023,'enrolled',NULL,0,NULL,0,0,0);
`); let id = 0; const adapter = d1(database); return { database, service: new D1RolloverService(adapter.database, () => `id-${++id}`, clock), lastBatchStatementCount: adapter.lastBatchStatementCount, setBeforeBatch: adapter.setBeforeBatch }; };

describe("annual rollover", () => {
  it("parses BOM, CRLF, and RFC4180 quotes while rejecting malformed headers", () => {
    const errors: Array<{ file: string; row: number; field: string; reason: string }> = []; expect(parseCsv("x", `\uFEFF${csv.grade1}`, ["専攻", "科目名", "担当講師"], errors)[0]?.[1]).toBe("基礎,情報");
    expect(parseCsv("x", "a,b\n", ["専攻"], errors)).toEqual([]); expect(errors).not.toHaveLength(0);
    expect(parseCsv("x", "専攻,科目名,担当講師\n共通,\"基礎\"不正,山田\n", ["専攻", "科目名", "担当講師"], [])).toEqual([]);
  });
  it("accepts ordinary-import headers for rollover while keeping header validation strict", async () => {
    const { service } = setup();
    const ordinaryImportHeaders = {
      teachers: csv.teachers.replace("氏名,ひらがな,年齢,性別,メールアドレス", "氏名,氏名（ひらがな）,年齢,性別,メールアドレス"),
      students: csv.students.replace("学籍番号,氏名,ひらがな,年齢,生年月日,性別,メール,電話,郵便番号,住所,専攻", "学籍番号,氏名,氏名（ひらがな）,年齢,生年月日,性別,メールアドレス,電話番号,郵便番号,住所,専攻"),
    };
    const compatible = await service.preview({ ...input(), teachersCsv: ordinaryImportHeaders.teachers, newStudentsCsv: ordinaryImportHeaders.students });
    expect(compatible.errors).toEqual([]);

    const reordered = await service.preview({ ...input(), teachersCsv: ordinaryImportHeaders.teachers.replace("氏名,氏名（ひらがな）,年齢", "年齢,氏名,氏名（ひらがな）") });
    expect(reordered.errors).toContainEqual(expect.objectContaining({ file: "講師CSV", row: 1, field: "見出し" }));
    const unknown = await service.preview({ ...input(), newStudentsCsv: ordinaryImportHeaders.students.replace("電話番号", "電話連絡先") });
    expect(unknown.errors).toContainEqual(expect.objectContaining({ file: "新入生CSV", row: 1, field: "見出し" }));
  });
  it("accepts independent ages and normalizes ordinary-import Japanese birth dates before persistence", async () => {
    const { database, service } = setup();
    const students = csv.students.replace(",19,2008-04-01,", ",42,2008年4月1日,");
    expect((await service.preview({ ...input(), newStudentsCsv: students })).errors).toEqual([]);
    await service.apply("admin", { ...input(), newStudentsCsv: students });
    expect(database.query("SELECT birth_date FROM students WHERE student_number='D27-001'").get()).toEqual({ birth_date: "2008-04-01" });
  });
  it("keeps age required after removing the age and birth-date equality check", async () => {
    for (const age of ["", "   "]) {
      const { database, service } = setup();
      const preview = await service.preview({ ...input(), newStudentsCsv: csv.students.replace(",19,2008-04-01,", `,${age},2008-04-01,`) });
      expect(preview.errors).toContainEqual(expect.objectContaining({ file: "新入生CSV", row: 2, field: "入力値" }));
      expect(preview).not.toHaveProperty("token");
      expect(database.query("SELECT count(*) AS count FROM subjects").get()).toEqual({ count: 0 });
      expect(database.query("SELECT year FROM academic_years WHERE is_current=1").get()).toEqual({ year: 2026 });
    }
  });
  it("rejects malformed, impossible, and future birth dates while accepting a valid leap date", async () => {
    const invalidDates = ["2008/04/01", "2007-02-29", "2008年4月31日"];
    for (const date of invalidDates) {
      const { database, service } = setup();
      const preview = await service.preview({ ...input(), newStudentsCsv: csv.students.replace("2008-04-01", date) });
      expect(preview.errors).toContainEqual(expect.objectContaining({ file: "新入生CSV", row: 2, field: "生年月日" }));
      expect(preview).not.toHaveProperty("token");
      expect(database.query("SELECT count(*) AS count FROM subjects").get()).toEqual({ count: 0 });
      expect(database.query("SELECT year FROM academic_years WHERE is_current=1").get()).toEqual({ year: 2026 });
    }
    const { service } = setup();
    expect((await service.preview({ ...input(), newStudentsCsv: csv.students.replace("2008-04-01", "2008-02-29") })).errors).toEqual([]);
  });
  it("uses the Japan calendar date when rejecting future birth dates", async () => {
    const beforeMidnight = setup(() => new Date("2026-09-07T14:59:59.000Z"));
    const tomorrow = csv.students.replace("2008-04-01", "2026-09-08");
    expect((await beforeMidnight.service.preview({ ...input(), newStudentsCsv: tomorrow })).errors).toContainEqual(expect.objectContaining({ file: "新入生CSV", row: 2, field: "生年月日" }));
    const afterMidnight = setup(() => new Date("2026-09-07T15:00:00.000Z"));
    expect((await afterMidnight.service.preview({ ...input(), newStudentsCsv: tomorrow })).errors).toEqual([]);
  });
  it("previews without mutation and reports invalid values", async () => {
    const { database, service } = setup(); const preview = await service.preview(input()); expect(preview.errors).toEqual([]); expect(preview.graduationCandidates).toBe(1); expect(preview.subjectCounts).toEqual({ 1: 1, 2: 0, 3: 0 }); expect(database.query("SELECT count(*) AS count FROM subjects").get()).toEqual({ count: 0 });
    database.exec("INSERT INTO students VALUES ('failed','F-1','留年','りゅうねん','2005-04-01','男',NULL,NULL,NULL,NULL,'system-engineer',2023,'enrolled',NULL,0,NULL,1,0,0),('suspended','S-1','休学','きゅうがく','2005-04-01','男',NULL,NULL,NULL,NULL,'system-engineer',2023,'suspended',NULL,0,NULL,0,0,0)");
    expect((await service.preview(input())).graduationCandidates).toBe(1);
    const invalid = await service.preview({ ...input(), newStudentsCsv: csv.students.replace(",女,", ",その他,") }); expect(invalid.errors).not.toHaveLength(0);
  });
  it("applies graduation, year, teacher diff, subjects, students and an idempotent audit atomically", async () => {
    const { database, service } = setup(); const first = await service.apply("admin", input()); const duplicate = await service.apply("admin", input()); expect(duplicate).toEqual(first);
    expect(database.query("SELECT year FROM academic_years WHERE is_current=1").get()).toEqual({ year: 2027 }); expect(database.query("SELECT status FROM students WHERE id='old'").get()).toEqual({ status: "graduated" }); expect(database.query("SELECT count(*) AS count FROM student_status_history").get()).toEqual({ count: 2 }); expect(database.query("SELECT name FROM user WHERE id='teacher'").get()).toEqual({ name: "山田講師" }); expect(database.query("SELECT count(*) AS count FROM subjects WHERE academic_year=2027").get()).toEqual({ count: 1 }); expect(database.query("SELECT count(*) AS count FROM subject_term_statuses").get()).toEqual({ count: 2 }); expect(database.query("SELECT enrollment_year FROM students WHERE student_number='D27-001'").get()).toEqual({ enrollment_year: 2027 }); expect(database.query("SELECT count(*) AS count FROM audit_logs WHERE action='annual_rollover_applied'").get()).toEqual({ count: 1 });
    await expect(service.apply("admin", { ...input(), newStudentsCsv: csv.students.replace("D27-001", "D27-002") })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT" });
    await expect(service.apply("admin", { ...input("another-key"), newStudentsCsv: csv.students.replace("D27-001", "D27-003") })).rejects.toMatchObject({ code: "ROLLOVER_YEAR_ALREADY_APPLIED" });
  });
  it("uses a fixed-size JSON1 batch for 1,000 input rows", async () => {
    const small = setup(); await small.service.apply("admin", input("one-row")); const oneRowStatementCount = small.lastBatchStatementCount();
    const { database, service, lastBatchStatementCount } = setup();
    const students = `${csv.students.split("\r\n")[0]}\r\n${Array.from({ length: 1_000 }, (_, index) => `D27-${String(index).padStart(4, "0")},新入生${index},しんにゅうせい,19,2008-04-01,女,new${index}@example.test,090,100-0001,東京都,システムエンジニア`).join("\r\n")}\r\n`;
    await service.apply("admin", { ...input("one-thousand"), newStudentsCsv: students });
    expect(lastBatchStatementCount()).toBe(oneRowStatementCount); expect(lastBatchStatementCount()).toBeLessThan(40);
    expect(database.query("SELECT count(*) AS count FROM students WHERE enrollment_year=2027").get()).toEqual({ count: 1_000 });
  });
  it("rolls the entire batch back when a previewed teacher retires before apply", async () => {
    const { database, service, setBeforeBatch } = setup(); await service.preview(input()); setBeforeBatch(() => database.exec("UPDATE user SET status='retired' WHERE id='teacher'"));
    await expect(service.apply("admin", input())).rejects.toThrow();
    expect(database.query("SELECT count(*) AS count FROM academic_years WHERE year=2027").get()).toEqual({ count: 0 });
    expect(database.query("SELECT status FROM students WHERE id='old'").get()).toEqual({ status: "enrolled" });
    expect(database.query("SELECT count(*) AS count FROM subjects").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM idempotency_operations").get()).toEqual({ count: 0 });
    expect(database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });
  it("rolls the entire batch back when the current-year or graduation snapshot changes", async () => {
    const currentChanged = setup(); await currentChanged.service.preview(input()); currentChanged.setBeforeBatch(() => currentChanged.database.exec("UPDATE academic_years SET is_current=0; INSERT INTO academic_years VALUES (2025,1,'admin',0,0,0)"));
    await expect(currentChanged.service.apply("admin", input())).rejects.toThrow(); expect(currentChanged.database.query("SELECT count(*) AS count FROM idempotency_operations").get()).toEqual({ count: 0 });
    const graduateChanged = setup(); await graduateChanged.service.preview(input()); graduateChanged.setBeforeBatch(() => graduateChanged.database.exec("UPDATE students SET has_failed_history=1 WHERE id='old'"));
    await expect(graduateChanged.service.apply("admin", input())).rejects.toThrow(); expect(graduateChanged.database.query("SELECT count(*) AS count FROM academic_years WHERE year=2027").get()).toEqual({ count: 0 }); expect(graduateChanged.database.query("SELECT count(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });
  it("does not graduate a student with sticky finalized F history", async () => {
    const { database, service } = setup();
    database.exec("UPDATE students SET has_failed_history=1 WHERE id='old'");
    expect((await service.preview(input())).graduationCandidates).toBe(0);
    await service.apply("admin", input());
    expect(database.query("SELECT status FROM students WHERE id='old'").get()).toEqual({ status: "enrolled" });
    expect(database.query("SELECT count(*) AS count FROM student_status_history WHERE student_id='old' AND status='graduated'").get()).toEqual({ count: 0 });
  });
});
