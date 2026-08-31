import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { hashPassword } from "better-auth/crypto";

import { createApp, normalizeGetSessionResponse, readCurrentAuthSession } from "./app";
import { createAuthRuntime, type AuthEnvironment } from "./auth";
import { unavailableGradeService } from "./grade/service";

const migrationFiles = Array.from({ length: 13 }, (_, index) => new URL(
  `../../../packages/db/drizzle/${String(index).padStart(4, "0")}_${[
    "zippy_rumiko_fujikawa", "redundant_shen", "luxuriant_silverclaw", "outstanding_lady_ursula",
    "white_violations", "naive_machine_man", "natural_lucky_pierre", "wild_prism", "parched_tomorrow_man",
    "quiet_mimic", "unique_mister_fear", "lazy_star_brand", "mixed_robin_chapel",
  ][index]}.sql`, import.meta.url));

type BoundStatement = {
  bind: (...next: unknown[]) => BoundStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  raw: () => Promise<unknown[][]>;
  run: () => Promise<{ meta: { changes: number } }>;
};

const d1Adapter = (database: Database, failMarkerWrites = false) => ({
  prepare(query: string) {
    const build = (values: unknown[]): BoundStatement => {
      if (failMarkerWrites && query.includes("INSERT INTO active_user_sessions")) {
        return {
          bind: (...next: unknown[]) => build(next),
          first: async <T>() => null as T | null,
          all: async <T>() => ({ results: [] as T[] }),
          raw: async () => [],
          run: async () => { throw new Error("marker database unavailable"); },
        };
      }
      const statement = database.query(query) as unknown as {
        get(...args: unknown[]): unknown;
        all(...args: unknown[]): unknown[];
        run(...args: unknown[]): { changes: number };
      };
      return {
        bind: (...next: unknown[]) => build(next),
        first: async <T>() => statement.get(...values) as T | null,
        all: async <T>() => ({ results: statement.all(...values) as T[] }),
        raw: async () => statement.all(...values).map((row) => Object.values(row as object)),
        run: async () => ({ meta: { changes: statement.run(...values).changes } }),
      };
    };
    return build([]);
  },
  async batch(statements: BoundStatement[]) {
    database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
}) as unknown as D1Database;

const createDatabase = async () => {
  const database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const migrationFile of migrationFiles) {
    const migration = await Bun.file(migrationFile).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement);
    }
  }
  database.exec("INSERT INTO user (id, name, email, role, status, must_change_password) VALUES ('user-1', '講師', 'teacher@example.test', 'teacher', 'active', 0)");
  database.query("INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES ('account-1', 'user-1', 'credential', 'user-1', ?)")
    .run(await hashPassword("password-1"));
  if ((database.query("SELECT count(*) AS count FROM account").get() as { count: number }).count !== 1) {
    throw new Error("credential fixture was not created");
  }
  return database;
};

const runtimeApp = (database: Database, failMarkerWrites = false) => {
  const environment: AuthEnvironment = {
    DB: d1Adapter(database, failMarkerWrites),
    BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-better-auth",
    BETTER_AUTH_URL: "http://localhost/api/auth",
    BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost",
    EMAIL_FROM: "noreply@example.test",
  };
  const runtime = createAuthRuntime(environment);
  return createApp({
    authHandler: async (request) => normalizeGetSessionResponse(request, await runtime.auth.handler(request)),
    readSession: (headers) => readCurrentAuthSession(
      (sessionHeaders) => runtime.auth.api.getSession({ headers: sessionHeaders }),
      headers,
      runtime.activeUserSessions,
    ),
    gradeService: unavailableGradeService,
  });
};

const signIn = async (app: ReturnType<typeof runtimeApp>) => {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ email: "teacher@example.test", password: "password-1" }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(response.status).toBe(200);
  expect(cookie).toBeTruthy();
  return cookie!;
};

describe("single-session Better Auth integration", () => {
  it("rejects the old token everywhere while retaining the newly issued token", async () => {
    const database = await createDatabase();
    try {
      const app = runtimeApp(database);
      const oldCookie = await signIn(app);
      const newCookie = await signIn(app);

      expect((await app.request("/api/session", { headers: { cookie: oldCookie } })).status).toBe(401);
      const oldGetSession = await app.request("/api/auth/get-session", { headers: { cookie: oldCookie } });
      expect(oldGetSession.status).toBe(200);
      expect(await oldGetSession.json()).toBeNull();
      expect((await app.request("/api/auth/change-password", {
        method: "POST", headers: { cookie: oldCookie, "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ currentPassword: "password-1", newPassword: "password-2" }),
      })).status).toBe(401);
      const markerBeforeOldSignOut = database.query("SELECT session_token FROM active_user_sessions WHERE user_id='user-1'").get();
      expect((await app.request("/api/auth/sign-out", { method: "POST", headers: { cookie: oldCookie, origin: "http://localhost" } })).status).toBe(200);
      expect(database.query("SELECT session_token FROM active_user_sessions WHERE user_id='user-1'").get()).toEqual(markerBeforeOldSignOut);
      expect((await app.request("/api/session", { headers: { cookie: newCookie } })).status).toBe(200);
    } finally {
      database.close();
    }
  });

  it("fails the login and grants no session when marker activation fails", async () => {
    const database = await createDatabase();
    try {
      const app = runtimeApp(database, true);
      const response = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ email: "teacher@example.test", password: "password-1" }),
      });
      expect(response.status).toBe(500);
      expect(database.query("SELECT count(*) AS count FROM active_user_sessions").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
