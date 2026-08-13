import { AdminDomainError, validateYear } from "./service";
import { ensureCurrentAcademicYear, type Clock } from "../academic-year";
import { createWorkerId } from "../worker-crypto";

export const exportScopes = ["year_all_students", "three_years", "previous_year", "confirmed_to_date", "term"] as const;
export const exportFormats = ["csv", "pdf"] as const;
export type GradeExportScope = typeof exportScopes[number];
export type GradeExportFormat = typeof exportFormats[number];
export const gradeExportScopeLabels: Record<GradeExportScope, string> = {
  year_all_students: "年度・全学生",
  three_years: "直近3年度",
  previous_year: "前年度",
  confirmed_to_date: "確定済み・累計3年度",
  term: "年度・学期別",
};
export type GradeExportQuery = { academicYear?: number; scope: GradeExportScope; format: GradeExportFormat; term?: 1 | 2; courseId?: string; gradeLevel?: 1 | 2 | 3; subjectId?: string };
export type ResolvedGradeExportQuery = Omit<GradeExportQuery, "academicYear"> & { academicYear: number; years: number[] };
export type GradeExportPreview = { token: string; rowCount: number; academicYear: number; years: number[]; scope: GradeExportScope; format: GradeExportFormat };
export type GradeExportRow = { id: string; studentNumber: string; studentName: string; academicYear: number; term: number; courseName: string; gradeLevel: number; subjectName: string; attendanceRate: number; letterGrade: string };
export type BrowserBinding = Pick<BrowserRun, "quickAction">;

const MAX_ROWS = 10_000; const MAX_BYTES = 5_000_000;
const headers = ["学籍番号", "氏名", "年度", "学期", "専攻", "学年", "科目名", "出席率", "最終評価"];
export const gradePdfOptions = { format: "a4", landscape: true, printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: "<div style=\"font-family:'IPAfont Gothic','Noto Sans CJK JP',sans-serif;font-size:8px;width:100%;text-align:center\">SANSUN学園 成績出力 — <span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>", margin: { top: "14mm", right: "10mm", bottom: "16mm", left: "10mm" } } as const;

const escapeTextCell = (value: string | null) => {
  let text = value ?? "";
  // Excel ignores leading whitespace/control characters before interpreting a formula.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const line = (row: GradeExportRow) => [escapeTextCell(row.studentNumber), escapeTextCell(row.studentName), row.academicYear, row.term, escapeTextCell(row.courseName), row.gradeLevel, escapeTextCell(row.subjectName), row.attendanceRate, escapeTextCell(row.letterGrade)].join(",");
export const toGradeCsv = (rows: GradeExportRow[]) => `\uFEFF${[headers.join(","), ...rows.map(line)].join("\r\n")}\r\n`;
const escapeHtml = (value: string | number) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const formatGeneratedAt = (value: number) => new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(value * 1000));
/** Self-contained HTML only: grade data is escaped and there are no remote assets, scripts, or URLs. */
export const toGradePdfHtml = (rows: GradeExportRow[], input: { academicYear: number; scope: GradeExportScope; generatedAt: number }) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 14mm 10mm 16mm; }
* { box-sizing: border-box; } body { color: #172033; font-family: "IPAfont Gothic", "Noto Sans CJK JP", sans-serif; font-size: 9pt; } h1 { font-size: 16pt; margin: 0 0 3mm; } p { margin: 0 0 5mm; } table { border-collapse: collapse; width: 100%; } thead { display: table-header-group; } tr { break-inside: avoid; } th, td { border: .25mm solid #aeb8c8; padding: 1.5mm; text-align: left; vertical-align: top; } th { background: #e8eef8; white-space: nowrap; } td.num { text-align: right; }
</style></head><body><h1>成績一覧</h1><p>対象: ${escapeHtml(gradeExportScopeLabels[input.scope])} ／ 基準年度: ${escapeHtml(input.academicYear)}年度 ／ 作成日時: ${escapeHtml(formatGeneratedAt(input.generatedAt))}</p><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.studentNumber)}</td><td>${escapeHtml(row.studentName)}</td><td class="num">${escapeHtml(row.academicYear)}</td><td class="num">${escapeHtml(row.term)}</td><td>${escapeHtml(row.courseName)}</td><td class="num">${escapeHtml(row.gradeLevel)}</td><td>${escapeHtml(row.subjectName)}</td><td class="num">${escapeHtml(row.attendanceRate)}</td><td>${escapeHtml(row.letterGrade)}</td></tr>`).join("")}</tbody></table></body></html>`;

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
  if (!exportFormats.includes(query.format)) throw new AdminDomainError("INVALID_EXPORT_FORMAT", "出力形式を正しく指定してください。");
  if (query.scope === "term" && (query.term !== 1 && query.term !== 2)) throw new AdminDomainError("INVALID_EXPORT_TERM", "学期を指定してください。");
  if (query.scope !== "term" && query.term !== undefined) throw new AdminDomainError("INVALID_EXPORT_TERM", "学期指定は学期別出力でのみ使用できます。");
  if (query.gradeLevel !== undefined && ![1, 2, 3].includes(query.gradeLevel)) throw new AdminDomainError("INVALID_GRADE_LEVEL", "学年を正しく指定してください。");
  for (const value of [query.courseId, query.subjectId]) if (value !== undefined && (!value.trim() || value.length > 128)) throw new AdminDomainError("INVALID_EXPORT_FILTER", "絞り込み条件を正しく指定してください。");
  return { ...query, academicYear, years: resolveExportYears(academicYear, query.scope) };
};

export interface GradeExportService { preview(actorId: string, query: GradeExportQuery): Promise<GradeExportPreview>; download(actorId: string, token: string): Promise<{ csv: string; filename: string; rowCount: number }>; downloadPdf(actorId: string, token: string): Promise<{ pdf: ArrayBuffer; filename: string; rowCount: number }>; }
type ClaimedSnapshot = { academicYear: number; scope: GradeExportScope; claimId: string; claimedAt: number; rows: GradeExportRow[] };
export class PdfExportUnavailableError extends AdminDomainError {
  constructor(readonly retryAfter?: string) { super("PDF_EXPORT_UNAVAILABLE", "PDF出力を現在利用できません。時間をおいて再度お試しください。", 503); }
}

export class D1GradeExportService implements GradeExportService {
  constructor(private readonly database: D1Database, private readonly newId: () => string = () => createWorkerId(), private readonly clock: Clock = () => new Date(), private readonly browser?: BrowserBinding) {}
  private now() { return Math.floor(this.clock().getTime() / 1000); }
  private async currentYear() { return ensureCurrentAcademicYear(this.database, this.clock); }
  private async resolved(query: GradeExportQuery) { return validateGradeExportQuery(query, await this.currentYear()); }
  private where(query: ResolvedGradeExportQuery) {
    const clauses = ["g.academic_year IN (" + query.years.map(() => "?").join(",") + ")", "sts.is_finalized=1", "g.attendance_rate IS NOT NULL", "g.letter_grade IS NOT NULL", "g.attempt=(SELECT MAX(latest.attempt) FROM grades latest WHERE latest.student_id=g.student_id AND latest.subject_id=g.subject_id AND latest.academic_year=g.academic_year AND latest.term=g.term)"];
    const values: unknown[] = [...query.years];
    if (query.scope === "term") { clauses.push("g.term=?"); values.push(query.term!); }
    if (query.courseId) { clauses.push("s.course_id=?"); values.push(query.courseId); }
    if (query.gradeLevel) { clauses.push("sub.grade_level=?"); values.push(query.gradeLevel); }
    if (query.subjectId) { clauses.push("g.subject_id=?"); values.push(query.subjectId); }
    return { clauses, values };
  }
  private rowsFrom(result: { results?: GradeExportRow[] }) { return (result.results ?? []).map((row) => ({ ...row, id: String(row.id), academicYear: Number(row.academicYear), term: Number(row.term), gradeLevel: Number(row.gradeLevel), attendanceRate: Number(row.attendanceRate) })); }
  private async snapshotRows(token: string, actorId: string, claimId: string) {
    const result = await this.database.prepare("SELECT r.position AS id,r.student_number AS studentNumber,r.student_name AS studentName,r.academic_year AS academicYear,r.term,r.course_name AS courseName,r.grade_level AS gradeLevel,r.subject_name AS subjectName,r.attendance_rate AS attendanceRate,r.letter_grade AS letterGrade FROM grade_export_snapshot_rows r JOIN grade_export_snapshots s ON s.id=r.snapshot_id WHERE r.snapshot_id=? AND s.owner_user_id=? AND s.claim_id=? ORDER BY r.position").bind(token, actorId, claimId).all<GradeExportRow>();
    return this.rowsFrom(result);
  }
  private async claim(actorId: string, token: string, format: GradeExportFormat): Promise<ClaimedSnapshot> {
    if (!/^[A-Za-z0-9-]{16,128}$/.test(token)) throw new AdminDomainError("INVALID_EXPORT_TOKEN", "出力確認が期限切れです。もう一度件数を確認してください。");
    const claimedAt = this.now(); const claimId = this.newId();
    const snapshot = await this.database.prepare("UPDATE grade_export_snapshots SET claim_id=?,claimed_at=? WHERE id=? AND owner_user_id=? AND format=? AND expires_at>=? AND claim_id IS NULL RETURNING academic_year AS academicYear,scope AS scope").bind(claimId, claimedAt, token, actorId, format, claimedAt).first<{ academicYear: number; scope: GradeExportScope }>();
    if (!snapshot) {
      const existing = await this.database.prepare("SELECT owner_user_id AS ownerUserId,format AS format,expires_at AS expiresAt,claim_id AS claimId FROM grade_export_snapshots WHERE id=?").bind(token).first<{ ownerUserId: string; format: GradeExportFormat; expiresAt: number; claimId: string | null }>();
      if (!existing || existing.ownerUserId !== actorId) throw new AdminDomainError("EXPORT_SNAPSHOT_NOT_FOUND", "出力確認が見つかりません。もう一度件数を確認してください。", 404);
      if (existing.format !== format) throw new AdminDomainError("EXPORT_FORMAT_MISMATCH", "選択した出力形式で、もう一度件数を確認してください。", 409);
      throw new AdminDomainError("EXPORT_SNAPSHOT_EXPIRED", "出力確認が期限切れまたは使用済みです。もう一度件数を確認してください。", 410);
    }
    try { return { academicYear: Number(snapshot.academicYear), scope: snapshot.scope, claimId, claimedAt, rows: await this.snapshotRows(token, actorId, claimId) }; }
    catch (error) { await this.discard(token, actorId, claimId); throw error; }
  }
  private async discard(token: string, actorId: string, claimId: string) { await this.database.prepare("DELETE FROM grade_export_snapshots WHERE id=? AND owner_user_id=? AND claim_id=?").bind(token, actorId, claimId).run(); }
  private async complete(actorId: string, token: string, snapshot: ClaimedSnapshot, action: "grades_exported" | "grades_pdf_exported") {
    await this.database.batch([
      this.database.prepare("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) VALUES (?,?,?,'grade_export',?,?,?)").bind(this.newId(), actorId, action, "grades", snapshot.academicYear, JSON.stringify({ rowCount: snapshot.rows.length })),
      this.database.prepare("DELETE FROM grade_export_snapshots WHERE id=? AND owner_user_id=? AND claim_id=?").bind(token, actorId, snapshot.claimId),
    ]);
  }
  private async renderAndComplete<T>(actorId: string, token: string, format: GradeExportFormat, action: "grades_exported" | "grades_pdf_exported", render: (snapshot: ClaimedSnapshot) => Promise<T> | T) {
    const snapshot = await this.claim(actorId, token, format);
    try {
      const file = await render(snapshot);
      await this.complete(actorId, token, snapshot, action);
      return { snapshot, file };
    } catch (error) {
      // Rendering is not sent to the caller until the audit/delete transaction succeeds, so a failed
      // render/commit has no delivered PDF side effect and the immutable token is safely discarded.
      await this.discard(token, actorId, snapshot.claimId).catch(() => undefined);
      throw error;
    }
  }
  async preview(actorId: string, query: GradeExportQuery) {
    const resolved = await this.resolved(query); const snapshotId = this.newId(); const createdAt = this.now(); const expiresAt = createdAt + 15 * 60; const { clauses, values } = this.where(resolved);
    const insertRows = `INSERT INTO grade_export_snapshot_rows (snapshot_id,position,student_number,student_name,academic_year,term,course_name,grade_level,subject_name,attendance_rate,letter_grade) SELECT ?,row_number() OVER (ORDER BY g.academic_year,s.student_number,g.term,sub.name,g.id),s.student_number,s.name,g.academic_year,g.term,c.name,sub.grade_level,sub.name,g.attendance_rate,g.letter_grade FROM grades g JOIN students s ON s.id=g.student_id JOIN courses c ON c.id=s.course_id JOIN subjects sub ON sub.id=g.subject_id AND sub.academic_year=g.academic_year JOIN subject_term_statuses sts ON sts.subject_id=g.subject_id AND sts.term=g.term WHERE ${clauses.join(" AND ")}`;
    await this.database.batch([
      this.database.prepare("DELETE FROM grade_export_snapshots WHERE expires_at < ?").bind(createdAt),
      this.database.prepare("INSERT INTO grade_export_snapshots (id,owner_user_id,academic_year,scope,format,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(snapshotId, actorId, resolved.academicYear, resolved.scope, resolved.format, expiresAt, createdAt),
      this.database.prepare(insertRows).bind(snapshotId, ...values),
      this.database.prepare("UPDATE grade_export_snapshots SET owner_user_id=COALESCE((SELECT id FROM user WHERE id=? AND (SELECT count(*) FROM grade_export_snapshot_rows WHERE snapshot_id=?)<=?), '__grade_export_too_large__') WHERE id=?").bind(actorId, snapshotId, MAX_ROWS, snapshotId),
    ]);
    const row = await this.database.prepare("SELECT count(*) AS count FROM grade_export_snapshot_rows WHERE snapshot_id=?").bind(snapshotId).first<{ count: number }>();
    return { token: snapshotId, rowCount: Number(row?.count ?? 0), academicYear: resolved.academicYear, years: resolved.years, scope: resolved.scope, format: resolved.format };
  }
  async download(actorId: string, token: string) {
    const completed = await this.renderAndComplete(actorId, token, "csv", "grades_exported", (snapshot) => {
      const csv = toGradeCsv(snapshot.rows); if (new TextEncoder().encode(csv).byteLength > MAX_BYTES) throw new AdminDomainError("EXPORT_TOO_LARGE", "出力ファイルが上限（5MB）を超えています。条件を絞り込んでください。", 413);
      return csv;
    });
    return { csv: completed.file, filename: `成績一覧_${completed.snapshot.academicYear}年度.csv`, rowCount: completed.snapshot.rows.length };
  }
  async downloadPdf(actorId: string, token: string) {
    if (!this.browser) throw new PdfExportUnavailableError();
    const completed = await this.renderAndComplete(actorId, token, "pdf", "grades_pdf_exported", async (snapshot) => {
      try {
        const response = await this.browser!.quickAction("pdf", { html: toGradePdfHtml(snapshot.rows, { academicYear: snapshot.academicYear, scope: snapshot.scope, generatedAt: snapshot.claimedAt }), pdfOptions: gradePdfOptions });
        const retryAfter = response.status === 429 && /^[\x20-\x7e]{1,128}$/.test(response.headers.get("Retry-After") ?? "") ? response.headers.get("Retry-After")! : undefined;
        const contentType = response.headers.get("Content-Type") ?? "";
        if (!response.ok || !/^application\/pdf(?:\s*;|$)/i.test(contentType)) throw new PdfExportUnavailableError(retryAfter);
        const pdf = await response.arrayBuffer();
        if (pdf.byteLength === 0) throw new PdfExportUnavailableError();
        return pdf;
      } catch (error) {
        if (error instanceof PdfExportUnavailableError) throw error;
        console.error(JSON.stringify({ event: "grade_pdf_render_failed", errorType: error instanceof Error ? error.name : typeof error }));
        throw new PdfExportUnavailableError();
      }
    });
    return { pdf: completed.file, filename: `成績一覧_${completed.snapshot.academicYear}年度.pdf`, rowCount: completed.snapshot.rows.length };
  }
}
export const createGradeExportService = (database: D1Database, browser?: BrowserBinding) => new D1GradeExportService(database, undefined, undefined, browser);
export const unavailableGradeExportService: GradeExportService = { preview: async () => { throw new AdminDomainError("EXPORT_SERVICE_UNAVAILABLE", "成績CSV出力を利用できません。", 503); }, download: async () => { throw new AdminDomainError("EXPORT_SERVICE_UNAVAILABLE", "成績CSV出力を利用できません。", 503); }, downloadPdf: async () => { throw new AdminDomainError("PDF_EXPORT_UNAVAILABLE", "PDF出力を現在利用できません。", 503); } };
