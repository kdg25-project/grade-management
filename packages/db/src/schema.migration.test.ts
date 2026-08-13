import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

const migrationFiles = [
  new URL("../drizzle/0000_zippy_rumiko_fujikawa.sql", import.meta.url),
  new URL("../drizzle/0001_redundant_shen.sql", import.meta.url),
  new URL("../drizzle/0002_luxuriant_silverclaw.sql", import.meta.url),
  new URL("../drizzle/0003_outstanding_lady_ursula.sql", import.meta.url),
  new URL("../drizzle/0004_white_violations.sql", import.meta.url),
  new URL("../drizzle/0005_naive_machine_man.sql", import.meta.url),
  new URL("../drizzle/0006_natural_lucky_pierre.sql", import.meta.url),
  new URL("../drizzle/0007_wild_prism.sql", import.meta.url),
];

async function createMigratedDatabase() {
  const database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");

  for (const migrationFile of migrationFiles) {
    const migration = await Bun.file(migrationFile).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement);
    }
  }

  database.exec(`
    INSERT INTO user (id, name, email) VALUES ('teacher-1', '担当講師', 'teacher@example.test');
    INSERT INTO academic_years (year, is_current) VALUES (2026, 1), (2027, 0);
    INSERT INTO students (
      id, student_number, name, name_kana, birth_date, gender, course_id, enrollment_year
    ) VALUES (
      'student-1', 'D26-001', '学生一郎', 'ガクセイイチロウ', '2008-04-01', 'unspecified', 'system-engineer', 2026
    );
    INSERT INTO subjects (id, academic_year, name, grade_level, teacher_user_id)
      VALUES ('subject-2026', 2026, 'データベース', 1, 'teacher-1');
    INSERT INTO subject_courses (subject_id, course_id)
      VALUES ('subject-2026', 'system-engineer');
  `);

  return database;
}

describe("generated D1 migration constraints", () => {
  it("does not persist partial final-score values under SQLite CHECK semantics", async () => {
    const database = await createMigratedDatabase();
    try {
      const gradesDefinition = database
        .query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'grades'")
        .get();
      expect(gradesDefinition?.sql).toContain("grades_final_score_representation_check");
      expect(database.query("PRAGMA ignore_check_constraints").get()).toEqual({ ignore_check_constraints: 0 });
      expect(database.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      database.exec(`
        INSERT INTO grades (id, student_id, subject_id, academic_year, term, final_score_numerator)
        VALUES ('grade-partial-score', 'student-1', 'subject-2026', 2026, 1, 9000);
      `);
      expect(database.query("SELECT count(*) AS count FROM grades").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("does not persist a grade whose explicit academic year differs from its subject", async () => {
    const database = await createMigratedDatabase();
    try {
      const foreignKeys = database.query("PRAGMA foreign_key_list('grades')").all();
      expect(foreignKeys).toContainEqual(
        expect.objectContaining({ table: "subjects", from: "subject_id", to: "id" }),
      );
      database.exec(`
        INSERT INTO grades (id, student_id, subject_id, academic_year, term)
        VALUES ('grade-wrong-year', 'student-1', 'subject-2026', 2027, 1);
      `);
      expect(database.query("SELECT count(*) AS count FROM grades").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("does not delete a subject that still has business records", async () => {
    const database = await createMigratedDatabase();
    try {
      expect(() => database.exec("DELETE FROM subjects WHERE id = 'subject-2026';")).toThrow();
    } finally {
      database.close();
    }
  });

  it("applies the transition identifier migration and rejects duplicate transition events", async () => {
    const database = await createMigratedDatabase();
    try {
      database.exec(`
        INSERT INTO subjects (id, academic_year, name, grade_level, teacher_user_id)
          VALUES ('subject-2026-2', 2026, 'ネットワーク', 1, 'teacher-1');
        INSERT INTO subject_term_statuses (
          subject_id, term, is_finalized, finalized_by_user_id, finalized_at, last_transition_id
        ) VALUES ('subject-2026', 1, 1, 'teacher-1', 1, 'transition-1');
      `);
      database.exec(`
        INSERT INTO subject_term_statuses (
          subject_id, term, is_finalized, finalized_by_user_id, finalized_at, last_transition_id
        ) VALUES ('subject-2026-2', 1, 1, 'teacher-1', 1, 'transition-1');
      `);
      expect(database.query("SELECT count(*) AS count FROM subject_term_statuses").get()).toEqual({ count: 1 });
      expect(database.query("SELECT last_transition_id FROM subject_term_statuses WHERE subject_id = 'subject-2026'").get())
        .toEqual({ last_transition_id: "transition-1" });
    } finally {
      database.close();
    }
  });

  it("adds an explicit, indexed academic year to audit records", async () => {
    const database = await createMigratedDatabase();
    try {
      database.exec("INSERT INTO audit_logs (id, action, entity_type, entity_id, academic_year) VALUES ('audit-year', 'student_created', 'student', 'student-1', 2026)");
      expect(database.query("SELECT academic_year FROM audit_logs WHERE id = 'audit-year'").get()).toEqual({ academic_year: 2026 });
      expect(database.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'audit_logs_year_created_id_idx'").get()).toEqual({ name: "audit_logs_year_created_id_idx" });
      expect(() => database.exec("INSERT INTO audit_logs (id, action, entity_type, entity_id, academic_year) VALUES ('audit-bad-year', 'student_created', 'student', 'student-1', 1999)")).toThrow();
    } finally {
      database.close();
    }
  });

  it("allows at most one completed annual rollover for an academic year", async () => {
    const database = await createMigratedDatabase();
    try {
      database.exec("INSERT INTO idempotency_operations (id,operation_type,idempotency_key,status,academic_year,payload_hash) VALUES ('rollover-1','annual_rollover','key-1','succeeded',2027,'hash')");
      expect(() => database.exec("INSERT INTO idempotency_operations (id,operation_type,idempotency_key,status,academic_year,payload_hash) VALUES ('rollover-2','annual_rollover','key-2','succeeded',2027,'hash')")).toThrow();
    } finally { database.close(); }
  });
  it("creates owner-bound export snapshots with cascading rows and unique claims", async () => {
    const database = await createMigratedDatabase();
    try {
      database.exec("INSERT INTO grade_export_snapshots (id,owner_user_id,academic_year,expires_at) VALUES ('snapshot-1','teacher-1',2026,9999999999); INSERT INTO grade_export_snapshot_rows (snapshot_id,position,student_number,student_name,academic_year,term,course_name,grade_level,subject_name,attendance_rate,letter_grade) VALUES ('snapshot-1',1,'D26-001','学生一郎',2026,1,'SE',1,'DB',100,'S'); UPDATE grade_export_snapshots SET claim_id='claim-1',claimed_at=1 WHERE id='snapshot-1'");
      expect(() => database.exec("INSERT INTO grade_export_snapshots (id,owner_user_id,academic_year,expires_at,claim_id) VALUES ('snapshot-2','teacher-1',2026,9999999999,'claim-1')")).toThrow();
      database.exec("DELETE FROM grade_export_snapshots WHERE id='snapshot-1'"); expect(database.query("SELECT count(*) AS count FROM grade_export_snapshot_rows").get()).toEqual({ count: 0 });
    } finally { database.close(); }
  });
  it("creates owner-bound normal import snapshots with a unique consume claim", async () => {
    const database = await createMigratedDatabase();
    try {
      database.exec("INSERT INTO import_snapshots (id,owner_user_id,academic_year,payload_json,payload_hash,expires_at) VALUES ('import-1','teacher-1',2026,'{}','hash',9999999999); UPDATE import_snapshots SET claim_id='claim-import-1',claimed_at=1 WHERE id='import-1'");
      expect(() => database.exec("INSERT INTO import_snapshots (id,owner_user_id,academic_year,payload_json,payload_hash,expires_at,claim_id) VALUES ('import-2','teacher-1',2026,'{}','hash',9999999999,'claim-import-1')")).toThrow();
    } finally { database.close(); }
  });
});
