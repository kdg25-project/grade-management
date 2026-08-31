import type { GradeStudent, GradeWeights } from "@/lib/grade-api";

export type DraftValues = { attendanceRate: string; attitude: string; assignment: string };
export type DraftScore = Pick<NonNullable<GradeStudent["grade"]>, "finalScoreNumerator" | "finalScoreDenominator" | "letterGrade">;
export type DraftRow = { studentId: string; studentNumber: string; name: string; status: GradeStudent["status"]; editable: boolean; hasFailedHistory: boolean; values: DraftValues; score: DraftScore | null; legacyZeroFields?: GradeField[] };
export type GradeField = keyof DraftValues;

export const fieldRange: Record<GradeField, readonly [number, number]> = { attendanceRate: [0, 100], attitude: [1, 10], assignment: [1, 10] };
export const fieldLabel: Record<GradeField, string> = { attendanceRate: "出席率", attitude: "平常点", assignment: "課題点" };

export function rowsFromStudents(students: GradeStudent[]): DraftRow[] {
  return students.map((student) => {
    const values = { attendanceRate: student.grade?.attendanceRate == null ? "" : String(student.grade.attendanceRate), attitude: student.grade?.attitude == null ? "" : String(student.grade.attitude), assignment: student.grade?.assignment == null ? "" : String(student.grade.assignment) };
    const legacyZeroFields = (["attitude", "assignment"] as GradeField[]).filter((field) => values[field] === "0");
    return { studentId: student.id, studentNumber: student.studentNumber, name: student.name, status: student.status, editable: student.editable, hasFailedHistory: student.hasFailedHistory, values, score: student.grade, legacyZeroFields };
  });
}

export function validateDraftValue(field: GradeField, value: string): string | null {
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return "整数で入力してください。";
  const number = Number(value);
  const [min, max] = fieldRange[field];
  if (number < min || number > max) return `${min}〜${max}の範囲で入力してください。`;
  return null;
}

export function draftHasErrors(rows: DraftRow[]) {
  return rows.some((row) => (Object.keys(row.values) as GradeField[]).some((field) => !row.legacyZeroFields?.includes(field) && validateDraftValue(field, row.values[field]) !== null));
}

export const isGradeWriteEligible = (row: Pick<DraftRow, "editable" | "status">) => row.editable && row.status === "enrolled";

/** Old 0-valued records may be read, but must be explicitly replaced before any grade save. */
export const hasUnreplacedLegacyValues = (rows: DraftRow[]) => rows.some((row) => isGradeWriteEligible(row) && row.legacyZeroFields?.length);

export const canEditInViewport = (editable: boolean, mobile: boolean) => editable && !mobile;
export const canEditDraft = (editable: boolean, mobile: boolean, isSaving: boolean) => canEditInViewport(editable, mobile) && !isSaving;
export const canApplyDraftChange = (isSaving: boolean) => !isSaving;

/**
 * Grade writes and weight writes both recalculate the displayed result.  Do
 * not let two independent dirty drafts overwrite each other.
 */
/** A newly created subject has no persisted calculation rule yet. */
export const needsInitialWeightSave = (weights: GradeWeights | null, editable: boolean) => weights === null && editable;
export const canSaveGrades = (gradesDirty: boolean, weightsDirty: boolean, isSaving = false, hasPersistedWeights = true) => gradesDirty && !weightsDirty && !isSaving && hasPersistedWeights;
export const canSaveWeights = (gradesDirty: boolean, weightsDirty: boolean, isSaving = false) => weightsDirty && !gradesDirty && !isSaving;

export function draftPayload(rows: DraftRow[]) {
  return rows.filter(isGradeWriteEligible).map((row) => ({ studentId: row.studentId, attendanceRate: row.values.attendanceRate === "" ? null : Number(row.values.attendanceRate), attitude: row.values.attitude === "" ? null : Number(row.values.attitude), assignment: row.values.assignment === "" ? null : Number(row.values.assignment) }));
}

export function validateWeights(weights: GradeWeights) {
  const values = [weights.attendanceWeight, weights.attitudeWeight, weights.assignmentWeight];
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 100)) return "評価比重は0〜100の整数で入力してください。";
  if (values.reduce((total, value) => total + value, 0) !== 100) return "評価比重の合計を100にしてください。";
  return null;
}

export function previewScore(values: DraftValues, weights: GradeWeights): DraftScore | null {
  if (validateWeights(weights) || draftHasErrors([{ studentId: "preview", studentNumber: "", name: "", status: "enrolled", editable: true, hasFailedHistory: false, values, score: null }])) return null;
  if (values.attendanceRate === "" || values.attitude === "" || values.assignment === "") return null;
  const numerator = Number(values.attendanceRate) * weights.attendanceWeight + Number(values.attitude) * 10 * weights.attitudeWeight + Number(values.assignment) * 10 * weights.assignmentWeight;
  return { finalScoreNumerator: numerator, finalScoreDenominator: 100, letterGrade: numerator >= 9000 ? "S" : numerator >= 8000 ? "A" : numerator >= 7000 ? "B" : numerator >= 6000 ? "C" : "F" };
}

export function previewRows(rows: DraftRow[], weights: GradeWeights) {
  return rows.map((row) => ({ ...row, score: previewScore(row.values, weights) ?? row.score }));
}

export function formatScore(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (numerator == null || denominator == null || denominator === 0) return "未算出";
  return `${(numerator / denominator).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}/100`;
}
