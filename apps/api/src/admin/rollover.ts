import { AdminDomainError, validateYear } from "./service";
import { ensureCurrentAcademicYear, type Clock } from "../academic-year";
import { createWorkerId } from "../worker-crypto";

type RowError = { file: string; row: number; field: string; reason: string };
export type CsvRow = string[] & { readonly sourceRow: number };
type TeacherRow = { name: string; kana: string; age: number; gender: "男" | "女"; email: string };
type SubjectRow = { course: "システムエンジニア" | "Webデザイナー" | "共通"; name: string; teacherName: string; gradeLevel: 1 | 2 | 3 };
type StudentRow = { studentNumber: string; name: string; kana: string; age: number; birthDate: string; gender: "男" | "女"; email: string; phone: string; postalCode: string; address: string; course: "システムエンジニア" | "Webデザイナー" };
export type RolloverInput = { targetYear: number; idempotencyKey?: string; teachersCsv: string; grade1SubjectsCsv: string; grade2SubjectsCsv: string; grade3SubjectsCsv: string; newStudentsCsv: string };
export type RolloverPreview = { targetYear: number; graduationCandidates: number; teacherCount: number; subjectCounts: Record<1 | 2 | 3, number>; studentCount: number; errors: RowError[] };

/**
 * D1 bind values have a finite size and rollover keeps every CSV in a single
 * atomic batch.  Keep the aggregate comfortably below the Worker/D1 1MB
 * request/value boundary; this still permits a 1,000-row minimal student CSV.
 */
const MAX_CSV_BYTES = 150_000; const MAX_TOTAL_CSV_BYTES = 450_000; const MAX_JSON_BIND_BYTES = 500_000;
const MAX_ROWS = 1_000; const MAX_IDEMPOTENCY_KEY = 128;
const courses = { "システムエンジニア": "system-engineer", "Webデザイナー": "web-designer" } as const;
const headers = {
  teachers: ["氏名", "ひらがな", "年齢", "性別", "メールアドレス"],
  subjects: ["専攻", "科目名", "担当講師"],
  students: ["学籍番号", "氏名", "ひらがな", "年齢", "生年月日", "性別", "メール", "電話", "郵便番号", "住所", "専攻"],
} as const;
const text = (value: string) => value.trim();
const todayYear = () => new Date().getUTCFullYear();
const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validBirthDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const ageAtYear = (birthDate: string, year: number) => year - Number(birthDate.slice(0, 4));

/** RFC4180 parser: CRLF/LF, quoted commas and escaped quotes. Input is decoded with fatal UTF-8 in the browser. */
export const parseCsv = (file: string, source: string, expectedHeaders: readonly string[], errors: RowError[]) => {
  if (utf8Length(source) > MAX_CSV_BYTES) { errors.push({ file, row: 0, field: "ファイル", reason: "ファイルサイズは150KB以下にしてください。" }); return []; }
  if (source.includes("\uFFFD")) { errors.push({ file, row: 0, field: "ファイル", reason: "UTF-8として読み取れない文字が含まれています。" }); return []; }
  const input = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const rows: CsvRow[] = []; let row: string[] = []; let field = ""; let quoted = false; let sourceRow = 1; let rowStart = 1;
  const completeRow = () => {
    const completed = row as CsvRow;
    Object.defineProperty(completed, "sourceRow", { value: rowStart });
    rows.push(completed);
    row = []; field = ""; rowStart = sourceRow + 1;
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) { if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; } else if (char === '"') { quoted = false; if (input[index + 1] && ![",", "\r", "\n"].includes(input[index + 1])) { errors.push({ file, row: sourceRow, field: "CSV", reason: "引用符の後には区切り文字または改行だけを指定してください。" }); return []; } } else { field += char; if (char === "\n") sourceRow += 1; } continue; }
    if (char === '"') { if (field) { errors.push({ file, row: sourceRow, field: "CSV", reason: "引用符の位置が正しくありません。" }); return []; } quoted = true; }
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); completeRow(); sourceRow += 1; }
    else if (char === "\r") { if (input[index + 1] !== "\n") { errors.push({ file, row: sourceRow, field: "CSV", reason: "改行はCRLFまたはLFで指定してください。" }); return []; } }
    else field += char;
  }
  if (quoted) { errors.push({ file, row: sourceRow, field: "CSV", reason: "引用符が閉じられていません。" }); return []; }
  if (field || row.length) { row.push(field); completeRow(); }
  if (rows.length === 0 || rows[0]?.join("\u0000") !== expectedHeaders.join("\u0000")) { errors.push({ file, row: 1, field: "見出し", reason: `見出しは「${expectedHeaders.join("、")}」にしてください。` }); return []; }
  const data = rows.slice(1).filter((columns) => columns.some((column) => text(column)));
  if (data.length > MAX_ROWS) { errors.push({ file, row: 0, field: "行数", reason: "1ファイルは1000行以下にしてください。" }); return []; }
  for (const columns of data) if (columns.length !== expectedHeaders.length) errors.push({ file, row: columns.sourceRow, field: "列数", reason: "列数が見出しと一致しません。" });
  return data;
};

const parseTeachers = (source: string, errors: RowError[]): TeacherRow[] => parseCsv("講師CSV", source, headers.teachers, errors).flatMap((row) => {
  if (row.length !== headers.teachers.length) return [];
  const [name, kana, ageRaw, gender, email] = row.map(text); const age = Number(ageRaw); const number = row.sourceRow;
  if (!name || !kana || !Number.isInteger(age) || age < 18 || age > 100 || (gender !== "男" && gender !== "女") || !validEmail(email)) { errors.push({ file: "講師CSV", row: number, field: "入力値", reason: "氏名・ひらがな・年齢・性別・メールアドレスを確認してください。" }); return []; }
  return [{ name, kana, age, gender, email: email.toLowerCase() }];
});
const parseSubjects = (gradeLevel: 1 | 2 | 3, source: string, errors: RowError[]): SubjectRow[] => parseCsv(`${gradeLevel}年科目CSV`, source, headers.subjects, errors).flatMap((row) => {
  if (row.length !== headers.subjects.length) return [];
  const [course, name, teacherName] = row.map(text); if (!(course in courses) && course !== "共通" || !name || !teacherName) { errors.push({ file: `${gradeLevel}年科目CSV`, row: row.sourceRow, field: "入力値", reason: "専攻・科目名・担当講師を確認してください。" }); return []; }
  return [{ course: course as SubjectRow["course"], name, teacherName, gradeLevel }];
});
const parseStudents = (source: string, targetYear: number, errors: RowError[]): StudentRow[] => parseCsv("新入生CSV", source, headers.students, errors).flatMap((row) => {
  if (row.length !== headers.students.length) return [];
  const [studentNumber, name, kana, ageRaw, birthDate, gender, email, phone, postalCode, address, course] = row.map(text); const age = Number(ageRaw); const number = row.sourceRow;
  if (!studentNumber || !name || !kana || !Number.isInteger(age) || !validBirthDate(birthDate) || age !== ageAtYear(birthDate, targetYear) || (gender !== "男" && gender !== "女") || !validEmail(email) || !(course in courses)) { errors.push({ file: "新入生CSV", row: number, field: "入力値", reason: "学籍番号、氏名、年齢と生年月日、性別、メール、専攻を確認してください。" }); return []; }
  return [{ studentNumber, name, kana, age, birthDate, gender, email: email.toLowerCase(), phone, postalCode, address, course: course as StudentRow["course"] }];
});

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
const canonical = (input: RolloverInput) => JSON.stringify({ targetYear: input.targetYear, teachersCsv: input.teachersCsv, grade1SubjectsCsv: input.grade1SubjectsCsv, grade2SubjectsCsv: input.grade2SubjectsCsv, grade3SubjectsCsv: input.grade3SubjectsCsv, newStudentsCsv: input.newStudentsCsv });
const now = () => Math.floor(Date.now() / 1000);

export class D1RolloverService {
  constructor(private readonly database: D1Database, private readonly newId: () => string = () => createWorkerId(), private readonly clock: Clock = () => new Date()) {}
  private async first<T extends Record<string, unknown>>(statement: D1PreparedStatement) { return (await statement.first<T>()) ?? null; }
  private async rows<T extends Record<string, unknown>>(statement: D1PreparedStatement) { return (await statement.all<T>()).results ?? []; }
  private async currentYear() { return ensureCurrentAcademicYear(this.database, this.clock); }
  private async parsed(input: RolloverInput) {
    validateYear(input.targetYear);
    const totalBytes = [input.teachersCsv, input.grade1SubjectsCsv, input.grade2SubjectsCsv, input.grade3SubjectsCsv, input.newStudentsCsv].reduce((total, csv) => total + utf8Length(csv), 0);
    if (totalBytes > MAX_TOTAL_CSV_BYTES) throw new AdminDomainError("ROLLOVER_PAYLOAD_TOO_LARGE", "年度更新用CSVの合計は450KB以下にしてください。");
    const errors: RowError[] = [];
    const teachers = parseTeachers(input.teachersCsv, errors); const subjects = [...parseSubjects(1, input.grade1SubjectsCsv, errors), ...parseSubjects(2, input.grade2SubjectsCsv, errors), ...parseSubjects(3, input.grade3SubjectsCsv, errors)]; const students = parseStudents(input.newStudentsCsv, input.targetYear, errors);
    const duplicate = (values: string[], file: string, field: string) => { const seen = new Set<string>(); for (const value of values) { if (seen.has(value)) errors.push({ file, row: 0, field, reason: "重複しています。" }); seen.add(value); } };
    duplicate(teachers.map((row) => row.email), "講師CSV", "メールアドレス"); duplicate(students.map((row) => row.studentNumber), "新入生CSV", "学籍番号"); duplicate(subjects.map((row) => `${row.gradeLevel}:${row.name}`), "科目CSV", "科目名");
    return { teachers, subjects, students, errors };
  }
  async preview(input: RolloverInput): Promise<RolloverPreview> {
    const current = await this.currentYear();
    if (input.targetYear !== current + 1) throw new AdminDomainError("INVALID_ROLLOVER_YEAR", "年度更新は現在年度の翌年度を指定してください。");
    const parsed = await this.parsed(input); const graduates = await this.first<{ count: number }>(this.database.prepare("SELECT count(*) AS count FROM students WHERE enrollment_year <= ? AND status = 'enrolled' AND has_failed_history = 0").bind(input.targetYear - 3));
    const teacherRows = await this.rows<{ id: string; name: string; email: string; role: string; status: string }>(this.database.prepare(`SELECT id,name,email,role,status FROM user WHERE email IN (${parsed.teachers.map(() => "?").join(",") || "NULL"})`).bind(...parsed.teachers.map((teacher) => teacher.email)));
    for (const teacher of parsed.teachers) if (!teacherRows.some((row) => row.email === teacher.email && row.role === "teacher" && row.status === "active")) parsed.errors.push({ file: "講師CSV", row: 0, field: "メールアドレス", reason: "有効な登録済み講師を指定してください。" });
    const names = new Map<string, number>(); for (const teacher of parsed.teachers) names.set(teacher.name, (names.get(teacher.name) ?? 0) + 1);
    for (const subject of parsed.subjects) if ((names.get(subject.teacherName) ?? 0) !== 1) parsed.errors.push({ file: `${subject.gradeLevel}年科目CSV`, row: 0, field: "担当講師", reason: "担当講師名が一意に決まりません。メールアドレスを確認してください。" });
    const existingNumbers = await this.rows<{ student_number: string }>(this.database.prepare(`SELECT student_number FROM students WHERE student_number IN (${parsed.students.map(() => "?").join(",") || "NULL"})`).bind(...parsed.students.map((student) => student.studentNumber)));
    for (const row of existingNumbers) parsed.errors.push({ file: "新入生CSV", row: 0, field: "学籍番号", reason: "既に登録されています。" });
    return { targetYear: input.targetYear, graduationCandidates: Number(graduates?.count ?? 0), teacherCount: parsed.teachers.length, subjectCounts: { 1: parsed.subjects.filter((item) => item.gradeLevel === 1).length, 2: parsed.subjects.filter((item) => item.gradeLevel === 2).length, 3: parsed.subjects.filter((item) => item.gradeLevel === 3).length }, studentCount: parsed.students.length, errors: parsed.errors };
  }
  async apply(actorId: string, input: RolloverInput) {
    const key = input.idempotencyKey?.trim(); if (!key || key.length > MAX_IDEMPOTENCY_KEY || !/^[A-Za-z0-9_-]+$/.test(key)) throw new AdminDomainError("INVALID_IDEMPOTENCY_KEY", "再実行キーを正しく指定してください。");
    const payloadHash = await digest(canonical(input)); const existing = await this.first<{ payload_hash: string; status: string; result_json: string | null }>(this.database.prepare("SELECT payload_hash,status,result_json FROM idempotency_operations WHERE idempotency_key=?").bind(key));
    if (existing) { if (existing.payload_hash !== payloadHash) throw new AdminDomainError("IDEMPOTENCY_KEY_CONFLICT", "同じ再実行キーに異なる内容は使用できません。", 409); if (existing.status === "succeeded" && existing.result_json) return JSON.parse(existing.result_json) as { applied: true; summary: RolloverPreview }; throw new AdminDomainError("ROLLOVER_IN_PROGRESS", "年度更新を処理中です。", 409); }
    const completedForYear = await this.first<{ idempotency_key: string }>(this.database.prepare("SELECT idempotency_key FROM idempotency_operations WHERE operation_type='annual_rollover' AND academic_year=? AND status='succeeded' LIMIT 1").bind(input.targetYear));
    if (completedForYear) throw new AdminDomainError("ROLLOVER_YEAR_ALREADY_APPLIED", "この年度の更新は既に完了しています。", 409);
    const preview = await this.preview(input); if (preview.errors.length) throw new AdminDomainError("ROLLOVER_VALIDATION_FAILED", "CSVの内容を確認してください。", 409);
    const parsed = await this.parsed(input);
    const teacherRows = await this.rows<{ id: string; name: string; email: string }>(this.database.prepare(`SELECT id,name,email FROM user WHERE email IN (${parsed.teachers.map(() => "?").join(",") || "NULL"})`).bind(...parsed.teachers.map((teacher) => teacher.email)));
    const teacherIdByEmail = new Map(teacherRows.map((teacher) => [teacher.email, teacher.id]));
    const teacherIdByName = new Map(parsed.teachers.map((teacher) => [teacher.name, teacherIdByEmail.get(teacher.email)]));
    const graduates = await this.rows<{ id: string }>(this.database.prepare("SELECT id FROM students WHERE enrollment_year <= ? AND status = 'enrolled' AND has_failed_history = 0").bind(input.targetYear - 3));
    const json = (value: unknown, label: string) => {
      const payload = JSON.stringify(value);
      if (utf8Length(payload) > MAX_JSON_BIND_BYTES) throw new AdminDomainError("ROLLOVER_PAYLOAD_TOO_LARGE", `${label}の内容が大きすぎます。CSVの合計は450KB以下にしてください。`);
      return payload;
    };
    const teachersJson = json(parsed.teachers.map((teacher) => ({ email: teacher.email, name: teacher.name })), "講師CSV");
    const graduateIdsJson = json(graduates.map((graduate) => graduate.id), "卒業候補");
    const subjectsJson = json(parsed.subjects.map((subject) => ({ id: this.newId(), name: subject.name, gradeLevel: subject.gradeLevel, teacherId: teacherIdByName.get(subject.teacherName) ?? "__rollover_teacher_missing__", courseIds: subject.course === "共通" ? Object.values(courses) : [courses[subject.course]] })), "科目CSV");
    const studentsJson = json(parsed.students.map((student) => ({ id: this.newId(), studentNumber: student.studentNumber, name: student.name, kana: student.kana, birthDate: student.birthDate, gender: student.gender, email: student.email, phone: student.phone || null, postalCode: student.postalCode || null, address: student.address || null, courseId: courses[student.course] })), "新入生CSV");
    const timestamp = now(); const operationId = this.newId(); const result = { applied: true as const, summary: preview };
    /*
     * Every row collection is one JSON bind and expanded by SQLite JSON1.  The
     * two FK sentinels make race-detected guards fail the batch itself (rather
     * than relying on D1 `changes` after a committed batch).
     */
    const statements: D1PreparedStatement[] = [
      this.database.prepare("INSERT INTO idempotency_operations (id,operation_type,idempotency_key,status,academic_year,payload_hash,created_by_user_id,created_at,updated_at) VALUES (?, 'annual_rollover', ?, 'pending', NULL, ?, COALESCE((SELECT id FROM user WHERE id=? AND EXISTS (SELECT 1 FROM academic_years WHERE year=? AND is_current=1)), '__rollover_current_year_changed__'), ?, ?)").bind(operationId, key, payloadHash, actorId, input.targetYear - 1, timestamp, timestamp),
      this.database.prepare("UPDATE academic_years SET is_current=0, updated_at=? WHERE is_current=1").bind(timestamp),
      this.database.prepare("INSERT INTO academic_years (year,is_current,selected_by_user_id,selected_at,created_at,updated_at) VALUES (?,1,?,?,?,?) ON CONFLICT(year) DO UPDATE SET is_current=1,selected_by_user_id=excluded.selected_by_user_id,selected_at=excluded.selected_at,updated_at=excluded.updated_at").bind(input.targetYear, actorId, timestamp, timestamp, timestamp),
      this.database.prepare("UPDATE user SET name=(SELECT json_extract(item.value,'$.name') FROM json_each(?) item WHERE json_extract(item.value,'$.email')=user.email), updated_at=? WHERE email IN (SELECT json_extract(value,'$.email') FROM json_each(?)) AND role='teacher' AND status='active'").bind(teachersJson, timestamp, teachersJson),
      this.database.prepare("UPDATE students SET status='graduated',status_effective_academic_year=?,status_changed_at=?,status_changed_by_user_id=?,updated_at=? WHERE id IN (SELECT value FROM json_each(?)) AND enrollment_year <= ? AND status='enrolled' AND has_failed_history=0").bind(input.targetYear, timestamp, actorId, timestamp, graduateIdsJson, input.targetYear - 3),
      this.database.prepare("INSERT INTO student_status_history (id,student_id,status,effective_academic_year,changed_at,changed_by_user_id,reason) SELECT lower(hex(randomblob(16))), value,'graduated',?,?,?,'年度更新による卒業' FROM json_each(?)").bind(input.targetYear, timestamp, actorId, graduateIdsJson),
      this.database.prepare("INSERT INTO subjects (id,academic_year,name,grade_level,teacher_user_id,created_at,updated_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.name'),json_extract(value,'$.gradeLevel'),COALESCE((SELECT id FROM user WHERE id=json_extract(value,'$.teacherId') AND role='teacher' AND status='active'),'__rollover_teacher_missing__'),?,? FROM json_each(?)").bind(input.targetYear, timestamp, timestamp, subjectsJson),
      this.database.prepare("INSERT INTO subject_courses (subject_id,course_id) SELECT json_extract(subject.value,'$.id'),course.value FROM json_each(?) subject JOIN json_each(json_extract(subject.value,'$.courseIds')) course").bind(subjectsJson),
      this.database.prepare("INSERT INTO subject_term_statuses (subject_id,term,is_finalized,created_at,updated_at) SELECT json_extract(value,'$.id'),term,0,?,? FROM json_each(?) CROSS JOIN (SELECT 1 AS term UNION ALL SELECT 2)").bind(timestamp, timestamp, subjectsJson),
      this.database.prepare("INSERT INTO students (id,student_number,name,name_kana,birth_date,gender,email,phone,postal_code,address,course_id,enrollment_year,status,status_changed_at,status_changed_by_user_id,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.studentNumber'),json_extract(value,'$.name'),json_extract(value,'$.kana'),json_extract(value,'$.birthDate'),json_extract(value,'$.gender'),json_extract(value,'$.email'),json_extract(value,'$.phone'),json_extract(value,'$.postalCode'),json_extract(value,'$.address'),json_extract(value,'$.courseId'),?,'enrolled',?,?,?,? FROM json_each(?)").bind(input.targetYear, timestamp, actorId, timestamp, timestamp, studentsJson),
      this.database.prepare("INSERT INTO student_status_history (id,student_id,status,effective_academic_year,changed_at,changed_by_user_id,reason) SELECT lower(hex(randomblob(16))),json_extract(value,'$.id'),'enrolled',?,?,?,'年度更新による新入生登録' FROM json_each(?)").bind(input.targetYear, timestamp, actorId, studentsJson),
      this.database.prepare("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) VALUES (?,COALESCE((SELECT id FROM user WHERE id=? AND (SELECT count(*) FROM user WHERE email IN (SELECT json_extract(value,'$.email') FROM json_each(?)) AND role='teacher' AND status='active') = json_array_length(?) AND (SELECT count(*) FROM students WHERE id IN (SELECT value FROM json_each(?)) AND status='graduated' AND status_effective_academic_year=? AND has_failed_history=0) = json_array_length(?) AND (SELECT count(*) FROM student_status_history WHERE student_id IN (SELECT value FROM json_each(?)) AND status='graduated' AND effective_academic_year=? AND changed_by_user_id=? AND reason='年度更新による卒業') = json_array_length(?) AND (SELECT count(*) FROM subjects WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND academic_year=?) = json_array_length(?) AND (SELECT count(*) FROM students WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND enrollment_year=? AND status='enrolled') = json_array_length(?) AND (SELECT count(*) FROM student_status_history WHERE student_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND status='enrolled' AND effective_academic_year=? AND changed_by_user_id=? AND reason='年度更新による新入生登録') = json_array_length(?)), '__rollover_state_changed__'),'annual_rollover_applied','academic_year',?,?,?)").bind(this.newId(), actorId, teachersJson, teachersJson, graduateIdsJson, input.targetYear, graduateIdsJson, graduateIdsJson, input.targetYear, actorId, graduateIdsJson, subjectsJson, input.targetYear, subjectsJson, studentsJson, input.targetYear, studentsJson, studentsJson, input.targetYear, actorId, studentsJson, String(input.targetYear), input.targetYear, JSON.stringify({ graduationCandidates: preview.graduationCandidates, teacherCount: preview.teacherCount, studentCount: preview.studentCount })),
      this.database.prepare("UPDATE idempotency_operations SET academic_year=?,status='succeeded',result_json=?,completed_at=?,updated_at=? WHERE id=?").bind(input.targetYear, JSON.stringify(result), timestamp, timestamp, operationId),
    ];
    try { await this.database.batch(statements); } catch (error) {
      if (String(error).includes("idempotency_operations_rollover_success_year_unique") || String(error).includes("idempotency_operations.academic_year") || String(error).includes("idempotency_operations.idempotency_key")) {
        const completed = await this.first<{ idempotency_key: string; payload_hash: string; result_json: string | null }>(this.database.prepare("SELECT idempotency_key,payload_hash,result_json FROM idempotency_operations WHERE operation_type='annual_rollover' AND academic_year=? AND status='succeeded' LIMIT 1").bind(input.targetYear));
        if (completed?.idempotency_key === key && completed.payload_hash === payloadHash && completed.result_json) return JSON.parse(completed.result_json) as { applied: true; summary: RolloverPreview };
        throw new AdminDomainError("ROLLOVER_YEAR_ALREADY_APPLIED", "この年度の更新は既に完了しています。", 409);
      }
      throw error;
    }
    return result;
  }
}
export const createRolloverService = (database: D1Database) => new D1RolloverService(database);
