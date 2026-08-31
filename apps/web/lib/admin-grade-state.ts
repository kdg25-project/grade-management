export type AdminGradeDraft = { attendanceRate: string; attitude: string; assignment: string; reason: string };
export const emptyAdminGradeDraft = (): AdminGradeDraft => ({ attendanceRate: "", attitude: "", assignment: "", reason: "" });
export const adminGradeDraftFromAttempt = (attempt: { attendanceRate: number | null; attitude: number | null; assignment: number | null }): AdminGradeDraft => ({ attendanceRate: attempt.attendanceRate === null ? "" : String(attempt.attendanceRate), attitude: attempt.attitude === null ? "" : String(attempt.attitude), assignment: attempt.assignment === null ? "" : String(attempt.assignment), reason: "" });
export const isAdminGradeDirty = (draft: AdminGradeDraft, initial: AdminGradeDraft) => Object.keys(draft).some((key) => draft[key as keyof AdminGradeDraft] !== initial[key as keyof AdminGradeDraft]);
export const adminGradePayload = (draft: AdminGradeDraft) => {
  const parse = (value: string) => value.trim() === "" ? null : Number(value);
  const values = { attendanceRate: parse(draft.attendanceRate), attitude: parse(draft.attitude), assignment: parse(draft.assignment), reason: draft.reason.trim() };
  if (!values.reason) return null;
  if ([values.attendanceRate, values.attitude, values.assignment].some((value) => value !== null && !Number.isInteger(value))) return null;
  if ((values.attendanceRate !== null && (values.attendanceRate < 0 || values.attendanceRate > 100)) || (values.attitude !== null && (values.attitude < 1 || values.attitude > 10)) || (values.assignment !== null && (values.assignment < 1 || values.assignment > 10))) return null;
  return values;
};
