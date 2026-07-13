import { describe, expect, it } from "bun:test";

import { authClient } from "./auth-client";

type AuthUser = typeof authClient.$Infer.Session.user;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

describe("authClient", () => {
  it("infers server-defined user fields without a runtime request", () => {
    const fieldTypes: [
      Equal<AuthUser["role"], "admin" | "teacher">,
      Equal<AuthUser["status"], "active" | "leave" | "retired">,
      Equal<AuthUser["mustChangePassword"], boolean>,
    ] = [true, true, true];

    expect(fieldTypes).toEqual([true, true, true]);
  });
});
