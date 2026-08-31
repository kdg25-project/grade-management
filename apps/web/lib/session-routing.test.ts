import { describe, expect, it } from "bun:test";

import { destinationForUser, isAllowedRoute } from "./session-routing";

describe("session routing", () => {
  it("prioritizes mandatory password changes over role destinations", () => {
    expect(destinationForUser({ role: "admin", status: "active", mustChangePassword: true })).toBe("/change-password");
  });

  it("routes active users to their server-assigned role area", () => {
    expect(destinationForUser({ role: "admin", status: "active", mustChangePassword: false })).toBe("/admin");
    expect(destinationForUser({ role: "teacher", status: "active", mustChangePassword: false })).toBe("/teacher/subjects");
  });

  it("does not use a hidden client view as an authorization boundary", () => {
    const teacher = { role: "teacher" as const, status: "active" as const, mustChangePassword: false };
    expect(isAllowedRoute("/teacher/subjects", teacher)).toBe(true);
    expect(isAllowedRoute("/admin", teacher)).toBe(false);
    expect(isAllowedRoute("/administrator", { role: "admin", status: "active", mustChangePassword: false })).toBe(false);
  });

  for (const status of ["leave", "retired"] as const) {
    for (const role of ["admin", "teacher"] as const) {
      it(`sends a ${status} ${role} to the unavailable account screen`, () => {
        const user = { role, status, mustChangePassword: true };
        expect(destinationForUser(user)).toBe("/account-inactive");
        expect(isAllowedRoute("/change-password", user)).toBe(false);
        expect(isAllowedRoute("/admin", user)).toBe(false);
        expect(isAllowedRoute("/teacher/subjects", user)).toBe(false);
        expect(isAllowedRoute("/account-inactive", user)).toBe(true);
      });
    }
  }
});
