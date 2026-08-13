import { readFile } from "node:fs/promises";
import { describe, expect, it } from "bun:test";

import { CliError } from "./create-admin";
import { buildSeedSql, createSeedPlan, parseSeedArguments, seedDevelopmentData } from "./seed-dev";

const password = () => "local-temporary-password";
const hash = async () => "password-hash";
const activeFixture = (email: string, role: "admin" | "teacher", id: string, accountId: string | null) => ({ kind: "fixture", email, role, id, status: "active", accountId });
const exactStudent = (year = 2030) => ({ kind: "fixture-student", id: "dev-student", studentNumber: `D${String(year).slice(-2)}-001`, name: "開発用 学生", nameKana: "カイハツヨウガクセイ", birthDate: "2008-04-01", gender: "男", email: "dev-student@example.test", phone: null, postalCode: null, address: null, courseId: "system-engineer", enrollmentYear: year, status: "enrolled", statusEffectiveAcademicYear: null, statusChangedByUserId: null, hasFailedHistory: 0 });
const exactHistory = (year = 2030) => ({ kind: "fixture-history", id: "dev-student-enrolled", studentId: "dev-student", status: "enrolled", effectiveAcademicYear: year, changedByUserId: null, reason: "開発fixture" });
const exactSubject = (teacherUserId = "teacher") => ({ kind: "fixture-subject", id: "dev-subject", academicYear: 2030, name: "開発用データベース", gradeLevel: 1, teacherUserId });
const exactTerm = (term: 1 | 2) => ({ kind: "fixture-term", term, isFinalized: 0, finalizedByUserId: null, finalizedAt: null, reopenedByUserId: null, reopenedAt: null, reopenedReason: null, lastTransitionId: null });

describe("dev:seed", () => {
  it("is local-only and preserves an existing current academic year", async () => {
    expect(parseSeedArguments([])).toEqual({ help: false });
    expect(() => parseSeedArguments(["--remote"])).toThrow(CliError);
    const plan = await createSeedPlan([{ kind: "current-year", currentYear: 2030 }], { password, hash });
    const sql = buildSeedSql(plan);
    expect(plan.academicYear).toBe(2030);
    expect(sql).not.toContain("UPDATE academic_years SET is_current");
    expect(sql).toContain("D30-001");
    expect(sql).toContain("VALUES (2030,1");
  });

  it("uses the actual existing user ID when adding a missing credential and returns it once", async () => {
    const plan = await createSeedPlan([
      { kind: "current-year", currentYear: 2030 },
      { kind: "fixture", id: "other-admin-id", email: "dev-admin@example.test", role: "admin", status: "active", accountId: null },
      { kind: "fixture", id: "other-teacher-id", email: "dev-teacher@example.test", role: "teacher", status: "active", accountId: "existing-credential" },
    ], { password, hash });
    const sql = buildSeedSql(plan);
    expect(plan.credentials).toEqual([{ email: "dev-admin@example.test", temporaryPassword: "local-temporary-password" }]);
    expect(sql).toContain("SET must_change_password=1");
    expect(sql).toContain("'other-admin-id','credential','other-admin-id'");
    expect(sql).toContain("'other-teacher-id'");
  });

  it("fails before a write for a same-email role mismatch or fixture-ID collision", async () => {
    await expect(createSeedPlan([
      { kind: "fixture", id: "another", email: "dev-admin@example.test", role: "teacher", status: "active", accountId: null },
    ], { password, hash })).rejects.toThrow("上書きできません");
    await expect(createSeedPlan([
      { kind: "fixture-subject", id: "dev-subject", academicYear: 2026, name: "別科目", teacherUserId: "x" },
    ], { password, hash })).rejects.toThrow("別データ");
  });

  it("rejects inactive existing admin or teacher before generating a credential", async () => {
    for (const fixture of [
      { kind: "fixture", id: "inactive-admin", email: "dev-admin@example.test", role: "admin", status: "leave", accountId: null },
      { kind: "fixture", id: "inactive-teacher", email: "dev-teacher@example.test", role: "teacher", status: "retired", accountId: null },
    ]) {
      let passwordCalls = 0;
      await expect(createSeedPlan([fixture], { password: () => { passwordCalls += 1; return "must-not-be-created"; }, hash })).rejects.toThrow("有効ではない");
      expect(passwordCalls).toBe(0);
    }
  });

  it("rejects changed student, subject, course, or term fixture values before a write", async () => {
    const base = [
      { kind: "current-year", currentYear: 2030 },
      activeFixture("dev-admin@example.test", "admin", "admin", "admin-account"),
      activeFixture("dev-teacher@example.test", "teacher", "teacher", "teacher-account"),
      exactStudent(), exactHistory(), exactSubject(), { kind: "fixture-course", courseId: "system-engineer" }, exactTerm(1), exactTerm(2),
    ];
    for (const changed of [
      { ...exactStudent(), name: "別の学生" },
      { ...exactStudent(), status: "suspended" },
      { ...exactStudent(), email: "other@example.test" },
      { ...exactSubject(), gradeLevel: 2 },
      { kind: "fixture-course", courseId: "web-designer" },
      { ...exactTerm(1), isFinalized: 1, finalizedByUserId: "admin", finalizedAt: 1 },
    ]) {
      const withoutMatching = base.filter((row) => row.kind !== changed.kind);
      await expect(createSeedPlan([...withoutMatching, changed], { password, hash })).rejects.toThrow("既存の別データ");
    }
  });

  it("keeps an exact fixture unchanged and only safely complements missing history, course, and term rows", async () => {
    const plan = await createSeedPlan([
      { kind: "current-year", currentYear: 2030 },
      activeFixture("dev-admin@example.test", "admin", "admin", "admin-account"),
      activeFixture("dev-teacher@example.test", "teacher", "teacher", "teacher-account"),
      exactStudent(), exactSubject(),
    ], { password, hash });
    const sql = buildSeedSql(plan);
    expect(plan.credentials).toEqual([]);
    expect(sql).not.toContain("INSERT INTO students");
    expect(sql).toContain("INSERT INTO student_status_history");
    expect(sql).not.toContain("INSERT INTO subjects");
    expect(sql).toContain("INSERT INTO subject_courses");
    expect(sql).toContain("('dev-subject',1,0");
    expect(sql).toContain("('dev-subject',2,0");
  });

  it("uses generated IDs when a static fixture ID is already occupied", async () => {
    const plan = await createSeedPlan([
      { kind: "user-id", id: "dev-admin" },
      { kind: "account-id", id: "dev-admin-account" },
    ], { password, hash, createId: (() => { const ids = ["replacement-user", "replacement-account"]; return () => ids.shift() ?? "unexpected"; })() });
    const admin = plan.accounts.find((account) => account.email === "dev-admin@example.test");
    expect(admin).toMatchObject({ id: "replacement-user", accountId: "replacement-account" });
  });

  it("executes the resolved plan once, retaining a current year and using the actual existing ID", async () => {
    let writtenSql = "";
    const credentials = await seedDevelopmentData({
      password,
      hash,
      runCommand: async (command) => {
        if (command.includes("--command")) {
          return { exitCode: 0, stderr: "", stdout: JSON.stringify([{ results: [
            { kind: "current-year", currentYear: 2030 },
            { kind: "fixture", id: "arbitrary-admin", email: "dev-admin@example.test", role: "admin", status: "active", accountId: null },
            { kind: "fixture", id: "arbitrary-teacher", email: "dev-teacher@example.test", role: "teacher", status: "active", accountId: "teacher-account" },
          ] }]) };
        }
        writtenSql = await readFile(command[command.indexOf("--file") + 1]!, "utf8");
        return { exitCode: 0, stderr: "", stdout: JSON.stringify([{ results: [] }]) };
      },
    });
    expect(credentials).toEqual([{ email: "dev-admin@example.test", temporaryPassword: "local-temporary-password" }]);
    expect(writtenSql).toContain("'arbitrary-admin','credential','arbitrary-admin'");
    expect(writtenSql).toContain("VALUES (2030,1");
    expect(writtenSql).not.toContain("UPDATE academic_years SET is_current");
  });
});
