import { AdminDomainError, validateYear } from "./service";
import { auditActionLabels, auditActions, auditEntityTypeLabels, auditEntityTypes, type AuditAction, type AuditEntityType } from "./audit-taxonomy";

type SqlRow = Record<string, unknown>;
export type { AuditAction, AuditEntityType } from "./audit-taxonomy";
export type IdempotencyStatus = "pending" | "succeeded" | "failed";
export type AuditQuery = { limit: number; cursor?: string; academicYear?: number; action?: string; actorId?: string; targetType?: AuditEntityType };
export type OperationQuery = { limit: number; cursor?: string; academicYear?: number; status?: IdempotencyStatus };

export type AuditService = {
  logs(query: AuditQuery): Promise<{ limit: number; nextCursor: string | null; items: AuditLogItem[] }>;
  actors(): Promise<{ items: Array<{ id: string; name: string }> }>;
  operations(query: OperationQuery): Promise<{ limit: number; nextCursor: string | null; items: IdempotencyOperationItem[] }>;
};

export type AuditLogItem = {
  id: string; occurredAt: number; action: AuditAction | "other"; actionLabel: string;
  actor: string; targetType: AuditEntityType | "other"; targetLabel: string; summary: string;
};
export type IdempotencyOperationItem = {
  id: string; operationType: "csv_import" | "annual_rollover"; operationLabel: string;
  status: IdempotencyStatus; statusLabel: string; academicYear: number | null;
  createdAt: number; completedAt: number | null; resultSummary: string;
};

export { auditActions } from "./audit-taxonomy";
const statuses = ["pending", "succeeded", "failed"] as const;
const asNumber = (value: unknown) => typeof value === "number" ? value : Number(value);
const text = (value: unknown) => String(value ?? "");
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isAction = (value: string): value is AuditAction => (auditActions as readonly string[]).includes(value);
const isEntityType = (value: string): value is AuditEntityType => (auditEntityTypes as readonly string[]).includes(value);
const isStatus = (value: string): value is IdempotencyStatus => (statuses as readonly string[]).includes(value);
const parseRecord = (raw: unknown) => {
  if (typeof raw !== "string" || raw.length > 8_000) return null;
  try { const value: unknown = JSON.parse(raw); return isRecord(value) ? value : null; } catch { return null; }
};
const integer = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : null;
const studentStatusLabel = (value: unknown) => ({ enrolled: "在籍", suspended: "休学", withdrawn: "退学", graduated: "卒業" })[String(value)] ?? "変更後の状態";
const teacherStatusLabel = (value: unknown) => ({ active: "利用中", leave: "休職", retired: "退職" })[String(value)] ?? "変更後の状態";

/** Only these derived labels leave the service. Raw audit payloads can contain personal data. */
export const summarizeAudit = (action: string, rawPayload: unknown) => {
  const payload = parseRecord(rawPayload);
  const year = integer(payload?.year);
  const effectiveYear = integer(payload?.effectiveAcademicYear);
  const term = integer(payload?.term);
  const courseCount = Array.isArray(payload?.courseIds) ? payload.courseIds.length : null;
  switch (action) {
    case "academic_year_selected": return year ? `${year}年度を現在年度に設定` : "現在年度を設定";
    case "annual_rollover_applied": return "年度更新を一括反映";
    case "csv_imported": return "通常CSVを一括取込";
    case "grades_exported": return "成績CSVを出力";
    case "grades_pdf_exported": return "成績PDFを出力";
    case "student_created": return "学生を登録";
    case "student_updated": return "学生情報を更新";
    case "student_status_changed": return `${studentStatusLabel(payload?.status)}に変更${effectiveYear ? `（${effectiveYear}年度適用）` : ""}`;
    case "teacher_created": return "講師アカウントを作成";
    case "teacher_status_changed": return `講師の利用状態を${teacherStatusLabel(payload?.status)}に変更`;
    case "staff_created": return "専任職員アカウントを作成";
    case "staff_status_changed": return `専任職員の利用状態を${teacherStatusLabel(payload?.status)}に変更`;
    case "password_reset_requested": return "パスワード再設定メールを送信";
    case "grade_corrected": return "成績を修正";
    case "grade_retake_created": return "再試験の成績を登録";
    case "subject_created": return `科目を登録${year ? `（${year}年度）` : ""}${courseCount !== null ? `・対象コース${courseCount}件` : ""}`;
    case "subject_updated": return `科目情報を更新${courseCount !== null ? `（対象コース${courseCount}件）` : ""}`;
    case "subject_term_finalized": return term === 1 || term === 2 ? `第${term}学期を確定` : "学期を確定";
    case "subject_term_reopened": return term === 1 || term === 2 ? `第${term}学期を再開` : "学期を再開";
    default: return "操作を記録";
  }
};
const actionLabel = (action: string) => isAction(action) ? auditActionLabels[action] : "その他の操作";
const targetLabel = (type: string) => isEntityType(type) ? auditEntityTypeLabels[type] : "その他";
const operationLabel = (type: string) => type === "annual_rollover" ? "年度更新" : "CSV取込";
const operationStatusLabel = (status: IdempotencyStatus) => ({ pending: "処理中", succeeded: "完了", failed: "失敗" })[status];
export const summarizeOperation = (status: IdempotencyStatus, rawResult: unknown) => {
  if (status === "pending") return "処理を実行しています";
  if (status === "failed") return "処理に失敗しました";
  const result = parseRecord(rawResult);
  const count = integer(result?.processed) ?? integer(result?.count) ?? integer(result?.created) ?? integer(result?.updated);
  return count === null ? "処理が完了しました" : `${count}件を処理しました`;
};

type Cursor = { createdAt: number; id: string };
const encodeCursor = (cursor: Cursor) => btoa(JSON.stringify([cursor.createdAt, cursor.id])).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const decodeCursor = (value: string | undefined): Cursor | null => {
  if (value === undefined) return null;
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AdminDomainError("INVALID_AUDIT_CURSOR", "続きの表示位置を正しく指定してください。");
  try {
    const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "number" || !Number.isInteger(parsed[0]) || parsed[0] < 0 || typeof parsed[1] !== "string" || !parsed[1] || parsed[1].length > 256) throw new Error("invalid cursor");
    return { createdAt: parsed[0], id: parsed[1] };
  } catch { throw new AdminDomainError("INVALID_AUDIT_CURSOR", "続きの表示位置を正しく指定してください。"); }
};
export const validateAuditQuery = (query: AuditQuery) => {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new AdminDomainError("INVALID_AUDIT_QUERY", "表示条件を正しく指定してください。");
  decodeCursor(query.cursor);
  if (query.academicYear !== undefined) validateYear(query.academicYear);
  if (query.action !== undefined && !isAction(query.action)) throw new AdminDomainError("INVALID_AUDIT_ACTION", "操作種別を正しく指定してください。");
  if (query.actorId !== undefined && (!query.actorId.trim() || query.actorId.length > 128)) throw new AdminDomainError("INVALID_AUDIT_ACTOR", "操作者を正しく指定してください。");
  if (query.targetType !== undefined && !isEntityType(query.targetType)) throw new AdminDomainError("INVALID_AUDIT_TARGET", "対象を正しく指定してください。");
  return query;
};
export const validateOperationQuery = (query: OperationQuery) => {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new AdminDomainError("INVALID_AUDIT_QUERY", "表示条件を正しく指定してください。");
  decodeCursor(query.cursor);
  if (query.academicYear !== undefined) validateYear(query.academicYear);
  if (query.status !== undefined && !isStatus(query.status)) throw new AdminDomainError("INVALID_OPERATION_STATUS", "処理状態を正しく指定してください。");
  return query;
};

export class D1AuditService implements AuditService {
  constructor(private readonly database: D1Database) {}
  private async first<T extends SqlRow>(statement: D1PreparedStatement) { return (await statement.first<T>()) ?? null; }
  private async rows<T extends SqlRow>(statement: D1PreparedStatement) { return (await statement.all<T>()).results ?? []; }
  async logs(query: AuditQuery) {
    validateAuditQuery(query);
    const cursor = decodeCursor(query.cursor);
    const clauses = ["1 = 1"]; const values: unknown[] = [];
    if (query.academicYear !== undefined) { clauses.push("a.academic_year = ?"); values.push(query.academicYear); }
    if (query.action) { clauses.push("a.action = ?"); values.push(query.action); }
    if (query.actorId) { clauses.push("a.actor_user_id = ?"); values.push(query.actorId); }
    if (query.targetType) { clauses.push("a.entity_type = ?"); values.push(query.targetType); }
    if (cursor) { clauses.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))"); values.push(cursor.createdAt, cursor.createdAt, cursor.id); }
    const where = clauses.join(" AND ");
    const rows = await this.rows<SqlRow>(this.database.prepare(`SELECT a.id, a.action, a.entity_type AS entityType, a.payload_json AS payloadJson, a.created_at AS createdAt, COALESCE(u.name, 'システム') AS actor FROM audit_logs a LEFT JOIN user u ON u.id = a.actor_user_id WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).bind(...values, query.limit + 1));
    const hasNext = rows.length > query.limit; const visible = rows.slice(0, query.limit);
    return { limit: query.limit, nextCursor: hasNext && visible.length > 0 ? encodeCursor({ createdAt: asNumber(visible.at(-1)?.createdAt), id: text(visible.at(-1)?.id) }) : null, items: visible.map((row): AuditLogItem => { const entityType = text(row.entityType); const targetType: AuditEntityType | "other" = isEntityType(entityType) ? entityType : "other"; const rawAction = text(row.action); const action: AuditLogItem["action"] = isAction(rawAction) ? rawAction : "other"; return { id: text(row.id), occurredAt: asNumber(row.createdAt), action, actionLabel: actionLabel(rawAction), actor: text(row.actor), targetType, targetLabel: targetLabel(entityType), summary: summarizeAudit(rawAction, row.payloadJson) }; }) };
  }
  async actors() {
    const rows = await this.rows<{ id: unknown; name: unknown }>(this.database.prepare("SELECT DISTINCT a.actor_user_id AS id, COALESCE(u.name, '削除済みの利用者') AS name FROM audit_logs a LEFT JOIN user u ON u.id = a.actor_user_id WHERE a.actor_user_id IS NOT NULL ORDER BY name, id LIMIT 100"));
    return { items: rows.map((row) => ({ id: text(row.id), name: text(row.name) })) };
  }
  async operations(query: OperationQuery) {
    validateOperationQuery(query);
    const cursor = decodeCursor(query.cursor);
    const clauses = ["1 = 1"]; const values: unknown[] = [];
    if (query.academicYear !== undefined) { clauses.push("academic_year = ?"); values.push(query.academicYear); }
    if (query.status !== undefined) { clauses.push("status = ?"); values.push(query.status); }
    if (cursor) { clauses.push("(created_at < ? OR (created_at = ? AND id < ?))"); values.push(cursor.createdAt, cursor.createdAt, cursor.id); }
    const where = clauses.join(" AND ");
    const rows = await this.rows<SqlRow>(this.database.prepare(`SELECT id, operation_type AS operationType, status, academic_year AS academicYear, result_json AS resultJson, created_at AS createdAt, completed_at AS completedAt FROM idempotency_operations WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values, query.limit + 1));
    const hasNext = rows.length > query.limit; const visible = rows.slice(0, query.limit);
    return { limit: query.limit, nextCursor: hasNext && visible.length > 0 ? encodeCursor({ createdAt: asNumber(visible.at(-1)?.createdAt), id: text(visible.at(-1)?.id) }) : null, items: visible.map((row): IdempotencyOperationItem => { const status = text(row.status); if (!isStatus(status)) throw new Error("Unexpected operation status from database"); const operationType: IdempotencyOperationItem["operationType"] = text(row.operationType) === "annual_rollover" ? "annual_rollover" : "csv_import"; return { id: text(row.id), operationType, operationLabel: operationLabel(text(row.operationType)), status, statusLabel: operationStatusLabel(status), academicYear: row.academicYear == null ? null : asNumber(row.academicYear), createdAt: asNumber(row.createdAt), completedAt: row.completedAt == null ? null : asNumber(row.completedAt), resultSummary: summarizeOperation(status, row.resultJson) }; }) };
  }
}

export const createAuditService = (database: D1Database) => new D1AuditService(database);
export const unavailableAuditService: AuditService = {
  logs: async () => { throw new AdminDomainError("AUDIT_SERVICE_UNAVAILABLE", "監査履歴を利用できません。時間をおいて再度お試しください。", 503); },
  actors: async () => { throw new AdminDomainError("AUDIT_SERVICE_UNAVAILABLE", "監査履歴を利用できません。時間をおいて再度お試しください。", 503); },
  operations: async () => { throw new AdminDomainError("AUDIT_SERVICE_UNAVAILABLE", "監査履歴を利用できません。時間をおいて再度お試しください。", 503); },
};
