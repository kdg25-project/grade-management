import { hashPassword } from "better-auth/crypto";

import { ensureCurrentAcademicYear, type Clock } from "../academic-year";
import { createWorkerId } from "../worker-crypto";

export type StudentStatus = "enrolled" | "suspended" | "withdrawn" | "graduated";
export type AccountStatus = "active" | "leave" | "retired";
export type ManagedAccountRole = "teacher" | "admin";
export const ACCOUNT_CAPS: Record<ManagedAccountRole, number> = { teacher: 30, admin: 3 };
export type PasswordResetRequester = (email: string) => Promise<void>;
type SqlRow = Record<string, unknown>;

export class AdminDomainError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 410 | 413 | 500 | 503 = 400) {
    super(message);
  }
}

export type StudentInput = {
  studentNumber: string; name: string; nameKana: string; birthDate: string; gender: string;
  email?: string | null; phone?: string | null; postalCode?: string | null; address?: string | null;
  courseId: string; enrollmentYear: number;
};
export type SubjectInput = { name: string; gradeLevel: 1 | 2 | 3; teacherUserId: string; courseIds: string[]; academicYear?: number };
export type StudentListItem = { id: string; studentNumber: string; name: string; nameKana: string; birthDate: string; gender: string; email: string | null; phone: string | null; postalCode: string | null; address: string | null; courseId: string; courseName: string; enrollmentYear: number; status: StudentStatus; statusEffectiveAcademicYear: number | null; gradeLevel: number };
export type TeacherListItem = { id: string; name: string; email: string; status: AccountStatus; mustChangePassword: boolean; createdAt: number };
export type SubjectListItem = { id: string; name: string; academicYear: number; gradeLevel: number; teacherUserId: string; teacherName: string; courseIds: string[]; hasFinalizedTerm: boolean };
export type AdminMasterService = {
  years(): Promise<{ years: Array<{ year: number; isCurrent: boolean; selectedAt: number | null }> }>;
  selectCurrentYear(actorId: string, year: number): Promise<{ year: number; isCurrent: true; alreadySelected: boolean }>;
  students(query: { page: number; pageSize: number; search?: string; courseId?: string; enrollmentYear?: number; gradeLevel?: number; status?: StudentStatus }): Promise<{ currentAcademicYear: number; total: number; items: StudentListItem[] }>;
  createStudent(actorId: string, input: StudentInput): Promise<{ id: string }>;
  updateStudent(actorId: string, id: string, input: StudentInput): Promise<{ id: string }>;
  changeStudentStatus(actorId: string, id: string, status: StudentStatus, effectiveAcademicYear: number, reason: string): Promise<{ id: string; status: StudentStatus }>;
  teachers(query: { search?: string; status?: AccountStatus }): Promise<{ items: TeacherListItem[] }>;
  createTeacher(actorId: string, input: { name: string; email: string }): Promise<{ id: string; email: string; temporaryPassword: string }>;
  changeTeacherStatus(actorId: string, id: string, status: AccountStatus): Promise<{ id: string; status: AccountStatus }>;
  staff(query: { search?: string; status?: AccountStatus }): Promise<{ items: TeacherListItem[] }>;
  createStaff(actorId: string, input: { name: string; email: string }): Promise<{ id: string; email: string; temporaryPassword: string }>;
  changeStaffStatus(actorId: string, id: string, status: AccountStatus): Promise<{ id: string; status: AccountStatus }>;
  requestAccountPasswordReset(actorId: string, id: string): Promise<{ id: string }>;
  catalog(): Promise<{ courses: Array<{ id: string; name: string }>; teachers: Array<{ id: string; name: string; email: string }> }>;
  subjects(year?: number): Promise<{ currentAcademicYear: number; items: SubjectListItem[] }>;
  createSubject(actorId: string, input: SubjectInput): Promise<{ id: string }>;
  updateSubject(actorId: string, id: string, input: SubjectInput): Promise<{ id: string }>;
};

const asNumber = (value: unknown) => typeof value === "number" ? value : Number(value);
const asBoolean = (value: unknown) => value === 1 || value === true;
const isStatus = (value: string): value is StudentStatus => ["enrolled", "suspended", "withdrawn", "graduated"].includes(value);
const isAccountStatus = (value: string): value is AccountStatus => ["active", "leave", "retired"].includes(value);
const studentStatusFromDb = (value: unknown): StudentStatus => { if (typeof value === "string" && isStatus(value)) return value; throw new Error("Unexpected student status from database"); };
const accountStatusFromDb = (value: unknown): AccountStatus => { if (typeof value === "string" && isAccountStatus(value)) return value; throw new Error("Unexpected account status from database"); };
const now = () => Math.floor(Date.now() / 1000);
const normalized = (value: string) => value.trim();
const optional = (value: string | null | undefined) => value?.trim() || null;
const accountLabel = (role: ManagedAccountRole) => role === "teacher" ? "講師" : "専任職員";
const accountCode = (role: ManagedAccountRole, teacherCode: string, staffCode: string) => role === "teacher" ? teacherCode : staffCode;

export const validateYear = (year: number) => {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new AdminDomainError("INVALID_ACADEMIC_YEAR", "年度は4桁で指定してください。");
  return year;
};

export const validateStudent = (input: StudentInput) => {
  const studentNumber = normalized(input.studentNumber);
  if (!studentNumber || studentNumber.length > 64) throw new AdminDomainError("INVALID_STUDENT_NUMBER", "学籍番号を正しく入力してください。");
  if (!normalized(input.name) || !normalized(input.nameKana)) throw new AdminDomainError("INVALID_STUDENT", "氏名と氏名カナを入力してください。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) throw new AdminDomainError("INVALID_BIRTH_DATE", "生年月日を正しく入力してください。");
  if (!normalized(input.gender) || !normalized(input.courseId)) throw new AdminDomainError("INVALID_STUDENT", "性別とコースを入力してください。");
  validateYear(input.enrollmentYear);
  return { ...input, studentNumber, name: normalized(input.name), nameKana: normalized(input.nameKana), gender: normalized(input.gender), courseId: normalized(input.courseId), email: optional(input.email), phone: optional(input.phone), postalCode: optional(input.postalCode), address: optional(input.address) };
};

export const validateSubject = (input: SubjectInput) => {
  if (!normalized(input.name) || normalized(input.name).length > 100) throw new AdminDomainError("INVALID_SUBJECT", "科目名を正しく入力してください。");
  if (![1, 2, 3].includes(input.gradeLevel)) throw new AdminDomainError("INVALID_GRADE_LEVEL", "学年は1〜3を指定してください。");
  if (!normalized(input.teacherUserId) || input.courseIds.length === 0 || new Set(input.courseIds).size !== input.courseIds.length || input.courseIds.some((id) => !normalized(id))) throw new AdminDomainError("INVALID_COURSES", "対象コースを1つ以上、重複なく指定してください。");
  return { ...input, name: normalized(input.name), teacherUserId: normalized(input.teacherUserId), courseIds: input.courseIds.map(normalized) };
};

const temporaryPassword = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `T!${Array.from(bytes, (byte) => byte.toString(36)).join("")}a9`;
};

export class D1AdminMasterService implements AdminMasterService {
  constructor(private readonly database: D1Database, private readonly newId: () => string = () => createWorkerId(), private readonly passwordHash: (password: string) => Promise<string> = hashPassword, private readonly password: () => string = temporaryPassword, private readonly clock: Clock = () => new Date(), private readonly requestPasswordReset?: PasswordResetRequester) {}
  private async first<T extends SqlRow>(statement: D1PreparedStatement) { return (await statement.first<T>()) ?? null; }
  private async rows<T extends SqlRow>(statement: D1PreparedStatement) { return (await statement.all<T>()).results ?? []; }
  private async currentYear() {
    return ensureCurrentAcademicYear(this.database, this.clock);
  }
  private audit(actor: string, action: string, type: string, id: string, academicYear: number | null, payload: Record<string, unknown>) {
    return this.database.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, academic_year, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(this.newId(), actor, action, type, id, academicYear, JSON.stringify(payload));
  }
  async years() {
    await this.currentYear();
    const rows = await this.rows<{ year: number; is_current: number; selected_at: number | null }>(this.database.prepare("SELECT year, is_current, selected_at FROM academic_years ORDER BY year DESC"));
    return { years: rows.map((row) => ({ year: asNumber(row.year), isCurrent: asBoolean(row.is_current), selectedAt: row.selected_at == null ? null : asNumber(row.selected_at) })) };
  }
  async selectCurrentYear(actorId: string, year: number) {
    validateYear(year);
    const current = await this.first<{ year: number }>(this.database.prepare("SELECT year FROM academic_years WHERE is_current = 1 LIMIT 1"));
    if (current && asNumber(current.year) === year) return { year, isCurrent: true as const, alreadySelected: true };
    const timestamp = now();
    await this.database.batch([
      this.database.prepare("UPDATE academic_years SET is_current = 0, updated_at = ? WHERE is_current = 1").bind(timestamp),
      this.database.prepare("INSERT INTO academic_years (year, is_current, selected_by_user_id, selected_at, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(year) DO UPDATE SET is_current = 1, selected_by_user_id = excluded.selected_by_user_id, selected_at = excluded.selected_at, updated_at = excluded.updated_at").bind(year, actorId, timestamp, timestamp, timestamp),
      this.audit(actorId, "academic_year_selected", "academic_year", String(year), year, { year }),
    ]);
    return { year, isCurrent: true as const, alreadySelected: false };
  }
  async students(query: { page: number; pageSize: number; search?: string; courseId?: string; enrollmentYear?: number; gradeLevel?: number; status?: StudentStatus }) {
    const currentAcademicYear = await this.currentYear();
    const clauses: string[] = ["1 = 1"]; const values: unknown[] = [];
    if (query.search) { clauses.push("(s.name LIKE ? OR s.student_number LIKE ?)"); values.push(`%${query.search.trim()}%`, `%${query.search.trim()}%`); }
    if (query.courseId) { clauses.push("s.course_id = ?"); values.push(query.courseId); }
    if (query.enrollmentYear) { clauses.push("s.enrollment_year = ?"); values.push(query.enrollmentYear); }
    if (query.gradeLevel) { clauses.push("? - s.enrollment_year + 1 = ?"); values.push(currentAcademicYear, query.gradeLevel); }
    if (query.status) { clauses.push("s.status = ?"); values.push(query.status); }
    const where = clauses.join(" AND ");
    const total = await this.first<{ count: number }>(this.database.prepare(`SELECT count(*) AS count FROM students s WHERE ${where}`).bind(...values));
    const page = Math.max(1, query.page); const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const rows = await this.rows<SqlRow>(this.database.prepare(`SELECT s.id, s.student_number AS studentNumber, s.name, s.name_kana AS nameKana, s.birth_date AS birthDate, s.gender, s.email, s.phone, s.postal_code AS postalCode, s.address, s.course_id AS courseId, c.name AS courseName, s.enrollment_year AS enrollmentYear, s.status, s.status_effective_academic_year AS statusEffectiveAcademicYear, ? - s.enrollment_year + 1 AS gradeLevel FROM students s JOIN courses c ON c.id = s.course_id WHERE ${where} ORDER BY s.student_number LIMIT ? OFFSET ?`).bind(currentAcademicYear, ...values, pageSize, (page - 1) * pageSize));
    return { currentAcademicYear, total: asNumber(total?.count ?? 0), items: rows.map((row) => ({ id: String(row.id), studentNumber: String(row.studentNumber), name: String(row.name), nameKana: String(row.nameKana), birthDate: String(row.birthDate), gender: String(row.gender), email: row.email == null ? null : String(row.email), phone: row.phone == null ? null : String(row.phone), postalCode: row.postalCode == null ? null : String(row.postalCode), address: row.address == null ? null : String(row.address), courseId: String(row.courseId), courseName: String(row.courseName), enrollmentYear: asNumber(row.enrollmentYear), status: studentStatusFromDb(row.status), statusEffectiveAcademicYear: row.statusEffectiveAcademicYear == null ? null : asNumber(row.statusEffectiveAcademicYear), gradeLevel: asNumber(row.gradeLevel) })) };
  }
  private async courseExists(courseId: string) { return Boolean(await this.first(this.database.prepare("SELECT id FROM courses WHERE id = ? LIMIT 1").bind(courseId))); }
  async createStudent(actorId: string, input: StudentInput) {
    const value = validateStudent(input); if (!await this.courseExists(value.courseId)) throw new AdminDomainError("COURSE_NOT_FOUND", "コースが見つかりません。", 404);
    const id = this.newId(); const timestamp = now();
    try { await this.database.batch([
      this.database.prepare("INSERT INTO students (id, student_number, name, name_kana, birth_date, gender, email, phone, postal_code, address, course_id, enrollment_year, status, status_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enrolled', ?, ?, ?)").bind(id, value.studentNumber, value.name, value.nameKana, value.birthDate, value.gender, value.email, value.phone, value.postalCode, value.address, value.courseId, value.enrollmentYear, timestamp, timestamp, timestamp),
      this.audit(actorId, "student_created", "student", id, value.enrollmentYear, { studentNumber: value.studentNumber }),
    ]); } catch (error) { if (String(error).includes("UNIQUE constraint failed: students.student_number")) throw new AdminDomainError("DUPLICATE_STUDENT_NUMBER", "この学籍番号は既に登録されています。", 409); throw error; }
    return { id };
  }
  async updateStudent(actorId: string, id: string, input: StudentInput) {
    const value = validateStudent(input); if (!await this.courseExists(value.courseId)) throw new AdminDomainError("COURSE_NOT_FOUND", "コースが見つかりません。", 404);
    try { const result = await this.database.batch([
      this.database.prepare("UPDATE students SET student_number=?, name=?, name_kana=?, birth_date=?, gender=?, email=?, phone=?, postal_code=?, address=?, course_id=?, enrollment_year=?, updated_at=? WHERE id=?").bind(value.studentNumber, value.name, value.nameKana, value.birthDate, value.gender, value.email, value.phone, value.postalCode, value.address, value.courseId, value.enrollmentYear, now(), id),
      this.database.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, academic_year, payload_json) SELECT ?, ?, 'student_updated', 'student', ?, enrollment_year, ? FROM students WHERE id=? AND changes() = 1").bind(this.newId(), actorId, id, JSON.stringify({ studentNumber: value.studentNumber }), id),
    ]); if ((result[0] as { meta: { changes: number } }).meta.changes !== 1) throw new AdminDomainError("STUDENT_NOT_FOUND", "学生が見つかりません。", 404); } catch (error) { if (String(error).includes("UNIQUE constraint failed: students.student_number")) throw new AdminDomainError("DUPLICATE_STUDENT_NUMBER", "この学籍番号は既に登録されています。", 409); throw error; }
    return { id };
  }
  async changeStudentStatus(actorId: string, id: string, status: StudentStatus, effectiveAcademicYear: number, reason: string) {
    if (!isStatus(status) || !normalized(reason)) throw new AdminDomainError("INVALID_STATUS_CHANGE", "在籍状態・適用年度・理由を入力してください。");
    validateYear(effectiveAcademicYear);
    const timestamp = now(); const result = await this.database.batch([
      this.database.prepare("UPDATE students SET status=?, status_effective_academic_year=?, status_changed_at=?, status_changed_by_user_id=?, updated_at=? WHERE id=?").bind(status, effectiveAcademicYear, timestamp, actorId, timestamp, id),
      this.database.prepare("INSERT INTO student_status_history (id, student_id, status, effective_academic_year, changed_at, changed_by_user_id, reason) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(this.newId(), id, status, effectiveAcademicYear, timestamp, actorId, normalized(reason)),
      this.database.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, academic_year, payload_json) SELECT ?, ?, 'student_status_changed', 'student', ?, ?, ? WHERE changes() = 1").bind(this.newId(), actorId, id, effectiveAcademicYear, JSON.stringify({ status, effectiveAcademicYear })),
    ]); if ((result[0] as { meta: { changes: number } }).meta.changes !== 1) throw new AdminDomainError("STUDENT_NOT_FOUND", "学生が見つかりません。", 404); return { id, status };
  }
  async teachers(query: { search?: string; status?: AccountStatus }) {
    return this.accounts("teacher", query);
  }
  async staff(query: { search?: string; status?: AccountStatus }) {
    return this.accounts("admin", query);
  }
  private async accounts(role: ManagedAccountRole, query: { search?: string; status?: AccountStatus }) {
    const clauses = ["role = ?"]; const values: unknown[] = [role]; if (query.search) { clauses.push("(name LIKE ? OR email LIKE ?)"); values.push(`%${query.search.trim()}%`, `%${query.search.trim()}%`); } if (query.status) { clauses.push("status = ?"); values.push(query.status); }
    const rows = await this.rows<SqlRow>(this.database.prepare(`SELECT id, name, email, status, must_change_password AS mustChangePassword, created_at AS createdAt FROM user WHERE ${clauses.join(" AND ")} ORDER BY name, email`).bind(...values)); return { items: rows.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), status: accountStatusFromDb(row.status), mustChangePassword: asBoolean(row.mustChangePassword), createdAt: asNumber(row.createdAt) })) };
  }
  async createTeacher(actorId: string, input: { name: string; email: string }) {
    return this.createAccount(actorId, input, "teacher");
  }
  async createStaff(actorId: string, input: { name: string; email: string }) {
    return this.createAccount(actorId, input, "admin");
  }
  private async createAccount(actorId: string, input: { name: string; email: string }, role: ManagedAccountRole) {
    const name = normalized(input.name); const email = normalized(input.email).toLowerCase(); if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AdminDomainError(accountCode(role, "INVALID_TEACHER", "INVALID_STAFF"), `${accountLabel(role)}の氏名とメールアドレスを正しく入力してください。`);
    const id = this.newId(); const accountId = this.newId(); const password = this.password(); const passwordHash = await this.passwordHash(password); const timestamp = now();
    const cap = ACCOUNT_CAPS[role]; const action = role === "teacher" ? "teacher_created" : "staff_created";
    try { const result = await this.database.batch([
      this.database.prepare("INSERT INTO user (id, name, email, role, status, must_change_password, created_at, updated_at) SELECT ?, ?, ?, ?, 'active', 1, ?, ? WHERE (SELECT count(*) FROM user WHERE role=? AND status!='retired') < ?").bind(id, name, email, role, timestamp, timestamp, role, cap),
      this.database.prepare("INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) SELECT ?, ?, 'credential', ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM user WHERE id=?)").bind(accountId, id, id, passwordHash, timestamp, timestamp, id),
      this.database.prepare("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) SELECT ?,?,?, 'user', ?,NULL,? WHERE EXISTS(SELECT 1 FROM user WHERE id=?)").bind(this.newId(), actorId, action, id, JSON.stringify({ role }), id),
    ]); if ((result[0] as { meta: { changes: number } }).meta.changes !== 1) throw new AdminDomainError("ACCOUNT_CAP_REACHED", `${accountLabel(role)}は${cap}名まで登録できます。`, 409); } catch (error) { if (String(error).includes("UNIQUE constraint failed: user.email")) throw new AdminDomainError(accountCode(role, "DUPLICATE_TEACHER_EMAIL", "DUPLICATE_STAFF_EMAIL"), "このメールアドレスは既に登録されています。", 409); throw error; }
    return { id, email, temporaryPassword: password };
  }
  async changeTeacherStatus(actorId: string, id: string, status: AccountStatus) {
    return this.changeAccountStatus(actorId, id, status, "teacher");
  }
  async changeStaffStatus(actorId: string, id: string, status: AccountStatus) {
    return this.changeAccountStatus(actorId, id, status, "admin");
  }
  async requestAccountPasswordReset(actorId: string, id: string) {
    const account = await this.first<{ email: string; role: string; status: string }>(this.database.prepare("SELECT email, role, status FROM user WHERE id=? AND role IN ('admin','teacher') LIMIT 1").bind(id));
    if (!account) throw new AdminDomainError("ACCOUNT_NOT_FOUND", "アカウントが見つかりません。", 404);
    if (account.status === "retired") throw new AdminDomainError("ACCOUNT_RETIRED", "退職済みのアカウントには再設定メールを送信できません。", 409);
    if (!this.requestPasswordReset) throw new AdminDomainError("PASSWORD_RESET_UNAVAILABLE", "パスワード再設定メールを現在送信できません。", 503);
    try {
      await this.requestPasswordReset(account.email);
    } catch {
      throw new AdminDomainError("PASSWORD_RESET_UNAVAILABLE", "パスワード再設定メールを現在送信できません。", 503);
    }
    const role = account.role === "admin" ? "admin" : "teacher";
    await this.database.batch([this.audit(actorId, "password_reset_requested", "user", id, null, { role })]);
    return { id };
  }
  private async changeAccountStatus(actorId: string, id: string, status: AccountStatus, role: ManagedAccountRole) {
    if (!isAccountStatus(status)) throw new AdminDomainError(accountCode(role, "INVALID_TEACHER_STATUS", "INVALID_STAFF_STATUS"), `${accountLabel(role)}の状態を正しく指定してください。`);
    const existing = await this.first<{ status: string }>(this.database.prepare("SELECT status FROM user WHERE id=? AND role=? LIMIT 1").bind(id, role));
    if (!existing) throw new AdminDomainError(accountCode(role, "TEACHER_NOT_FOUND", "STAFF_NOT_FOUND"), `${accountLabel(role)}が見つかりません。`, 404);
    if (role === "admin" && actorId === id && status !== "active") throw new AdminDomainError("SELF_STATUS_CHANGE_FORBIDDEN", "自分の利用状態は停止できません。", 409);
    if (role === "admin" && existing.status === "active" && status !== "active") {
      const active = await this.first<{ count: number }>(this.database.prepare("SELECT count(*) AS count FROM user WHERE role='admin' AND status='active'"));
      if (asNumber(active?.count ?? 0) <= 1) throw new AdminDomainError("LAST_ACTIVE_ADMIN", "有効な専任職員を0名にはできません。", 409);
    }
    const cap = ACCOUNT_CAPS[role]; const action = role === "teacher" ? "teacher_status_changed" : "staff_status_changed"; const timestamp = now();
    const result = await this.database.batch([
      this.database.prepare("UPDATE user SET status=?, updated_at=? WHERE id=? AND role=? AND (status!='retired' OR ?='retired' OR (SELECT count(*) FROM user WHERE role=? AND status!='retired') < ?) AND NOT (?='admin' AND id=? AND ?!='active') AND NOT (?='admin' AND status='active' AND ?!='active' AND (SELECT count(*) FROM user WHERE role='admin' AND status='active')<=1)").bind(status, timestamp, id, role, status, role, cap, role, actorId, status, role, status),
      this.database.prepare("INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, academic_year, payload_json) SELECT ?, ?, ?, 'user', ?, NULL, ? WHERE changes() = 1").bind(this.newId(), actorId, action, id, JSON.stringify({ status, role })),
      ...(status === "active" ? [] : [this.database.prepare("DELETE FROM session WHERE user_id = ?").bind(id)]),
    ]); if ((result[0] as { meta: { changes: number } }).meta.changes !== 1) {
      const current = await this.first<{ status: string }>(this.database.prepare("SELECT status FROM user WHERE id=? AND role=? LIMIT 1").bind(id, role));
      if (!current) throw new AdminDomainError(accountCode(role, "TEACHER_NOT_FOUND", "STAFF_NOT_FOUND"), `${accountLabel(role)}が見つかりません。`, 404);
      if (current.status === "retired" && status !== "retired") throw new AdminDomainError("ACCOUNT_CAP_REACHED", `${accountLabel(role)}は${cap}名まで登録できます。`, 409);
      if (role === "admin" && current.status === "active" && status !== "active") throw new AdminDomainError("LAST_ACTIVE_ADMIN", "有効な専任職員を0名にはできません。", 409);
      throw new AdminDomainError("ACCOUNT_STATUS_CONFLICT", "利用状態を更新できません。時間をおいてもう一度お試しください。", 409);
    } return { id, status };
  }
  async catalog() {
    const [courses, teachers] = await Promise.all([
      this.rows<{ id: string; name: string }>(this.database.prepare("SELECT id, name FROM courses ORDER BY name")),
      this.rows<{ id: string; name: string; email: string }>(this.database.prepare("SELECT id, name, email FROM user WHERE role='teacher' AND status='active' ORDER BY name, email")),
    ]); return { courses, teachers };
  }
  async subjects(requestedYear?: number) {
    const currentAcademicYear = await this.currentYear(); const year = requestedYear ?? currentAcademicYear; validateYear(year);
    const rows = await this.rows<SqlRow>(this.database.prepare("SELECT s.id, s.name, s.academic_year AS academicYear, s.grade_level AS gradeLevel, s.teacher_user_id AS teacherUserId, u.name AS teacherName, group_concat(sc.course_id) AS courseIds, max(CASE WHEN st.is_finalized = 1 THEN 1 ELSE 0 END) AS hasFinalizedTerm FROM subjects s JOIN user u ON u.id=s.teacher_user_id LEFT JOIN subject_courses sc ON sc.subject_id=s.id LEFT JOIN subject_term_statuses st ON st.subject_id=s.id WHERE s.academic_year=? GROUP BY s.id ORDER BY s.grade_level, s.name").bind(year));
    return { currentAcademicYear, items: rows.map((row) => ({ id: String(row.id), name: String(row.name), academicYear: asNumber(row.academicYear), gradeLevel: asNumber(row.gradeLevel), teacherUserId: String(row.teacherUserId), teacherName: String(row.teacherName), courseIds: typeof row.courseIds === "string" ? row.courseIds.split(",") : [], hasFinalizedTerm: asBoolean(row.hasFinalizedTerm) })) };
  }
  private async assertSubjectReferences(input: ReturnType<typeof validateSubject>) {
    const teacher = await this.first(this.database.prepare("SELECT id FROM user WHERE id=? AND role='teacher' AND status='active'").bind(input.teacherUserId)); if (!teacher) throw new AdminDomainError("TEACHER_NOT_FOUND", "有効な講師を指定してください。", 404);
    const rows = await this.rows<{ id: string }>(this.database.prepare(`SELECT id FROM courses WHERE id IN (${input.courseIds.map(() => "?").join(",")})`).bind(...input.courseIds)); if (rows.length !== input.courseIds.length) throw new AdminDomainError("COURSE_NOT_FOUND", "対象コースが見つかりません。", 404);
  }
  async createSubject(actorId: string, input: SubjectInput) {
    const value = validateSubject(input); const year = value.academicYear ?? await this.currentYear(); validateYear(year); if (year !== await this.currentYear()) throw new AdminDomainError("SUBJECT_YEAR_NOT_CURRENT", "科目は現在年度にのみ登録できます。", 409); await this.assertSubjectReferences(value);
    const id = this.newId(); const timestamp = now(); try { await this.database.batch([
      this.database.prepare("INSERT INTO subjects (id, academic_year, name, grade_level, teacher_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, year, value.name, value.gradeLevel, value.teacherUserId, timestamp, timestamp),
      ...value.courseIds.map((courseId) => this.database.prepare("INSERT INTO subject_courses (subject_id, course_id) VALUES (?, ?)").bind(id, courseId)),
      ...([1, 2] as const).map((term) => this.database.prepare("INSERT INTO subject_term_statuses (subject_id, term, is_finalized, created_at, updated_at) VALUES (?, ?, 0, ?, ?)").bind(id, term, timestamp, timestamp)),
      this.audit(actorId, "subject_created", "subject", id, year, { academicYear: year, courseIds: value.courseIds }),
    ]); } catch (error) { if (String(error).includes("UNIQUE constraint failed: subjects.academic_year, subjects.name, subjects.grade_level")) throw new AdminDomainError("DUPLICATE_SUBJECT", "同じ年度・学年の科目名は既に登録されています。", 409); throw error; } return { id };
  }
  async updateSubject(actorId: string, id: string, input: SubjectInput) {
    const value = validateSubject(input); const current = await this.currentYear(); if (value.academicYear !== undefined && value.academicYear !== current) throw new AdminDomainError("SUBJECT_YEAR_NOT_CURRENT", "科目は現在年度にのみ変更できます。", 409); await this.assertSubjectReferences(value);
    const subject = await this.first<{ academic_year: number; has_finalized: number }>(this.database.prepare("SELECT s.academic_year, EXISTS(SELECT 1 FROM subject_term_statuses st WHERE st.subject_id=s.id AND st.is_finalized=1) AS has_finalized FROM subjects s WHERE s.id=?").bind(id)); if (!subject) throw new AdminDomainError("SUBJECT_NOT_FOUND", "科目が見つかりません。", 404); if (asNumber(subject.academic_year) !== current || asBoolean(subject.has_finalized)) throw new AdminDomainError("SUBJECT_LOCKED", "確定済みまたは過去年度の科目は変更できません。", 409);
    await this.database.batch([
      this.database.prepare("UPDATE subjects SET name=?, grade_level=?, teacher_user_id=?, updated_at=? WHERE id=?").bind(value.name, value.gradeLevel, value.teacherUserId, now(), id),
      this.database.prepare("DELETE FROM subject_courses WHERE subject_id=?").bind(id),
      ...value.courseIds.map((courseId) => this.database.prepare("INSERT INTO subject_courses (subject_id, course_id) VALUES (?, ?)").bind(id, courseId)),
      this.audit(actorId, "subject_updated", "subject", id, asNumber(subject.academic_year), { courseIds: value.courseIds }),
    ]); return { id };
  }
}

export const createAdminMasterService = (database: D1Database, requestPasswordReset?: PasswordResetRequester) => new D1AdminMasterService(database, undefined, undefined, undefined, undefined, requestPasswordReset);
export const unavailableAdminMasterService: AdminMasterService = {
  years: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  selectCurrentYear: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  students: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  createStudent: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  updateStudent: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  changeStudentStatus: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  teachers: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  createTeacher: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  changeTeacherStatus: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  staff: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  createStaff: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  changeStaffStatus: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  requestAccountPasswordReset: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  catalog: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  subjects: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  createSubject: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
  updateSubject: async () => { throw new AdminDomainError("ADMIN_SERVICE_UNAVAILABLE", "管理機能を利用できません。", 503); },
};
