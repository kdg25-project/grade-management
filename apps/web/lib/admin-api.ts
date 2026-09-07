import { apiClient } from "@/lib/hc";
import { GradeApiError } from "@/lib/grade-api";
import type { InferResponseType } from "hono/client";

type Failure = { error: { code: string; message: string } };
const isFailure = (body: unknown): body is Failure => typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "code" in body.error && "message" in body.error;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalidResponse = () => new GradeApiError("INVALID_RESPONSE", "サーバーから正しい応答を受け取れませんでした。入力内容は保持されています。", 502);
const success = <T>(body: T | Failure, status: number) => { if (isFailure(body)) throw new GradeApiError(body.error.code, body.error.message, status); if (status < 200 || status >= 300) throw new GradeApiError("REQUEST_FAILED", "操作に失敗しました。入力内容は保持されています。", status); return body; };
const isRowError = (value: unknown) => { const item = record(value); return Boolean(item && (item.row === undefined || item.row === null || typeof item.row === "number") && typeof item.file === "string" && typeof item.field === "string" && typeof item.reason === "string"); };
const isRolloverPreview = (value: unknown): value is RolloverPreviewResponse => { const item = record(value); const counts = record(item?.subjectCounts); return Boolean(item && typeof item.targetYear === "number" && typeof item.graduationCandidates === "number" && typeof item.teacherCount === "number" && typeof item.studentCount === "number" && counts && [1, 2, 3].every((grade) => typeof counts[grade] === "number") && Array.isArray(item.errors) && item.errors.every(isRowError)); };
const isImportCounts = (value: unknown) => { const item = record(value); const subjects = record(item?.subjects); return Boolean(item && typeof item.students === "number" && typeof item.teachers === "number" && typeof item.staff === "number" && subjects && [1, 2, 3].every((grade) => typeof subjects[grade] === "number")); };
const isNormalImportPreview = (value: unknown): value is NormalImportPreviewResponse => { const item = record(value); return Boolean(item && typeof item.academicYear === "number" && (item.token === undefined || typeof item.token === "string") && (item.expiresAt === undefined || typeof item.expiresAt === "number") && isImportCounts(item.counts) && Array.isArray(item.errors) && item.errors.every(isRowError)); };
const isCredential = (value: unknown) => { const item = record(value); return Boolean(item && typeof item.name === "string" && typeof item.email === "string" && (item.role === "teacher" || item.role === "admin") && typeof item.temporaryPassword === "string"); };
const isNormalImportApply = (value: unknown): value is NormalImportApplyResponse => { const item = record(value); return Boolean(item && item.applied === true && typeof item.replayed === "boolean" && typeof item.credentialsAlreadyIssued === "boolean" && isImportCounts(item.summary) && Array.isArray(item.credentials) && item.credentials.every(isCredential)); };

export async function getAdminYears() { const response = await apiClient.api.admin.years.$get(); return success(await response.json(), response.status); }
export async function selectAdminYear(year: number) { const response = await apiClient.api.admin.years.current.$post({ json: { year } }); return success(await response.json(), response.status); }
export type AdminStudentQuery = { academicYear?: number; search?: string; status?: "enrolled" | "suspended" | "withdrawn" | "graduated"; courseId?: string; enrollmentYear?: number; gradeLevel?: 1 | 2 | 3; page?: number; pageSize?: number };
export const adminStudentsRequestQuery = (query: AdminStudentQuery) => ({ page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20), academicYear: query.academicYear, search: query.search, courseId: query.courseId, enrollmentYear: query.enrollmentYear, gradeLevel: query.gradeLevel, status: query.status });
export async function getAdminStudents(query: AdminStudentQuery = {}, signal?: AbortSignal) { const response = await apiClient.api.admin.students.$get({ query: adminStudentsRequestQuery(query) }, { init: { signal } }); return success(await response.json(), response.status); }
export async function createAdminStudent(json: { studentNumber: string; name: string; nameKana: string; birthDate: string; gender: string; email?: string | null; phone?: string | null; postalCode?: string | null; address?: string | null; courseId: string; enrollmentYear: number }) { const response = await apiClient.api.admin.students.$post({ json }); return success(await response.json(), response.status); }
export async function updateAdminStudent(id: string, json: Parameters<typeof createAdminStudent>[0]) { const response = await apiClient.api.admin.students[":id"].$put({ param: { id }, json }); return success(await response.json(), response.status); }
export async function changeAdminStudentStatus(id: string, json: { status: "enrolled" | "suspended" | "withdrawn" | "graduated"; effectiveAcademicYear: number; reason: string }) { const response = await apiClient.api.admin.students[":id"].status.$post({ param: { id }, json }); return success(await response.json(), response.status); }
export async function getAdminTeachers(query: { search?: string; status?: "active" | "leave" | "retired" } = {}) { const response = await apiClient.api.admin.teachers.$get({ query: { search: query.search, status: query.status } }); return success(await response.json(), response.status); }
export async function createAdminTeacher(json: { name: string; email: string }) { const response = await apiClient.api.admin.teachers.$post({ json }); return success(await response.json(), response.status); }
export async function changeAdminTeacherStatus(id: string, status: "active" | "leave" | "retired") { const response = await apiClient.api.admin.teachers[":id"].status.$post({ param: { id }, json: { status } }); return success(await response.json(), response.status); }
const staffEndpoint = apiClient.api.admin.staff.$get;
export type AdminStaffResponse = InferResponseType<typeof staffEndpoint, 200>;
export async function getAdminStaff(query: { search?: string; status?: "active" | "leave" | "retired" } = {}) { const response = await staffEndpoint({ query: { search: query.search, status: query.status } }); return success(await response.json(), response.status); }
export async function createAdminStaff(json: { name: string; email: string }) { const response = await apiClient.api.admin.staff.$post({ json }); return success(await response.json(), response.status); }
export async function changeAdminStaffStatus(id: string, status: "active" | "leave" | "retired") { const response = await apiClient.api.admin.staff[":id"].status.$post({ param: { id }, json: { status } }); return success(await response.json(), response.status); }
export async function requestAdminAccountPasswordReset(id: string) { const response = await apiClient.api.admin.accounts[":id"]["password-reset"].$post({ param: { id } }); return success(await response.json(), response.status); }
export async function getAdminCatalog(signal?: AbortSignal) { const response = await apiClient.api.admin.catalog.$get({}, { init: { signal } }); return success(await response.json(), response.status); }
export async function getAdminMasterSubjects(year?: number) { const response = await apiClient.api.admin.master.subjects.$get({ query: { year } }); return success(await response.json(), response.status); }
export async function createAdminSubject(json: { name: string; gradeLevel: 1 | 2 | 3; teacherUserId: string; courseIds: string[]; academicYear?: number }) { const response = await apiClient.api.admin.master.subjects.$post({ json }); return success(await response.json(), response.status); }
export async function updateAdminSubject(id: string, json: Parameters<typeof createAdminSubject>[0]) { const response = await apiClient.api.admin.master.subjects[":id"].$put({ param: { id }, json }); return success(await response.json(), response.status); }

const auditEndpoint = apiClient.api.admin.audit.$get;
const auditActorsEndpoint = apiClient.api.admin.audit.actors.$get;
const auditOperationsEndpoint = apiClient.api.admin.audit.operations.$get;
export type AuditLogResponse = InferResponseType<typeof auditEndpoint, 200>;
export type AuditActorsResponse = InferResponseType<typeof auditActorsEndpoint, 200>;
export type AuditOperationsResponse = InferResponseType<typeof auditOperationsEndpoint, 200>;
export type AuditAction = Exclude<AuditLogResponse["items"][number]["action"], "other">;
export type AuditTargetType = Exclude<AuditLogResponse["items"][number]["targetType"], "other">;
export type OperationStatus = AuditOperationsResponse["items"][number]["status"];

export async function getAdminAudit(query: { limit?: number; cursor?: string; academicYear?: number; action?: AuditAction; actorId?: string; targetType?: AuditTargetType } = {}, signal?: AbortSignal) {
  const response = await apiClient.api.admin.audit.$get({ query: { limit: String(query.limit ?? 20), cursor: query.cursor, academicYear: query.academicYear, action: query.action, actorId: query.actorId, targetType: query.targetType } }, { init: { signal } });
  return success(await response.json(), response.status);
}
export async function getAdminAuditActors(signal?: AbortSignal) { const response = await apiClient.api.admin.audit.actors.$get({}, { init: { signal } }); return success(await response.json(), response.status); }
export async function getAdminAuditOperations(query: { limit?: number; cursor?: string; academicYear?: number; status?: OperationStatus } = {}, signal?: AbortSignal) {
  const response = await apiClient.api.admin.audit.operations.$get({ query: { limit: String(query.limit ?? 20), cursor: query.cursor, academicYear: query.academicYear, status: query.status } }, { init: { signal } });
  return success(await response.json(), response.status);
}

const rolloverPreviewEndpoint = apiClient.api.admin.rollover.preview.$post;
const rolloverApplyEndpoint = apiClient.api.admin.rollover.apply.$post;
export type RolloverPreviewResponse = InferResponseType<typeof rolloverPreviewEndpoint, 200>;
export type RolloverApplyResponse = InferResponseType<typeof rolloverApplyEndpoint, 200>;
export type RolloverInput = { targetYear: number; idempotencyKey?: string; teachersCsv: string; grade1SubjectsCsv: string; grade2SubjectsCsv: string; grade3SubjectsCsv: string; newStudentsCsv: string };
export async function previewRollover(json: RolloverInput, signal?: AbortSignal) { const response = await apiClient.api.admin.rollover.preview.$post({ json }, { init: { signal } }); const body = success(await response.json(), response.status); if (!isRolloverPreview(body)) throw invalidResponse(); return body; }
export async function applyRollover(json: RolloverInput & { idempotencyKey: string }) { const response = await apiClient.api.admin.rollover.apply.$post({ json }); const body = success(await response.json(), response.status); const item = record(body); if (!item || item.applied !== true || !isRolloverPreview(item.summary)) throw invalidResponse(); return body; }

const gradeExportPreviewEndpoint = apiClient.api.admin["grade-export"].preview.$post;
export type GradeExportPreviewResponse = InferResponseType<typeof gradeExportPreviewEndpoint, 200>;
export type GradeExportScope = "year_all_students" | "three_years" | "previous_year" | "confirmed_to_date" | "term";
export type GradeExportFormat = "csv" | "pdf";
export type GradeExportQuery = { academicYear?: number; scope: GradeExportScope; format: GradeExportFormat; term?: 1 | 2; courseId?: string; gradeLevel?: 1 | 2 | 3; subjectId?: string };
const exportQuery = (query: GradeExportQuery) => ({ academicYear: query.academicYear, scope: query.scope, format: query.format, term: query.term, courseId: query.courseId, gradeLevel: query.gradeLevel, subjectId: query.subjectId });
export async function previewGradeExport(query: GradeExportQuery, signal?: AbortSignal) { const response = await gradeExportPreviewEndpoint({ json: exportQuery(query) }, { init: { signal } }); return success(await response.json(), response.status); }
export async function downloadGradeExport(token: string, signal?: AbortSignal) { return apiClient.api.admin["grade-export"].download.$get({ query: { token } }, { init: { signal } }); }
export async function downloadGradePdf(token: string, signal?: AbortSignal) { return apiClient.api.admin["grade-export"].pdf.$get({ query: { token } }, { init: { signal } }); }

const normalImportPreviewEndpoint = apiClient.api.admin.imports.preview.$post;
const normalImportApplyEndpoint = apiClient.api.admin.imports.apply.$post;
export type NormalImportPreviewResponse = InferResponseType<typeof normalImportPreviewEndpoint, 200>;
export type NormalImportApplyResponse = InferResponseType<typeof normalImportApplyEndpoint, 200>;
export type NormalImportKind = "students" | "teachers" | "staff" | "subjects";
export type NormalImportInput = { academicYear: number; kind: NormalImportKind; csv: string; gradeLevel?: 1 | 2 | 3 };
export async function previewNormalImport(json: NormalImportInput, signal?: AbortSignal) { const response = await normalImportPreviewEndpoint({ json }, { init: { signal } }); const body = success(await response.json(), response.status); if (!isNormalImportPreview(body)) throw invalidResponse(); return body; }
export async function applyNormalImport(json: { token: string; idempotencyKey: string }) { const response = await normalImportApplyEndpoint({ json }); const body = success(await response.json(), response.status); if (!isNormalImportApply(body)) throw invalidResponse(); return body; }

export const responseShape = { isNormalImportPreview, isNormalImportApply, isRolloverPreview };

export type AdminYearsResponse = Awaited<ReturnType<typeof getAdminYears>>;
export type AdminStudentsResponse = Awaited<ReturnType<typeof getAdminStudents>>;
export type AdminCatalogResponse = Awaited<ReturnType<typeof getAdminCatalog>>;
export type AdminTeachersResponse = Awaited<ReturnType<typeof getAdminTeachers>>;
export type AdminStaffListResponse = Awaited<ReturnType<typeof getAdminStaff>>;
export type AdminSubjectsResponse = Awaited<ReturnType<typeof getAdminMasterSubjects>>;
