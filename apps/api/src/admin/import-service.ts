import { hashPassword } from "better-auth/crypto";

import { ensureCurrentAcademicYear, type Clock } from "../academic-year";
import { createWorkerId } from "../worker-crypto";
import { AdminDomainError } from "./service";
import { parseImport, type ImportInput, type ImportRowError } from "./imports";

type ExistingUser = { id: string; name: string; email: string; role: "teacher" | "admin"; status: string };
type ExistingStudent = { id: string; studentNumber: string; email: string | null; enrollmentYear: number };
type ExistingSubject = { id: string; name: string; gradeLevel: number; teacherUserId: string; locked: number };
type Course = { id: string; name: string };

export type ImportPreview = {
  token?: string;
  academicYear: number;
  expiresAt?: number;
  counts: { students: number; teachers: number; staff: number; subjects: Record<1 | 2 | 3, number> };
  errors: ImportRowError[];
};
export type OneTimeCredential = { name: string; email: string; role: "teacher" | "admin"; temporaryPassword: string };
export type ImportApplyResult = {
  applied: true;
  replayed: boolean;
  credentialsAlreadyIssued: boolean;
  summary: ImportPreview["counts"];
  credentials: OneTimeCredential[];
};
export type NormalImportService = {
  preview(actorId: string, input: ImportInput): Promise<ImportPreview>;
  apply(actorId: string, input: { token: string; idempotencyKey: string }): Promise<ImportApplyResult>;
};

const MAX_KEY_LENGTH = 128;
const TTL_SECONDS = 15 * 60;
const courseNames = { "システムエンジニア": "system-engineer", "Webデザイナー": "web-designer" } as const;
const timestamp = () => Math.floor(Date.now() / 1000);
const stable = (input: ImportInput) => JSON.stringify({ academicYear: input.academicYear, kind: input.kind, gradeLevel: input.gradeLevel, csv: input.csv });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const utf8 = (value: string) => new TextEncoder().encode(value).byteLength;
const isSnapshotToken = (value: string) => /^[A-Za-z0-9-]{16,128}$/.test(value);
const idempotencyKey = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const password = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `T!${Array.from(bytes, (value) => value.toString(36)).join("")}a9`;
};

const failure = (code: string, message: string, status: 400 | 403 | 404 | 409 | 410 | 413 | 503 = 400) => new AdminDomainError(code, message, status);
const json = (value: unknown, label: string) => {
  const result = JSON.stringify(value);
  if (utf8(result) > 500_000) throw failure("IMPORT_PAYLOAD_TOO_LARGE", `${label}の内容が大きすぎます。CSVの合計は600KB以下にしてください。`, 413);
  return result;
};

export class D1NormalImportService implements NormalImportService {
  constructor(private readonly database: D1Database, private readonly newId: () => string = () => createWorkerId(), private readonly passwordHash: (value: string) => Promise<string> = hashPassword, private readonly createPassword: () => string = password, private readonly clock: Clock = () => new Date()) {}
  private async first<T extends Record<string, unknown>>(statement: D1PreparedStatement) { return (await statement.first<T>()) ?? null; }
  private async rows<T extends Record<string, unknown>>(statement: D1PreparedStatement) { return (await statement.all<T>()).results ?? []; }
  private async currentYear() {
    return ensureCurrentAcademicYear(this.database, this.clock);
  }
  private counts(input: ReturnType<typeof parseImport>) { return { students: input.students.length, teachers: input.teachers.length, staff: input.staff.length, subjects: { 1: input.subjects.filter((item) => item.gradeLevel === 1).length, 2: input.subjects.filter((item) => item.gradeLevel === 2).length, 3: input.subjects.filter((item) => item.gradeLevel === 3).length } as Record<1 | 2 | 3, number> }; }
  private in(values: string[]) { return values.length ? values.map(() => "?").join(",") : "NULL"; }
  private async validate(input: ImportInput) {
    if (input.academicYear !== await this.currentYear()) throw failure("IMPORT_YEAR_NOT_CURRENT", "通常CSV取込は現在年度を指定してください。", 409);
    const parsed = parseImport(input);
    const userInputs = [...parsed.teachers, ...parsed.staff];
    const [users, students, courses, subjects, activeTeachers, accountCounts] = await Promise.all([
      this.rows<ExistingUser>(this.database.prepare(`SELECT id,name,email,role,status FROM user WHERE email IN (${this.in(userInputs.map((item) => item.email))})`).bind(...userInputs.map((item) => item.email))),
      this.rows<ExistingStudent>(this.database.prepare(`SELECT id,student_number AS studentNumber,email,enrollment_year AS enrollmentYear FROM students WHERE student_number IN (${this.in(parsed.students.map((item) => item.studentNumber))}) OR email IN (${this.in(parsed.students.map((item) => item.email))})`).bind(...parsed.students.map((item) => item.studentNumber), ...parsed.students.map((item) => item.email))),
      this.rows<Course>(this.database.prepare("SELECT id,name FROM courses")),
      this.rows<ExistingSubject>(this.database.prepare("SELECT s.id,s.name,s.grade_level AS gradeLevel,s.teacher_user_id AS teacherUserId,EXISTS(SELECT 1 FROM subject_term_statuses st WHERE st.subject_id=s.id AND st.is_finalized=1) OR EXISTS(SELECT 1 FROM grades g WHERE g.subject_id=s.id) AS locked FROM subjects s WHERE s.academic_year=?").bind(input.academicYear)),
      this.rows<ExistingUser>(this.database.prepare("SELECT id,name,email,role,status FROM user WHERE role='teacher' AND status='active'")),
      this.rows<{ role: "teacher" | "admin"; count: number }>(this.database.prepare("SELECT role,count(*) AS count FROM user WHERE role IN ('teacher','admin') AND status!='retired' GROUP BY role")),
    ]);
    const courseByName = new Map(courses.map((course) => [course.name, course.id]));
    if (!courseByName.has("システムエンジニア") || !courseByName.has("Webデザイナー")) parsed.errors.push({ file: "取込設定", row: 0, field: "コース", reason: "必要なコースが見つかりません。" });
    const userByEmail = new Map(users.map((item) => [item.email, item]));
    for (const item of userInputs) {
      const existing = userByEmail.get(item.email);
      const file = item.role === "teacher" ? "講師CSV" : "専任職員CSV";
      if (existing && existing.role !== item.role) parsed.errors.push({ file, row: item.row, field: "メールアドレス", reason: "既存利用者の権限と一致しません。" });
      // 通常CSVでは既存アカウントを暗黙に再有効化しない。明示的な状態変更を
      // 専任職員の管理画面に限定し、停止・休職中のアカウントの資格情報を更新しない。
      if (existing && existing.status !== "active") parsed.errors.push({ file, row: item.row, field: "メールアドレス", reason: `利用停止中の${item.role === "teacher" ? "講師" : "専任職員"}はCSV取込できません。` });
    }
    const nonRetiredByRole = new Map(accountCounts.map((item) => [item.role, Number(item.count)]));
    for (const role of ["teacher", "admin"] as const) {
      const additions = userInputs.filter((item) => item.role === role && !userByEmail.has(item.email)).length;
      const limit = role === "teacher" ? 30 : 3;
      if ((nonRetiredByRole.get(role) ?? 0) + additions > limit) parsed.errors.push({ file: role === "teacher" ? "講師CSV" : "専任職員CSV", row: 0, field: "件数", reason: `${role === "teacher" ? "講師" : "専任職員"}の登録上限を超えます。` });
    }
    const studentByNumber = new Map(students.map((item) => [item.studentNumber, item]));
    const studentByEmail = new Map(students.filter((item) => item.email).map((item) => [item.email!.toLowerCase(), item]));
    for (const item of parsed.students) {
      const match = studentByEmail.get(item.email);
      if (match && match.studentNumber !== item.studentNumber) parsed.errors.push({ file: "学生CSV", row: item.row, field: "メールアドレス", reason: "別の学籍番号に登録済みのメールアドレスです。" });
      const number = studentByNumber.get(item.studentNumber);
      if (number && number.email && number.email.toLowerCase() !== item.email) parsed.errors.push({ file: "学生CSV", row: item.row, field: "メールアドレス", reason: "既存の学籍番号に登録されたメールアドレスと一致しません。" });
      if (number && number.enrollmentYear > input.academicYear) parsed.errors.push({ file: "学生CSV", row: item.row, field: "学籍番号", reason: "在籍年度が不正な既存学生です。" });
    }
    const candidateByName = new Map<string, Set<string>>();
    for (const teacher of activeTeachers) { const set = candidateByName.get(teacher.name) ?? new Set<string>(); set.add(teacher.id); candidateByName.set(teacher.name, set); }
    for (const teacher of parsed.teachers) { const existing = userByEmail.get(teacher.email); if (existing && existing.status !== "active") continue; const id = existing?.id ?? `new:${teacher.email}`; const set = candidateByName.get(teacher.name) ?? new Set<string>(); set.add(id); candidateByName.set(teacher.name, set); }
    for (const subject of parsed.subjects) if ((candidateByName.get(subject.teacherName)?.size ?? 0) !== 1) parsed.errors.push({ file: `${subject.gradeLevel}年科目CSV`, row: subject.row, field: "担当講師", reason: "担当講師名が一意に決まりません。メールアドレスを確認してください。" });
    const subjectByKey = new Map(subjects.map((item) => [`${item.gradeLevel}:${item.name}`, item]));
    for (const item of parsed.subjects) { const existing = subjectByKey.get(`${item.gradeLevel}:${item.name}`); if (existing?.locked) parsed.errors.push({ file: `${item.gradeLevel}年科目CSV`, row: item.row, field: "科目名", reason: "確定済みまたは成績登録済みの科目は更新できません。" }); }
    return { parsed, users, students, courses, subjects, activeTeachers, courseByName, userByEmail, studentByNumber, candidateByName };
  }
  async preview(actorId: string, input: ImportInput): Promise<ImportPreview> {
    const state = await this.validate(input); const counts = this.counts(state.parsed);
    if (state.parsed.errors.length) return { academicYear: input.academicYear, counts, errors: state.parsed.errors };
    const createdAt = timestamp(); const expiresAt = createdAt + TTL_SECONDS; const token = this.newId(); const payload = stable(input); const payloadHash = await sha256(payload);
    await this.database.batch([
      this.database.prepare("DELETE FROM import_snapshots WHERE expires_at < ?").bind(createdAt),
      this.database.prepare("INSERT INTO import_snapshots (id,owner_user_id,academic_year,payload_json,payload_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(token, actorId, input.academicYear, payload, payloadHash, expiresAt, createdAt),
    ]);
    return { token, academicYear: input.academicYear, expiresAt, counts, errors: [] };
  }
  async apply(actorId: string, request: { token: string; idempotencyKey: string }): Promise<ImportApplyResult> {
    if (!isSnapshotToken(request.token)) throw failure("INVALID_IMPORT_TOKEN", "取込確認が見つかりません。もう一度内容を確認してください。");
    if (!idempotencyKey(request.idempotencyKey)) throw failure("INVALID_IDEMPOTENCY_KEY", "再実行キーを正しく指定してください。");
    const now = timestamp();
    const readable = await this.first<{ ownerUserId: string; payloadHash: string }>(this.database.prepare("SELECT owner_user_id AS ownerUserId,payload_hash AS payloadHash FROM import_snapshots WHERE id=?").bind(request.token));
    const existing = await this.first<{ createdByUserId: string | null; payloadHash: string; status: string; resultJson: string | null }>(this.database.prepare("SELECT created_by_user_id AS createdByUserId,payload_hash AS payloadHash,status,result_json AS resultJson FROM idempotency_operations WHERE idempotency_key=?").bind(request.idempotencyKey));
    if (existing) {
      if (existing.createdByUserId !== actorId) throw failure("IMPORT_SNAPSHOT_NOT_FOUND", "取込確認が見つかりません。もう一度内容を確認してください。", 404);
      if (readable && readable.ownerUserId !== actorId) throw failure("IMPORT_SNAPSHOT_NOT_FOUND", "取込確認が見つかりません。もう一度内容を確認してください。", 404);
      if (readable && existing.payloadHash !== readable.payloadHash) throw failure("IDEMPOTENCY_KEY_CONFLICT", "同じ再実行キーに異なる内容は使用できません。", 409);
      if (existing.status === "succeeded" && existing.resultJson) {
        const result = JSON.parse(existing.resultJson) as { summary: ImportPreview["counts"] };
        return { applied: true, replayed: true, credentialsAlreadyIssued: true, summary: result.summary, credentials: [] };
      }
      throw failure("IMPORT_IN_PROGRESS", "CSV取込を処理中です。", 409);
    }
    if (!readable || readable.ownerUserId !== actorId) throw failure("IMPORT_SNAPSHOT_NOT_FOUND", "取込確認が見つかりません。もう一度内容を確認してください。", 404);
    const claimId = this.newId();
    const snapshot = await this.first<{ payloadJson: string; payloadHash: string; academicYear: number }>(this.database.prepare("UPDATE import_snapshots SET claim_id=?,claimed_at=? WHERE id=? AND owner_user_id=? AND expires_at>=? AND claim_id IS NULL RETURNING payload_json AS payloadJson,payload_hash AS payloadHash,academic_year AS academicYear").bind(claimId, now, request.token, actorId, now));
    if (!snapshot) {
      const result = await this.first<{ createdByUserId: string | null; payloadHash: string; status: string; resultJson: string | null }>(this.database.prepare("SELECT created_by_user_id AS createdByUserId,payload_hash AS payloadHash,status,result_json AS resultJson FROM idempotency_operations WHERE idempotency_key=?").bind(request.idempotencyKey));
      if (result?.createdByUserId === actorId && result.payloadHash === readable.payloadHash && result.status === "succeeded" && result.resultJson) return { applied: true, replayed: true, credentialsAlreadyIssued: true, summary: (JSON.parse(result.resultJson) as { summary: ImportPreview["counts"] }).summary, credentials: [] };
      throw failure("IMPORT_SNAPSHOT_EXPIRED", "取込確認が期限切れまたは使用済みです。もう一度内容を確認してください。", 410);
    }
    try {
      const input = JSON.parse(snapshot.payloadJson) as ImportInput;
      const state = await this.validate(input);
      if (state.parsed.errors.length) throw failure("IMPORT_VALIDATION_FAILED", "CSVの内容が変更されています。もう一度確認してください。", 409);
      const counts = this.counts(state.parsed);
      const unknown = [...state.parsed.teachers, ...state.parsed.staff].filter((item) => !state.userByEmail.has(item.email));
      const credentials = await Promise.all(unknown.map(async (item) => { const temporaryPassword = this.createPassword(); return { id: this.newId(), accountId: this.newId(), name: item.name, email: item.email, role: item.role, temporaryPassword, passwordHash: await this.passwordHash(temporaryPassword) }; }));
      const usersJson = json([...state.parsed.teachers, ...state.parsed.staff].map((item) => { const present = state.userByEmail.get(item.email); const created = credentials.find((credential) => credential.email === item.email); return { id: present?.id ?? created?.id, accountId: created?.accountId, name: item.name, email: item.email, role: item.role, isNew: !present, passwordHash: created?.passwordHash }; }), "利用者CSV");
      const studentsJson = json(state.parsed.students.map((item) => { const present = state.studentByNumber.get(item.studentNumber); return { id: present?.id ?? this.newId(), studentNumber: item.studentNumber, name: item.name, kana: item.kana, birthDate: item.birthDate, gender: item.gender, email: item.email, phone: item.phone || null, postalCode: item.postalCode || null, address: item.address || null, courseId: state.courseByName.get(item.course) ?? "__import_course_missing__", isNew: !present }; }), "学生CSV");
      const activeByName = new Map(state.activeTeachers.map((item) => [item.name, item.id]));
      for (const teacher of state.parsed.teachers) activeByName.set(teacher.name, state.userByEmail.get(teacher.email)?.id ?? credentials.find((item) => item.email === teacher.email)?.id ?? "__import_teacher_missing__");
      const subjectByKey = new Map(state.subjects.map((item) => [`${item.gradeLevel}:${item.name}`, item]));
      const subjectsJson = json(state.parsed.subjects.map((item) => { const present = subjectByKey.get(`${item.gradeLevel}:${item.name}`); const ids = item.course === "共通" ? Object.keys(courseNames).map((name) => state.courseByName.get(name) ?? "__import_course_missing__") : [state.courseByName.get(item.course) ?? "__import_course_missing__"]; return { id: present?.id ?? this.newId(), name: item.name, gradeLevel: item.gradeLevel, teacherId: activeByName.get(item.teacherName) ?? "__import_teacher_missing__", courseIds: ids, isExisting: Boolean(present) }; }), "科目CSV");
      const operationId = this.newId(); const result = { summary: counts };
      const statements: D1PreparedStatement[] = [
        this.database.prepare("INSERT INTO idempotency_operations (id,operation_type,idempotency_key,status,academic_year,payload_hash,created_by_user_id,created_at,updated_at) VALUES (?, 'csv_import', ?, 'pending', ?, ?, COALESCE((SELECT id FROM user WHERE id=? AND EXISTS(SELECT 1 FROM academic_years WHERE year=? AND is_current=1)), '__import_current_year_changed__'), ?, ?)").bind(operationId, request.idempotencyKey, input.academicYear, snapshot.payloadHash, actorId, input.academicYear, now, now),
        this.database.prepare("INSERT INTO user (id,name,email,role,status,must_change_password,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.email'),json_extract(value,'$.role'),'active',1,?,? FROM json_each(?) WHERE json_extract(value,'$.isNew')=1 AND ((json_extract(value,'$.role')='teacher' AND (SELECT count(*) FROM user WHERE role='teacher' AND status!='retired') + (SELECT count(*) FROM json_each(?) WHERE json_extract(value,'$.isNew')=1 AND json_extract(value,'$.role')='teacher') <= 30) OR (json_extract(value,'$.role')='admin' AND (SELECT count(*) FROM user WHERE role='admin' AND status!='retired') + (SELECT count(*) FROM json_each(?) WHERE json_extract(value,'$.isNew')=1 AND json_extract(value,'$.role')='admin') <= 3))").bind(now, now, usersJson, usersJson, usersJson),
        this.database.prepare("INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) SELECT json_extract(value,'$.accountId'),json_extract(value,'$.id'),'credential',json_extract(value,'$.id'),json_extract(value,'$.passwordHash'),?,? FROM json_each(?) WHERE json_extract(value,'$.isNew')=1").bind(now, now, usersJson),
        this.database.prepare("UPDATE user SET name=(SELECT json_extract(value,'$.name') FROM json_each(?) WHERE json_extract(value,'$.email')=user.email),updated_at=? WHERE email IN (SELECT json_extract(value,'$.email') FROM json_each(?))").bind(usersJson, now, usersJson),
        this.database.prepare("INSERT INTO students (id,student_number,name,name_kana,birth_date,gender,email,phone,postal_code,address,course_id,enrollment_year,status,status_changed_at,status_changed_by_user_id,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.studentNumber'),json_extract(value,'$.name'),json_extract(value,'$.kana'),json_extract(value,'$.birthDate'),json_extract(value,'$.gender'),json_extract(value,'$.email'),json_extract(value,'$.phone'),json_extract(value,'$.postalCode'),json_extract(value,'$.address'),json_extract(value,'$.courseId'),?,'enrolled',?,?,?,? FROM json_each(?) WHERE 1 ON CONFLICT(student_number) DO UPDATE SET name=excluded.name,name_kana=excluded.name_kana,birth_date=excluded.birth_date,gender=excluded.gender,email=excluded.email,phone=excluded.phone,postal_code=excluded.postal_code,address=excluded.address,course_id=excluded.course_id,updated_at=excluded.updated_at").bind(input.academicYear, now, actorId, now, now, studentsJson),
        this.database.prepare("INSERT INTO student_status_history (id,student_id,status,effective_academic_year,changed_at,changed_by_user_id,reason) SELECT lower(hex(randomblob(16))),json_extract(value,'$.id'),'enrolled',?,?,?,'通常CSV取込による新規登録' FROM json_each(?) WHERE json_extract(value,'$.isNew')=1").bind(input.academicYear, now, actorId, studentsJson),
        this.database.prepare("INSERT INTO subjects (id,academic_year,name,grade_level,teacher_user_id,created_at,updated_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.name'),json_extract(value,'$.gradeLevel'),CASE WHEN json_extract(value,'$.isExisting')=1 AND (EXISTS(SELECT 1 FROM subject_term_statuses st WHERE st.subject_id=json_extract(value,'$.id') AND st.is_finalized=1) OR EXISTS(SELECT 1 FROM grades g WHERE g.subject_id=json_extract(value,'$.id'))) THEN NULL ELSE COALESCE((SELECT id FROM user WHERE id=json_extract(value,'$.teacherId') AND role='teacher' AND status='active'),'__import_teacher_missing__') END,?,? FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET teacher_user_id=excluded.teacher_user_id,updated_at=excluded.updated_at").bind(input.academicYear, now, now, subjectsJson),
        this.database.prepare("DELETE FROM subject_courses WHERE subject_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))").bind(subjectsJson),
        this.database.prepare("INSERT INTO subject_courses (subject_id,course_id) SELECT json_extract(subject.value,'$.id'),course.value FROM json_each(?) subject JOIN json_each(json_extract(subject.value,'$.courseIds')) course").bind(subjectsJson),
        this.database.prepare("INSERT OR IGNORE INTO subject_term_statuses (subject_id,term,is_finalized,created_at,updated_at) SELECT json_extract(value,'$.id'),term,0,?,? FROM json_each(?) CROSS JOIN (SELECT 1 AS term UNION ALL SELECT 2)").bind(now, now, subjectsJson),
        this.database.prepare("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) VALUES (?,COALESCE((SELECT id FROM user WHERE id=? AND (SELECT count(*) FROM user WHERE email IN (SELECT json_extract(value,'$.email') FROM json_each(?)))=json_array_length(?) AND (SELECT count(*) FROM students WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)))=json_array_length(?) AND (SELECT count(*) FROM subjects WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)))=json_array_length(?)), '__import_state_changed__'),'csv_imported','csv_import',?,?,?)").bind(this.newId(), actorId, usersJson, usersJson, studentsJson, studentsJson, subjectsJson, subjectsJson, operationId, input.academicYear, JSON.stringify(counts)),
        this.database.prepare("UPDATE idempotency_operations SET status='succeeded',result_json=?,completed_at=?,updated_at=? WHERE id=?").bind(JSON.stringify(result), now, now, operationId),
        this.database.prepare("DELETE FROM import_snapshots WHERE id=? AND owner_user_id=? AND claim_id=?").bind(request.token, actorId, claimId),
      ];
      await this.database.batch(statements);
      return { applied: true, replayed: false, credentialsAlreadyIssued: false, summary: counts, credentials: credentials.map(({ name, email, role, temporaryPassword }) => ({ name, email, role, temporaryPassword })) };
    } catch (error) {
      await this.database.prepare("DELETE FROM import_snapshots WHERE id=? AND owner_user_id=? AND claim_id=?").bind(request.token, actorId, claimId).run();
      if (error instanceof AdminDomainError) throw error;
      // Guard statements deliberately use a foreign-key sentinel.  A failed
      // guard has already rolled the batch back; expose a stable domain error
      // rather than leaking a SQLite/D1 constraint message.
      throw failure("IMPORT_STATE_CHANGED", "取込対象が変更されました。もう一度内容を確認してください。", 409);
    }
  }
}

export const createNormalImportService = (database: D1Database) => new D1NormalImportService(database);
export const unavailableNormalImportService: NormalImportService = {
  preview: async () => { throw failure("IMPORT_SERVICE_UNAVAILABLE", "通常CSV取込を利用できません。", 503); },
  apply: async () => { throw failure("IMPORT_SERVICE_UNAVAILABLE", "通常CSV取込を利用できません。", 503); },
};
