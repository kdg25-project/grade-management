import { describe, expect, it } from "bun:test";

import { logoutErrorMessage, logoutFailureMessage, shouldStartLogout } from "./logout-state";

describe("logout state", () => {
  it("checks the navigation guard before starting logout", () => {
    let prompted = false;
    expect(shouldStartLogout(false, () => { prompted = true; return false; })).toBeFalse();
    expect(prompted).toBeTrue();
  });

  it("does not start a second logout while one is pending", () => {
    let prompted = false;
    expect(shouldStartLogout(true, () => { prompted = true; return true; })).toBeFalse();
    expect(prompted).toBeFalse();
  });

  it("accepts a clean successful logout response", () => {
    expect(shouldStartLogout(false, () => true)).toBeTrue();
    expect(logoutErrorMessage({ error: null })).toBeNull();
    expect(logoutErrorMessage(undefined)).toBeNull();
  });

  it("returns a sanitized message for an auth failure", () => {
    expect(logoutErrorMessage({ error: { message: "internal details" } })).toBe(logoutFailureMessage);
  });
});
