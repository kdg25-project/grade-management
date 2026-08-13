export const hasAdminUnsavedChanges = (formDirty: boolean, statusDialogOpen: boolean) => formDirty || statusDialogOpen;
export const shouldWarnBeforeUnload = (hasUnsavedChanges: boolean, isSaving: boolean) => hasUnsavedChanges || isSaving;
export const canChangeAdminDraft = (isSaving: boolean) => !isSaving;
export const temporaryPasswordFromCreate = (password: string) => password;
export const accountCapacity = (items: ReadonlyArray<{ status: "active" | "leave" | "retired" }>, maximum: number) => ({ used: items.filter((item) => item.status !== "retired").length, maximum });
