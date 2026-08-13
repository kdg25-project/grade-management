import type { AuditAction, AuditTargetType, OperationStatus } from "./admin-api";
import { auditActionLabels, auditActions, auditEntityTypeLabels, auditEntityTypes } from "@grade-management/api/audit-taxonomy";

export const auditActionOptions: Array<{ value: AuditAction; label: string }> = auditActions.map((value) => ({ value, label: auditActionLabels[value] }));
export const auditTargetOptions: Array<{ value: AuditTargetType; label: string }> = auditEntityTypes.map((value) => ({ value, label: auditEntityTypeLabels[value] }));
export const operationStatusOptions: Array<{ value: OperationStatus; label: string }> = [
  { value: "pending", label: "処理中" }, { value: "succeeded", label: "完了" }, { value: "failed", label: "失敗" },
];
export const formatAuditTime = (value: number) => new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value * 1000));
export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));
