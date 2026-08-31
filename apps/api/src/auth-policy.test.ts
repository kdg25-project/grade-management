import { describe, expect, it } from "bun:test";
import { APIError } from "better-auth/api";

import {
  isSuccessfulAuthResponse,
  createPasswordResetCompletionHandler,
  rejectsSignIn,
  shouldClearPasswordChangeRequirement,
} from "./auth-policy";

describe("Better Auth authorization hooks", () => {
  it("rejects inactive email/password sign-ins with the same hook path as normal sign-in", () => {
    expect(rejectsSignIn("/sign-in/email", "leave")).toBe(true);
    expect(rejectsSignIn("/sign-in/email", "retired")).toBe(true);
    expect(rejectsSignIn("/sign-in/email", "active")).toBe(false);
    expect(rejectsSignIn("/reset-password", "leave")).toBe(false);
  });

  it("clears the initial-password requirement only after a successful password change", () => {
    const failure = APIError.from("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" });
    expect(isSuccessfulAuthResponse(failure)).toBe(false);
    expect(shouldClearPasswordChangeRequirement("/change-password", failure)).toBe(false);
    expect(shouldClearPasswordChangeRequirement("/change-password", { status: true })).toBe(true);
    expect(shouldClearPasswordChangeRequirement("/reset-password", { status: true })).toBe(false);
  });

  it("uses the authoritative user supplied after a successful password reset", async () => {
    const cleared: string[] = [];
    await createPasswordResetCompletionHandler(async (userId) => { cleared.push(userId); })({ user: { id: "reset-user" } });
    expect(cleared).toEqual(["reset-user"]);
  });
});
