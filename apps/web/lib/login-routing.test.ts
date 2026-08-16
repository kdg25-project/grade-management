import { describe, expect, it } from "bun:test";

import { destinationForSignedInUser } from "./login-routing";

describe("post-login routing", () => {
  it("uses the user from the successful sign-in response for active roles", () => {
    expect(destinationForSignedInUser({ role: "admin", status: "active", mustChangePassword: false })).toBe("/admin");
    expect(destinationForSignedInUser({ role: "teacher", status: "active", mustChangePassword: false })).toBe("/teacher/subjects");
  });

  it("keeps mandatory password changes ahead of the role destination", () => {
    expect(destinationForSignedInUser({ role: "teacher", status: "active", mustChangePassword: true })).toBe("/change-password");
  });

  it("sends inactive users to the unavailable account screen", () => {
    expect(destinationForSignedInUser({ role: "admin", status: "leave", mustChangePassword: false })).toBe("/account-inactive");
    expect(destinationForSignedInUser({ role: "teacher", status: "retired", mustChangePassword: false })).toBe("/account-inactive");
  });

  it("does not invent a destination when a success response has no user", () => {
    expect(destinationForSignedInUser(undefined)).toBeNull();
    expect(destinationForSignedInUser(null)).toBeNull();
  });
});
