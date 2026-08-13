import { apiClient } from "@/lib/hc";
import type { InferResponseType } from "hono/client";

export type Term = 1 | 2;
export type GradeStatus = "enrolled" | "suspended" | "withdrawn" | "graduated";
export type GradeSubject = {
  id: string;
  name: string;
  academicYear: number;
  gradeLevel: number;
  editable: boolean;
  editableTerm: Term | null;
  termStatuses: { term: Term; isFinalized: boolean }[];
};
export type GradeWeights = {
  attendanceWeight: number;
  attitudeWeight: number;
  assignmentWeight: number;
};
export type GradeStudent = {
  id: string;
  studentNumber: string;
  name: string;
  status: GradeStatus;
  editable: boolean;
  /** Sticky, finalized F history for this student/subject/term. */
  hasFailedHistory: boolean;
  grade: {
    attempt: number;
    attendanceRate: number | null;
    attitude: number | null;
    assignment: number | null;
    finalScoreNumerator: number | null;
    finalScoreDenominator: number | null;
    letterGrade: "S" | "A" | "B" | "C" | "F" | null;
  } | null;
};
const teacherSubjectsEndpoint = apiClient.api.teacher.subjects.$get;
const teacherGradesEndpoint = apiClient.api.teacher.subjects[":id"].grades.$get;
const adminSubjectsEndpoint = apiClient.api.admin.subjects.$get;
const adminGradesEndpoint = apiClient.api.admin.grades.$get;
const adminGradeDetailEndpoint = apiClient.api.admin.grades[":id"].$get;
export type TeacherSubjectsResponse = InferResponseType<typeof teacherSubjectsEndpoint, 200>;
export type GradesResponse = InferResponseType<typeof teacherGradesEndpoint, 200>;
export type AdminSubject = GradeSubject & {
  completion: Record<Term, { complete: number; eligible: number }>;
};
export type AdminSubjectsResponse = InferResponseType<typeof adminSubjectsEndpoint, 200>;
export type AdminGradesResponse = InferResponseType<typeof adminGradesEndpoint, 200>;
export type AdminGradeDetailResponse = InferResponseType<typeof adminGradeDetailEndpoint, 200>;

const errorMessages: Record<string, string> = {
  UNAUTHORIZED: "ログインの有効期限が切れました。もう一度ログインしてください。",
  FORBIDDEN: "この操作を行う権限がありません。",
  MUST_CHANGE_PASSWORD: "最初にパスワードを変更してください。",
  ACCOUNT_INACTIVE: "このアカウントは現在利用できません。",
  TERM_NOT_EDITABLE: "この学期の成績は現在入力できません。",
  TERM_NOT_CURRENTLY_EDITABLE: "いま入力する学期へ移動します。",
  INVALID_GRADE_INPUT: "入力値を確認してください。",
  INVALID_WEIGHTS: "評価比重は整数で、合計100になるよう入力してください。",
  INCOMPLETE_GRADES: "未入力の成績があるため確定できません。",
  REOPEN_REASON_REQUIRED: "再開理由を入力してください。",
  GRADE_SERVICE_UNAVAILABLE: "成績機能を利用できません。時間をおいて再度お試しください。",
};

export class GradeApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly currentTerm?: Term) {
    super(errorMessages[code] ?? message);
  }
}

export const destinationForApiError = (error: unknown) => {
  if (!(error instanceof GradeApiError)) return null;
  if (error.code === "MUST_CHANGE_PASSWORD") return "/change-password";
  if (error.code === "ACCOUNT_INACTIVE") return "/account-inactive";
  if (error.status === 401 || error.code === "UNAUTHORIZED") return "/login";
  return null;
};

type ErrorBody = { error?: { code?: string; message?: string; details?: { currentTerm?: unknown } } };
const isErrorBody = (body: unknown): body is ErrorBody => typeof body === "object" && body !== null && "error" in body;
function throwApiError(status: number, body: unknown): never {
  const error = isErrorBody(body) ? body.error : undefined;
  const code = error?.code ?? (status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR");
  const currentTerm = error?.details?.currentTerm === 1 || error?.details?.currentTerm === 2 ? error.details.currentTerm : undefined;
  throw new GradeApiError(code, error?.message ?? "処理に失敗しました。", status, currentTerm);
}

export const currentTermRedirect = (error: unknown) => error instanceof GradeApiError && error.code === "TERM_NOT_CURRENTLY_EDITABLE" ? error.currentTerm : undefined;

export async function getTeacherSubjects(year?: number, signal?: AbortSignal) {
  const response = await apiClient.api.teacher.subjects.$get({ query: year ? { year: String(year) } : {} }, { init: { signal } });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function getTeacherGrades(subjectId: string, term: Term, year?: number, signal?: AbortSignal) {
  const response = await apiClient.api.teacher.subjects[":id"].grades.$get({ param: { id: subjectId }, query: { term: String(term), ...(year ? { year: String(year) } : {}) } }, { init: { signal } });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function saveTeacherGrades(subjectId: string, term: Term, grades: Array<{ studentId: string; attendanceRate: number | null; attitude: number | null; assignment: number | null }>) {
  const response = await apiClient.api.teacher.subjects[":id"].grades.$put({ param: { id: subjectId }, query: { term: String(term) }, json: { grades } });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function saveTeacherWeights(subjectId: string, term: Term, weights: GradeWeights) {
  const response = await apiClient.api.teacher.subjects[":id"].weights.$put({ param: { id: subjectId }, query: { term: String(term) }, json: weights });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function getAdminSubjects(year?: number, signal?: AbortSignal) {
  const response = await apiClient.api.admin.subjects.$get({ query: year ? { year: String(year) } : {} }, { init: { signal } });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function finalizeSubject(subjectId: string, term: Term) {
  const response = await apiClient.api.admin.subjects[":id"].terms[":term"].finalize.$post({ param: { id: subjectId, term: String(term) } });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function reopenSubject(subjectId: string, term: Term, reason: string) {
  const response = await apiClient.api.admin.subjects[":id"].terms[":term"].reopen.$post({ param: { id: subjectId, term: String(term) }, json: { reason } });
  if (!response.ok) throwApiError(response.status, await response.json());
  return response.json();
}

export async function getAdminGrades(query: { academicYear?: number; term?: Term; courseId?: string; gradeLevel?: 1 | 2 | 3; subjectId?: string; studentSearch?: string; letterGrade?: "S" | "A" | "B" | "C" | "F"; limit?: number } = {}, signal?: AbortSignal) {
  const response = await adminGradesEndpoint({ query: { academicYear: query.academicYear, term: query.term, courseId: query.courseId, gradeLevel: query.gradeLevel, subjectId: query.subjectId, studentSearch: query.studentSearch, letterGrade: query.letterGrade, limit: String(query.limit ?? 50) } }, { init: { signal } });
  if (!response.ok) throwApiError(response.status, await response.json()); return response.json();
}
export async function getAdminGradeDetail(id: string, signal?: AbortSignal) { const response = await adminGradeDetailEndpoint({ param: { id } }, { init: { signal } }); if (!response.ok) throwApiError(response.status, await response.json()); return response.json(); }
export async function correctAdminGrade(id: string, json: { attendanceRate: number | null; attitude: number | null; assignment: number | null; reason: string }) { const response = await apiClient.api.admin.grades[":id"].correction.$put({ param: { id }, json }); if (!response.ok) throwApiError(response.status, await response.json()); return response.json(); }
export async function createAdminRetake(id: string, json: { attendanceRate: number | null; attitude: number | null; assignment: number | null; reason: string }) { const response = await apiClient.api.admin.grades[":id"].retake.$post({ param: { id }, json }); if (!response.ok) throwApiError(response.status, await response.json()); return response.json(); }
