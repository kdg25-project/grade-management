import { describe, expect, it } from "bun:test";

import { canPerformDesktopAction, mobileReadOnlyMessage } from "./mobile-read-only";

describe("mobile read-only guard", () => {
  it("rejects protected actions on a mobile viewport and while busy", () => {
    expect(canPerformDesktopAction(true)).toBe(false);
    expect(canPerformDesktopAction(false, true)).toBe(false);
    expect(canPerformDesktopAction(false)).toBe(true);
    expect(mobileReadOnlyMessage).toContain("パソコンで操作");
  });
});
