import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import {
  bypassesActiveSessionPolicy,
  createActiveUserSessionPolicy,
  sessionIdentity,
} from "./session-policy";

const d1Adapter = (database: Database) => ({
  prepare(query: string) {
    const build = (values: unknown[]) => {
      const statement = database.query(query) as unknown as {
        get(...args: unknown[]): unknown;
        run(...args: unknown[]): { changes: number };
      };
      return {
        bind: (...next: unknown[]) => build(next),
        first: async <T>() => statement.get(...values) as T | null,
        run: async () => ({ meta: { changes: statement.run(...values).changes } }),
      };
    };
    return build([]);
  },
}) as unknown as D1Database;

describe("active user session policy", () => {
  it("atomically replaces the active token so the older token is rejected", async () => {
    const database = new Database(":memory:");
    try {
      database.exec("CREATE TABLE active_user_sessions (user_id TEXT PRIMARY KEY, session_token TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      const policy = createActiveUserSessionPolicy(d1Adapter(database));

      await policy.activate({ userId: "user-1", token: "token-old" });
      await policy.activate({ userId: "user-1", token: "token-new" });

      expect(await policy.permits({ userId: "user-1", token: "token-old" })).toBe(false);
      expect(await policy.permits({ userId: "user-1", token: "token-new" })).toBe(true);
      expect(database.query("SELECT user_id, session_token FROM active_user_sessions").all()).toEqual([
        { user_id: "user-1", session_token: "token-new" },
      ]);
    } finally {
      database.close();
    }
  });

  it("fails closed for a missing marker and database read failure", async () => {
    const database = new Database(":memory:");
    try {
      database.exec("CREATE TABLE active_user_sessions (user_id TEXT PRIMARY KEY, session_token TEXT NOT NULL, updated_at INTEGER NOT NULL)");
      expect(await createActiveUserSessionPolicy(d1Adapter(database)).permits({ userId: "user-1", token: "token-1" })).toBe(false);
      expect(await createActiveUserSessionPolicy({ prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database)
        .permits({ userId: "user-1", token: "token-1" })).toBe(false);
    } finally {
      database.close();
    }
  });

  it("only bypasses session establishment, recovery, and sign-out paths", () => {
    expect(bypassesActiveSessionPolicy("/sign-in/email")).toBe(true);
    expect(bypassesActiveSessionPolicy("/callback/google")).toBe(true);
    expect(bypassesActiveSessionPolicy("/sign-out")).toBe(true);
    expect(bypassesActiveSessionPolicy("/get-session")).toBe(false);
    expect(bypassesActiveSessionPolicy("/future-authenticated-endpoint")).toBe(false);
  });

  it("extracts only complete user/token identities", () => {
    expect(sessionIdentity({ user: { id: "user-1" }, session: { token: "token-1" } })).toEqual({ userId: "user-1", token: "token-1" });
    expect(sessionIdentity({ user: { id: "user-1" }, session: {} })).toBeNull();
  });
});
