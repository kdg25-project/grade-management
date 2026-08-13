import { describe, expect, it } from "bun:test";

import { accountCapacity, canChangeAdminDraft, hasAdminUnsavedChanges, shouldWarnBeforeUnload, temporaryPasswordFromCreate } from "./admin-master-state";

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
});
