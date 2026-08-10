import { describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";

import { account, session, user, verification } from "./schema";

describe("D1 Better Auth schema", () => {
  it("contains the four required tables and protected application fields", () => {
    expect(Object.keys(getTableColumns(user))).toEqual(expect.arrayContaining(["id", "email", "role", "status", "mustChangePassword"]));
    expect(Object.keys(getTableColumns(session))).toEqual(expect.arrayContaining(["token", "expiresAt", "userId"]));
    expect(Object.keys(getTableColumns(account))).toEqual(expect.arrayContaining(["providerId", "password", "userId"]));
    expect(Object.keys(getTableColumns(verification))).toEqual(expect.arrayContaining(["identifier", "value", "expiresAt"]));
  });
});
