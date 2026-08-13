import { AdminDomainError, validateYear } from "./service";
import { ensureCurrentAcademicYear, type Clock } from "../academic-year";
import { createWorkerId } from "../worker-crypto";

export const exportScopes = ["year_all_students", "three_years", "previous_year", "confirmed_to_date", "term"] as const;
export type GradeExportScope = typeof exportScopes[number];
export type GradeExportQuery = { academicYear?: number; scope: GradeExportScope; term?: 1 | 2; courseId?: string; gradeLevel?: 1 | 2 | 3; subjectId?: string };
export type ResolvedGradeExportQuery = Omit<GradeExportQuery, "academicYear"> & { academicYear: number; years: number[] };
export type GradeExportPreview = { token: string; rowCount: number; academicYear: number; years: number[]; scope: GradeExportScope };
const MAX_ROWS = 10_000; const MAX_BYTES = 5_000_000;
const headers = ["学籍番号", "氏名", "年度", "学期", "専攻", "学年", "科目名", "出席率", "最終評価"];

const escapeTextCell = (value: string | null) => {
  let text = value ?? "";
  // Excel ignores leading whitespace/control characters before interpreting a formula.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const line = (row: GradeExportRow) => [escapeTextCell(row.studentNumber), escapeTextCell(row.studentName), row.academicYear, row.term, escapeTextCell(row.courseName), row.gradeLevel, escapeTextCell(row.subjectName), row.attendanceRate, escapeTextCell(row.letterGrade)].join(",");
export const toGradeCsv = (rows: GradeExportRow[]) => `\uFEFF${[headers.join(","), ...rows.map(line)].join("\r\n")}\r\n`;
export const resolveExportYears = (academicYear: number, scope: GradeExportScope) => {
  switch (scope) {
    case "three_years": return [academicYear - 2, academicYear - 1, academicYear];
    case "previous_year": return [academicYear - 1];
    case "confirmed_to_date": return [academicYear - 2, academicYear - 1, academicYear];
    default: return [academicYear];
  }
};
export const validateGradeExportQuery = (query: GradeExportQuery, currentYear: number): ResolvedGradeExportQuery => {
  const academicYear = query.academicYear ?? currentYear; validateYear(academicYear);
  if (!exportScopes.includes(query.scope)) throw new AdminDomainError("INVALID_EXPORT_SCOPE", "出力パターンを正しく指定してください。");
  if (query.scope === "term" && (query.term !== 1 && query.term !== 2)) throw new AdminDomainError("INVALID_EXPORT_TERM", "学期を指定してください。");
  if (query.scope !== "term" && query.term !== undefined) throw new AdminDomainError("INVALID_EXPORT_TERM", "学期指定は学期別出力でのみ使用できます。");
  if (query.gradeLevel !== undefined && ![1, 2, 3].includes(query.gradeLevel)) throw new AdminDomainError("INVALID_GRADE_LEVEL", "学年を正しく指定してください。");
  for (const value of [query.courseId, query.subjectId]) if (value !== undefined && (!value.trim() || value.length > 128)) throw new AdminDomainError("INVALID_EXPORT_FILTER", "絞り込み条件を正しく指定してください。");
  return { ...query, academicYear, years: resolveExportYears(academicYear, query.scope) };
};
export type GradeExportRow = { id: string; studentNumber: string; studentName: string; academicYear: number; term: number; courseName: string; gradeLevel: number; subjectName: string; attendanceRate: number; letterGrade: string };
export interface GradeExportService { preview(actorId: string, query: GradeExportQuery): Promise<GradeExportPreview>; download(actorId: string, token: string): Promise<{ csv: string; filename: string; rowCount: number }>; }

export class D1GradeExportService implements GradeExportService {
  constructor(private readonly database: D1Database, private readonly newId: () => string = () => createWorkerId(), private readonly clock: Clock = () => new Date()) {}
  private async currentYear() { return ensureCurrentAcademicYear(this.database, this.clock); }
  private async resolved(query: GradeExportQuery) { return validateGradeExportQuery(query, await this.currentYear()); }
  private where(query: ResolvedGradeExportQuery, cursor?: Pick<GradeExportRow, "academicYear" | "studentNumber" | "term" | "subjectName" | "id">) {
    const clauses = ["g.academic_year IN (" + query.years.map(() => "?").join(",") + ")", "sts.is_finalized=1", "g.attendance_rate IS NOT NULL", "g.letter_grade IS NOT NULL", "g.attempt=(SELECT MAX(latest.attempt) FROM grades latest WHERE latest.student_id=g.student_id AND latest.subject_id=g.subject_id AND latest.academic_year=g.academic_year AND latest.term=g.term)"];
    const values: unknown[] = [...query.years];
    if (query.scope === "term") { clauses.push("g.term=?"); values.push(query.term!); }
    if (query.courseId) { clauses.push("s.course_id=?"); values.push(query.courseId); }
    if (query.gradeLevel) { clauses.push("sub.grade_level=?"); values.push(query.gradeLevel); }
    if (query.subjectId) { clauses.push("g.subject_id=?"); values.push(query.subjectId); }
    if (cursor) { clauses.push("(g.academic_year>? OR (g.academic_year=? AND (s.student_number>? OR (s.student_number=? AND (g.term>? OR (g.term=? AND (sub.name>? OR (sub.name=? AND g.id>?))))))))"); values.push(cursor.academicYear, cursor.academicYear, cursor.studentNumber, cursor.studentNumber, cursor.term, cursor.term, cursor.subjectName, cursor.subjectName, cursor.id); }
    return { clauses, values };
  }
  private async count(query: ResolvedGradeExportQuery) { const { clauses, values } = this.where(query); const row = await this.database.prepare(`SELECT count(*) AS count FROM (SELECT 1 FROM grades g JOIN students s ON s.id=g.student_id JOIN subjects sub ON sub.id=g.subject_id AND sub.academic_year=g.academic_year JOIN subject_term_statuses sts ON sts.subject_id=g.subject_id AND sts.term=g.term WHERE ${clauses.join(" AND ")} LIMIT ?)`).bind(...values, MAX_ROWS + 1).first<{ count: number }>(); const count = Number(row?.count ?? 0); if (count > MAX_ROWS) throw new AdminDomainError("EXPORT_TOO_LARGE", "出力件数が上限（10,000件）を超えています。条件を絞り込んでください。", 413); return count; }
  private async page(query: ResolvedGradeExportQuery, cursor?: Pick<GradeExportRow, "academicYear" | "studentNumber" | "term" | "subjectName" | "id">) { const { clauses, values } = this.where(query, cursor); const result = await this.database.prepare(`SELECT g.id,s.student_number AS studentNumber,s.name AS studentName,g.academic_year AS academicYear,g.term AS term,c.name AS courseName,sub.grade_level AS gradeLevel,sub.name AS subjectName,g.attendance_rate AS attendanceRate,g.letter_grade AS letterGrade FROM grades g JOIN students s ON s.id=g.student_id JOIN courses c ON c.id=s.course_id JOIN subjects sub ON sub.id=g.subject_id AND sub.academic_year=g.academic_year JOIN subject_term_statuses sts ON sts.subject_id=g.subject_id AND sts.term=g.term WHERE ${clauses.join(" AND ")} ORDER BY g.academic_year,s.student_number,g.term,sub.name,g.id LIMIT ?`).bind(...values, 250).all<GradeExportRow>(); return (result.results ?? []).map((row) => ({ ...row, id: String(row.id), academicYear: Number(row.academicYear), term: Number(row.term), gradeLevel: Number(row.gradeLevel), attendanceRate: Number(row.attendanceRate) })); }
  async preview(actorId: string, query: GradeExportQuery) {
    const resolved = await this.resolved(query); const snapshotId = this.newId(); const createdAt = Math.floor(Date.now() / 1000); const expiresAt = createdAt + 15 * 60; const { clauses, values } = this.where(resolved);
    const insertRows = `INSERT INTO grade_export_snapshot_rows (snapshot_id,position,student_number,student_name,academic_year,term,course_name,grade_level,subject_name,attendance_rate,letter_grade) SELECT ?,row_number() OVER (ORDER BY g.academic_year,s.student_number,g.term,sub.name,g.id),s.student_number,s.name,g.academic_year,g.term,c.name,sub.grade_level,sub.name,g.attendance_rate,g.letter_grade FROM grades g JOIN students s ON s.id=g.student_id JOIN courses c ON c.id=s.course_id JOIN subjects sub ON sub.id=g.subject_id AND sub.academic_year=g.academic_year JOIN subject_term_statuses sts ON sts.subject_id=g.subject_id AND sts.term=g.term WHERE ${clauses.join(" AND ")}`;
    await this.database.batch([
      this.database.prepare("DELETE FROM grade_export_snapshots WHERE expires_at < ?").bind(createdAt),
      this.database.prepare("INSERT INTO grade_export_snapshots (id,owner_user_id,academic_year,expires_at,created_at) VALUES (?,?,?,?,?)").bind(snapshotId, actorId, resolved.academicYear, expiresAt, createdAt),
      this.database.prepare(insertRows).bind(snapshotId, ...values),
      this.database.prepare("UPDATE grade_export_snapshots SET owner_user_id=COALESCE((SELECT id FROM user WHERE id=? AND (SELECT count(*) FROM grade_export_snapshot_rows WHERE snapshot_id=?)<=?), '__grade_export_too_large__') WHERE id=?").bind(actorId, snapshotId, MAX_ROWS, snapshotId),
    ]);
    const row = await this.database.prepare("SELECT count(*) AS count FROM grade_export_snapshot_rows WHERE snapshot_id=?").bind(snapshotId).first<{ count: number }>();
    return { token: snapshotId, rowCount: Number(row?.count ?? 0), academicYear: resolved.academicYear, years: resolved.years, scope: resolved.scope };
  }
  async download(actorId: string, token: string) {
    if (!/^[A-Za-z0-9-]{16,128}$/.test(token)) throw new AdminDomainError("INVALID_EXPORT_TOKEN", "出力確認が期限切れです。もう一度件数を確認してください。");
    const claimedAt = Math.floor(Date.now() / 1000); const claimId = this.newId();
    const snapshot = await this.database.prepare("UPDATE grade_export_snapshots SET claim_id=?,claimed_at=? WHERE id=? AND owner_user_id=? AND expires_at>=? AND claim_id IS NULL RETURNING academic_year AS academicYear").bind(claimId, claimedAt, token, actorId, claimedAt).first<{ academicYear: number }>();
    if (!snapshot) { const existing = await this.database.prepare("SELECT owner_user_id AS ownerUserId,expires_at AS expiresAt,claim_id AS claimId FROM grade_export_snapshots WHERE id=?").bind(token).first<{ ownerUserId: string; expiresAt: number; claimId: string | null }>(); if (!existing || existing.ownerUserId !== actorId) throw new AdminDomainError("EXPORT_SNAPSHOT_NOT_FOUND", "出力確認が見つかりません。もう一度件数を確認してください。", 404); throw new AdminDomainError("EXPORT_SNAPSHOT_EXPIRED", "出力確認が期限切れまたは使用済みです。もう一度件数を確認してください。", 410); }
    const encoder = new TextEncoder(); const chunks = [`\uFEFF${headers.join(",")}\r\n`]; let byteLength = encoder.encode(chunks[0]).byteLength; let position = 0; let rowCount = 0;
    try { while (true) { const page = await this.database.prepare("SELECT r.position AS id,r.student_number AS studentNumber,r.student_name AS studentName,r.academic_year AS academicYear,r.term,r.course_name AS courseName,r.grade_level AS gradeLevel,r.subject_name AS subjectName,r.attendance_rate AS attendanceRate,r.letter_grade AS letterGrade FROM grade_export_snapshot_rows r JOIN grade_export_snapshots s ON s.id=r.snapshot_id WHERE r.snapshot_id=? AND s.owner_user_id=? AND s.claim_id=? AND r.position>? ORDER BY r.position LIMIT 250").bind(token, actorId, claimId, position).all<GradeExportRow>(); const rows = (page.results ?? []).map((row) => ({ ...row, id: String(row.id), academicYear: Number(row.academicYear), term: Number(row.term), gradeLevel: Number(row.gradeLevel), attendanceRate: Number(row.attendanceRate) })); if (!rows.length) break; for (const row of rows) { const chunk = `${line(row)}\r\n`; const bytes = encoder.encode(chunk).byteLength; if (byteLength + bytes > MAX_BYTES) throw new AdminDomainError("EXPORT_TOO_LARGE", "出力ファイルが上限（5MB）を超えています。条件を絞り込んでください。", 413); chunks.push(chunk); byteLength += bytes; rowCount += 1; } position = Number(rows.at(-1)?.id); } } catch (error) { await this.database.prepare("DELETE FROM grade_export_snapshots WHERE id=? AND owner_user_id=? AND claim_id=?").bind(token, actorId, claimId).run(); throw error; }
    const csv = chunks.join("");
    await this.database.batch([this.database.prepare("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) VALUES (?,?, 'grades_exported','grade_export',?,?,?)").bind(this.newId(), actorId, "grades", Number(snapshot.academicYear), JSON.stringify({ rowCount })), this.database.prepare("DELETE FROM grade_export_snapshots WHERE id=? AND owner_user_id=? AND claim_id=?").bind(token, actorId, claimId)]);
    return { csv, filename: `成績一覧_${Number(snapshot.academicYear)}年度.csv`, rowCount };
  }
}
export const createGradeExportService = (database: D1Database) => new D1GradeExportService(database);
export const unavailableGradeExportService: GradeExportService = { preview: async () => { throw new AdminDomainError("EXPORT_SERVICE_UNAVAILABLE", "成績CSV出力を利用できません。", 503); }, download: async () => { throw new AdminDomainError("EXPORT_SERVICE_UNAVAILABLE", "成績CSV出力を利用できません。", 503); } };
