import { describe, expect, it } from "bun:test";

import { accountCapacity, canChangeAdminDraft, canSubmitAdminCreation, hasAdminUnsavedChanges, isHistoricalStudentView, shouldWarnBeforeUnload, studentMutationAcademicYear, temporaryPasswordFromCreate } from "./admin-master-state";

describe("admin master form state", () => {
  it("treats an open status dialog as an unsaved change and clears it on cancel", () => {
    expect(hasAdminUnsavedChanges(false, true)).toBeTrue();
    expect(hasAdminUnsavedChanges(false, false)).toBeFalse();
  });

  it("warns before unload during a save even without dirty form fields", () => {
    expect(shouldWarnBeforeUnload(false, true)).toBeTrue();
    expect(canChangeAdminDraft(true)).toBeFalse();
  });

  it("keeps the one-time password response as display state", () => {
    expect(temporaryPasswordFromCreate("Temp!Password99")).toBe("Temp!Password99");
  });

  it("counts active and leave accounts, but not retired accounts, for the visible cap", () => {
    expect(accountCapacity([{ status: "active" }, { status: "leave" }, { status: "retired" }], 3)).toEqual({ used: 2, maximum: 3 });
  });

  it("keeps student mutations on the current academic year, not the displayed history year", () => {
    expect(studentMutationAcademicYear(2027)).toBe(2027);
  });

  it("keeps the navigation guard for dialogs while leaving creation eligibility to formDirty", () => {
    expect(hasAdminUnsavedChanges(false, true)).toBeTrue();
    expect(canSubmitAdminCreation(false)).toBeFalse();
    expect(canSubmitAdminCreation(true)).toBeTrue();
  });

  it("recognizes only a non-current selected year as a historical student view", () => {
    expect(isHistoricalStudentView(2026, 2027)).toBeTrue();
    expect(isHistoricalStudentView(2027, 2027)).toBeFalse();
  });
});
