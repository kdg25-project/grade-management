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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isGradeStatus = (value: unknown): value is GradeStatus => value === "enrolled" || value === "suspended" || value === "withdrawn" || value === "graduated";
const isLetterGrade = (value: unknown) => value === null || value === "S" || value === "A" || value === "B" || value === "C" || value === "F";
const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number => Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
const isNullableIntegerInRange = (value: unknown, minimum: number, maximum: number) => value === null || isIntegerInRange(value, minimum, maximum);
const gradeNumerator = (attendanceRate: number, attitude: number, assignment: number, weights: GradeWeights) => attendanceRate * weights.attendanceWeight + attitude * 10 * weights.attitudeWeight + assignment * 10 * weights.assignmentWeight;
const letterGradeForNumerator = (numerator: number) => numerator >= 9_000 ? "S" : numerator >= 8_000 ? "A" : numerator >= 7_000 ? "B" : numerator >= 6_000 ? "C" : "F";

function isValidGrade(grade: Record<string, unknown>, weights: GradeWeights | null) {
  if (!Number.isInteger(grade.attempt) || (grade.attempt as number) < 1
    || !isNullableIntegerInRange(grade.attendanceRate, 0, 100)
    || !isNullableIntegerInRange(grade.attitude, 0, 10)
    || !isNullableIntegerInRange(grade.assignment, 0, 10)
    || !isLetterGrade(grade.letterGrade)) return false;

  const inputs = [grade.attendanceRate, grade.attitude, grade.assignment];
  if (inputs.some((input) => input === null)) {
    return grade.finalScoreNumerator === null && grade.finalScoreDenominator === null && grade.letterGrade === null;
  }
  if (!weights || !isIntegerInRange(grade.finalScoreNumerator, 0, 10_000) || grade.finalScoreDenominator !== 100 || typeof grade.letterGrade !== "string") return false;
  const numerator = gradeNumerator(grade.attendanceRate as number, grade.attitude as number, grade.assignment as number, weights);
  return grade.finalScoreNumerator === numerator && grade.letterGrade === letterGradeForNumerator(numerator);
}

/**
 * Hono's inferred response type is compile-time only. Validate the payload at
 * the browser boundary so an incomplete or malformed successful response
 * cannot crash the grade editor while rendering.
 */
export function parseTeacherGradesResponse(value: unknown): GradesResponse {
  if (!isRecord(value) || !Number.isInteger(value.academicYear) || typeof value.editable !== "boolean" || typeof value.isFinalized !== "boolean" || (value.isFinalized && value.editable) || !Array.isArray(value.students)) {
    throw new GradeApiError("INVALID_GRADE_RESPONSE", "成績データの形式が正しくありません。", 502);
  }

  const validWeights = value.weights === null || (isRecord(value.weights)
    && [value.weights.attendanceWeight, value.weights.attitudeWeight, value.weights.assignmentWeight].every((weight) => isIntegerInRange(weight, 0, 100))
    && (value.weights.attendanceWeight as number) + (value.weights.attitudeWeight as number) + (value.weights.assignmentWeight as number) === 100);
  const weights = validWeights && value.weights !== null ? value.weights as GradeWeights : null;
  if (!validWeights || !value.students.every((student) => {
    if (!isRecord(student) || typeof student.id !== "string" || typeof student.studentNumber !== "string" || typeof student.name !== "string" || !isGradeStatus(student.status) || typeof student.editable !== "boolean" || typeof student.hasFailedHistory !== "boolean" || student.editable !== (student.status === "enrolled")) return false;
    if (student.grade === null) return true;
    return weights !== null && isRecord(student.grade) && isValidGrade(student.grade, weights);
  })) {
    throw new GradeApiError("INVALID_GRADE_RESPONSE", "成績データの形式が正しくありません。", 502);
  }

  return value as GradesResponse;
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
  return parseTeacherGradesResponse(await response.json());
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
