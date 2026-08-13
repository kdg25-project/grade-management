import { describe, expect, it } from "bun:test";

import { shouldAllowNavigation, shouldRestoreHistoryOnPopstate } from "./navigation-guard";

describe("navigation guard", () => {
  it("allows a clean page to navigate without prompting", () => {
    let prompted = false;
    expect(shouldAllowNavigation(false, () => { prompted = true; return false; })).toBeTrue();
    expect(prompted).toBeFalse();
  });

  it("blocks shell links when a dirty-page confirmation is declined", () => {
    expect(shouldAllowNavigation(true, () => false)).toBeFalse();
    expect(shouldAllowNavigation(true, () => true)).toBeTrue();
  });

  it("always blocks navigation while a save is in progress", () => {
    let prompted = false;
    expect(shouldAllowNavigation(false, () => { prompted = true; return true; }, true)).toBeFalse();
    expect(prompted).toBeFalse();
  });
  it("restores the history sentinel if a dirty browser-back navigation is declined or saving", () => {
    expect(shouldRestoreHistoryOnPopstate(true, () => false)).toBe(true);
    expect(shouldRestoreHistoryOnPopstate(true, () => true)).toBe(false);
    expect(shouldRestoreHistoryOnPopstate(false, () => true, true)).toBe(true);
  });
});
