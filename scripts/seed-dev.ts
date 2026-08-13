import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";

import { CliError, executeReadSql, quoteSql, type CommandRunner } from "./create-admin";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = join(root, "wrangler.jsonc");
const database = "grade-management";
const fixtures = [
  { id: "dev-admin", accountId: "dev-admin-account", name: "開発用 管理者", email: "dev-admin@example.test", role: "admin" },
  { id: "dev-teacher", accountId: "dev-teacher-account", name: "開発用 講師", email: "dev-teacher@example.test", role: "teacher" },
] as const;

type Fixture = (typeof fixtures)[number];
type ExistingFixture = { id: string; email: string; role: string; status: string; accountId: string | null };
type FixtureRecord = Record<string, unknown> & { kind: string };
type SeedAccount = { id: string; accountId: string; name: string; email: string; role: string; passwordHash: string; existingUser: boolean };

export type DevCredential = { email: string; temporaryPassword: string };
export type SeedPlan = {
  academicYear: number;
  teacherUserId: string;
  accounts: SeedAccount[];
  credentials: DevCredential[];
  studentExists: boolean;
  historyExists: boolean;
  subjectExists: boolean;
  existingCourseIds: string[];
  existingTerms: number[];
};
export const helpText = "ローカルD1専用の開発fixtureを作成します。remote指定は受け付けません。";

export function parseSeedArguments(args: string[]) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { help: true as const };
  if (args.length !== 0 || args.some((arg) => arg === "--remote" || arg === "--yes")) throw new CliError("dev:seed はローカルD1専用です。オプションは指定できません。");
  return { help: false as const };
}

const positiveYear = (value: unknown) => {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 9999 ? year : undefined;
};

function uniqueId(preferred: string, occupied: Set<string>, createId: () => string) {
  if (!occupied.has(preferred)) {
    occupied.add(preferred);
    return preferred;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = createId();
    if (!occupied.has(id)) {
      occupied.add(id);
      return id;
    }
  }
  throw new CliError("開発fixture用のIDを安全に確保できませんでした。もう一度実行してください。");
}

const nullable = (value: unknown) => value ?? null;
const same = (actual: unknown, expected: unknown) => nullable(actual) === expected;
const sameInteger = (actual: unknown, expected: number) => Number(actual) === expected;

function ensureStudentFixture(row: FixtureRecord, academicYear: number) {
  const expected: Record<string, string | number | null> = {
    id: "dev-student", studentNumber: `D${String(academicYear).slice(-2)}-001`, name: "開発用 学生", nameKana: "カイハツヨウガクセイ",
    birthDate: "2008-04-01", gender: "男", email: "dev-student@example.test", phone: null, postalCode: null, address: null,
    courseId: "system-engineer", enrollmentYear: academicYear, status: "enrolled", statusEffectiveAcademicYear: null,
    statusChangedByUserId: null, hasFailedHistory: 0,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const valid = typeof expectedValue === "number" ? sameInteger(row[field], expectedValue) : same(row[field], expectedValue);
    if (!valid) throw new CliError("開発fixtureの学生IDが既存の別データに使用されています。local D1を確認してください。");
  }
}

function ensureHistoryFixture(row: FixtureRecord, academicYear: number) {
  const expected: Record<string, string | number | null> = {
    id: "dev-student-enrolled", studentId: "dev-student", status: "enrolled", effectiveAcademicYear: academicYear,
    changedByUserId: null, reason: "開発fixture",
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    const valid = typeof expectedValue === "number" ? sameInteger(row[field], expectedValue) : same(row[field], expectedValue);
    if (!valid) throw new CliError("開発fixtureの在籍履歴IDが既存の別データに使用されています。local D1を確認してください。");
  }
}

function ensureSubjectFixture(row: FixtureRecord, academicYear: number, teacherUserId: string) {
  if (!same(row.id, "dev-subject") || !sameInteger(row.academicYear, academicYear) || !same(row.name, "開発用データベース") || !sameInteger(row.gradeLevel, 1) || !same(row.teacherUserId, teacherUserId)) {
    throw new CliError("開発fixtureの科目IDが既存の別データに使用されています。local D1を確認してください。");
  }
}

function ensureTermFixture(row: FixtureRecord) {
  const term = Number(row.term);
  if (![1, 2].includes(term) || !sameInteger(row.isFinalized, 0) || !same(row.finalizedByUserId, null) || !same(row.finalizedAt, null) || !same(row.reopenedByUserId, null) || !same(row.reopenedAt, null) || !same(row.reopenedReason, null) || !same(row.lastTransitionId, null)) {
    throw new CliError("開発fixtureの学期状態が既存の別データに使用されています。local D1を確認してください。");
  }
  return term;
}

export async function createSeedPlan(rows: FixtureRecord[], options: { password: () => string; hash: (password: string) => Promise<string>; createId?: () => string }): Promise<SeedPlan> {
  const existingByEmail = new Map<string, ExistingFixture>();
  const occupiedUserIds = new Set<string>();
  const occupiedAccountIds = new Set<string>();
  let currentYear: number | undefined;
  let existingStudent: FixtureRecord | undefined;
  let existingHistory: FixtureRecord | undefined;
  let existingSubject: FixtureRecord | undefined;
  const existingCourseIds: string[] = [];
  const existingTerms: number[] = [];

  for (const row of rows) {
    if (row.kind === "fixture" && typeof row.id === "string" && typeof row.email === "string" && typeof row.role === "string" && typeof row.status === "string") {
      existingByEmail.set(row.email, { id: row.id, email: row.email, role: row.role, status: row.status, accountId: typeof row.accountId === "string" ? row.accountId : null });
    } else if (row.kind === "current-year") {
      currentYear ??= positiveYear(row.currentYear);
    } else if (row.kind === "user-id" && typeof row.id === "string") {
      occupiedUserIds.add(row.id);
    } else if (row.kind === "account-id" && typeof row.id === "string") {
      occupiedAccountIds.add(row.id);
    } else if (row.kind === "fixture-student") {
      existingStudent = row;
    } else if (row.kind === "fixture-history") {
      existingHistory = row;
    } else if (row.kind === "fixture-subject") {
      existingSubject = row;
    } else if (row.kind === "fixture-course" && typeof row.courseId === "string") {
      existingCourseIds.push(row.courseId);
    } else if (row.kind === "fixture-term") {
      existingTerms.push(ensureTermFixture(row));
    }
  }

  const academicYear = currentYear ?? 2027;
  if (existingStudent) ensureStudentFixture(existingStudent, academicYear);
  if (existingHistory) ensureHistoryFixture(existingHistory, academicYear);
  if (existingCourseIds.some((courseId) => courseId !== "system-engineer") || new Set(existingCourseIds).size !== existingCourseIds.length) throw new CliError("開発fixtureの科目コース設定が既存の別データに使用されています。local D1を確認してください。");
  if (new Set(existingTerms).size !== existingTerms.length) throw new CliError("開発fixtureの学期状態が重複しています。local D1を確認してください。");
  for (const fixture of fixtures) {
    const existing = existingByEmail.get(fixture.email);
    if (existing && existing.role !== fixture.role) {
      throw new CliError(`${fixture.email} は既存の${existing.role === "admin" ? "専任職員" : "講師"}アカウントです。開発fixtureとして上書きできません。`);
    }
    if (existing && existing.status !== "active") {
      throw new CliError(`${fixture.email} は有効ではない既存アカウントです。開発fixtureとして変更できません。`);
    }
  }

  const build = async (): Promise<SeedPlan> => {
    const accounts: SeedAccount[] = [];
    const credentials: DevCredential[] = [];
    const createId = options.createId ?? randomUUID;
    for (const fixture of fixtures) {
      const existing = existingByEmail.get(fixture.email);
      const userId = existing?.id ?? uniqueId(fixture.id, occupiedUserIds, createId);
      if (existing?.accountId) continue;
      const temporaryPassword = options.password();
      const accountId = uniqueId(fixture.accountId, occupiedAccountIds, createId);
      accounts.push({ ...fixture, id: userId, accountId, passwordHash: await options.hash(temporaryPassword), existingUser: Boolean(existing) });
      credentials.push({ email: fixture.email, temporaryPassword });
    }
    const teacherUserId = existingByEmail.get("dev-teacher@example.test")?.id
      ?? accounts.find((account) => account.email === "dev-teacher@example.test")?.id;
    if (!teacherUserId) throw new CliError("開発用講師アカウントを確保できませんでした。");
    if (existingSubject) ensureSubjectFixture(existingSubject, academicYear, teacherUserId);
    return { academicYear, teacherUserId, accounts, credentials, studentExists: Boolean(existingStudent), historyExists: Boolean(existingHistory), subjectExists: Boolean(existingSubject), existingCourseIds, existingTerms };
  };
  return build();
}

export function buildSeedReadSql() {
  const emails = fixtures.map((fixture) => quoteSql(fixture.email)).join(",");
  const userIds = fixtures.map((fixture) => quoteSql(fixture.id)).join(",");
  const accountIds = fixtures.map((fixture) => quoteSql(fixture.accountId)).join(",");
  return `SELECT 'fixture' AS kind, u.id, u.email, u.role, u.status, a.id AS accountId FROM "user" u LEFT JOIN "account" a ON a.user_id = u.id AND a.provider_id = 'credential' WHERE u.email IN (${emails});
SELECT 'current-year' AS kind, year AS currentYear FROM academic_years WHERE is_current=1 LIMIT 1;
SELECT 'user-id' AS kind, id FROM "user" WHERE id IN (${userIds});
SELECT 'account-id' AS kind, id FROM "account" WHERE id IN (${accountIds});
SELECT 'fixture-student' AS kind, id, student_number AS studentNumber, name, name_kana AS nameKana, birth_date AS birthDate, gender, email, phone, postal_code AS postalCode, address, course_id AS courseId, enrollment_year AS enrollmentYear, status, status_effective_academic_year AS statusEffectiveAcademicYear, status_changed_by_user_id AS statusChangedByUserId, has_failed_history AS hasFailedHistory FROM students WHERE id='dev-student';
SELECT 'fixture-history' AS kind, id, student_id AS studentId, status, effective_academic_year AS effectiveAcademicYear, changed_by_user_id AS changedByUserId, reason FROM student_status_history WHERE id='dev-student-enrolled';
SELECT 'fixture-subject' AS kind, id, academic_year AS academicYear, name, grade_level AS gradeLevel, teacher_user_id AS teacherUserId FROM subjects WHERE id='dev-subject';
SELECT 'fixture-course' AS kind, course_id AS courseId FROM subject_courses WHERE subject_id='dev-subject';
SELECT 'fixture-term' AS kind, term, is_finalized AS isFinalized, finalized_by_user_id AS finalizedByUserId, finalized_at AS finalizedAt, reopened_by_user_id AS reopenedByUserId, reopened_at AS reopenedAt, reopened_reason AS reopenedReason, last_transition_id AS lastTransitionId FROM subject_term_statuses WHERE subject_id='dev-subject';`;
}

export function buildSeedSql(plan: SeedPlan) {
  const users = plan.accounts.map((item) => {
    const account = `INSERT INTO "account" (id,account_id,provider_id,user_id,password) VALUES (${quoteSql(item.accountId)},${quoteSql(item.id)},'credential',${quoteSql(item.id)},${quoteSql(item.passwordHash)});`;
    return item.existingUser
      ? `UPDATE "user" SET must_change_password=1,updated_at=unixepoch() WHERE id=${quoteSql(item.id)};\n${account}`
      : `INSERT INTO "user" (id,name,email,role,status,must_change_password) VALUES (${quoteSql(item.id)},${quoteSql(item.name)},${quoteSql(item.email)},${quoteSql(item.role)},'active',1);\n${account}`;
  }).join("\n");
  const studentNumber = `D${String(plan.academicYear).slice(-2)}-001`;
  const student = plan.studentExists
    ? ""
    : `INSERT INTO students (id,student_number,name,name_kana,birth_date,gender,email,course_id,enrollment_year,status,status_changed_at,created_at,updated_at) VALUES ('dev-student',${quoteSql(studentNumber)},'開発用 学生','カイハツヨウガクセイ','2008-04-01','男','dev-student@example.test','system-engineer',${plan.academicYear},'enrolled',unixepoch(),unixepoch(),unixepoch());`;
  const history = plan.historyExists
    ? ""
    : `INSERT INTO student_status_history (id,student_id,status,effective_academic_year,changed_at,reason) VALUES ('dev-student-enrolled','dev-student','enrolled',${plan.academicYear},unixepoch(),'開発fixture');`;
  const subject = plan.subjectExists
    ? ""
    : `INSERT INTO subjects (id,academic_year,name,grade_level,teacher_user_id,created_at,updated_at) VALUES ('dev-subject',${plan.academicYear},'開発用データベース',1,${quoteSql(plan.teacherUserId)},unixepoch(),unixepoch());`;
  const course = plan.existingCourseIds.includes("system-engineer")
    ? ""
    : "INSERT INTO subject_courses (subject_id,course_id) VALUES ('dev-subject','system-engineer');";
  const missingTerms = [1, 2].filter((term) => !plan.existingTerms.includes(term));
  const terms = missingTerms.length === 0
    ? ""
    : `INSERT INTO subject_term_statuses (subject_id,term,is_finalized,created_at,updated_at) VALUES ${missingTerms.map((term) => `('dev-subject',${term},0,unixepoch(),unixepoch())`).join(",")};`;
  return `PRAGMA foreign_keys=ON;
INSERT INTO academic_years (year,is_current,created_at,updated_at) VALUES (${plan.academicYear},1,unixepoch(),unixepoch())
ON CONFLICT(year) DO UPDATE SET is_current=CASE WHEN NOT EXISTS (SELECT 1 FROM academic_years WHERE is_current=1) THEN 1 ELSE academic_years.is_current END, updated_at=CASE WHEN NOT EXISTS (SELECT 1 FROM academic_years WHERE is_current=1) THEN unixepoch() ELSE academic_years.updated_at END;
${users}
${student}
${history}
${subject}
${course}
${terms}
`;
}

const command = (sqlFile: string) => [process.execPath, "x", "wrangler", "d1", "execute", database, "--file", sqlFile, "--local", "--persist-to", join(root, "apps", "web", ".wrangler", "state"), "--config", config, "--json"];
async function run(commandLine: string[], cwd: string) { const child = Bun.spawn(commandLine, { cwd, stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode }; }

export async function seedDevelopmentData(dependencies: { runCommand?: CommandRunner; hash?: (password: string) => Promise<string>; password?: () => string; createId?: () => string } = {}) {
  const rows = await executeReadSql(buildSeedReadSql(), "local", { runCommand: dependencies.runCommand });
  const plan = await createSeedPlan(rows, { password: dependencies.password ?? (() => randomBytes(18).toString("base64url")), hash: dependencies.hash ?? hashPassword, createId: dependencies.createId });
  const directory = await mkdtemp(join(tmpdir(), "grade-management-seed-")); const file = join(directory, "fixture.sql");
  try { await writeFile(file, buildSeedSql(plan), { mode: 0o600 }); await chmod(file, 0o600); const result = await (dependencies.runCommand ?? run)(command(file), root); if (result.exitCode !== 0) throw new CliError("開発fixtureを作成できませんでした。local D1 migrationを先に適用してください。"); return plan.credentials; }
  finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const options = parseSeedArguments(process.argv.slice(2)); if (options.help) console.log(helpText); else { const credentials = await seedDevelopmentData(); console.log("開発fixtureをlocal D1へ作成しました。"); if (credentials.length) { console.log("次の一時パスワードは今回だけ表示されます:"); for (const item of credentials) console.log(`${item.email}: ${item.temporaryPassword}`); } else console.log("既存の開発アカウントは保持しました。一時パスワードは再表示しません。"); } } catch (error) { console.error(error instanceof Error ? error.message : "開発fixtureを作成できませんでした。"); process.exitCode = 1; }
}
