export const hasAdminUnsavedChanges = (formDirty: boolean, statusDialogOpen: boolean) => formDirty || statusDialogOpen;
export const canSubmitAdminCreation = (formDirty: boolean) => formDirty;
export const shouldWarnBeforeUnload = (hasUnsavedChanges: boolean, isSaving: boolean) => hasUnsavedChanges || isSaving;
export const canChangeAdminDraft = (isSaving: boolean) => !isSaving;
export const temporaryPasswordFromCreate = (password: string) => password;
export const accountCapacity = (items: ReadonlyArray<{ status: "active" | "leave" | "retired" }>, maximum: number) => ({ used: items.filter((item) => item.status !== "retired").length, maximum });
export const studentMutationAcademicYear = (currentAcademicYear: number) => currentAcademicYear;
export const isHistoricalStudentView = (displayedAcademicYear: number | undefined, currentAcademicYear: number | undefined) => displayedAcademicYear !== undefined && currentAcademicYear !== undefined && displayedAcademicYear !== currentAcademicYear;
