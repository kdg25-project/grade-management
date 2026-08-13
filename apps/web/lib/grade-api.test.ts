import { describe, expect, it } from "bun:test";

import { currentTermRedirect, destinationForApiError, GradeApiError } from "./grade-api";

describe("grade API error routing", () => {
  it("routes authentication failures to the appropriate recovery screen", () => {
    expect(destinationForApiError(new GradeApiError("UNAUTHORIZED", "", 401))).toBe("/login");
    expect(destinationForApiError(new GradeApiError("MUST_CHANGE_PASSWORD", "", 403))).toBe("/change-password");
    expect(destinationForApiError(new GradeApiError("ACCOUNT_INACTIVE", "", 403))).toBe("/account-inactive");
  });

  it("keeps ordinary permission failures in the current screen", () => {
    expect(destinationForApiError(new GradeApiError("FORBIDDEN", "", 403))).toBeNull();
  });

  it("identifies the current-term redirect only from typed conflict details", () => {
    expect(currentTermRedirect(new GradeApiError("TERM_NOT_CURRENTLY_EDITABLE", "", 409, 2))).toBe(2);
    expect(currentTermRedirect(new GradeApiError("TERM_NOT_EDITABLE", "", 409, 1))).toBeUndefined();
  });
});
