import { describe, expect, it } from "bun:test";
import { hc } from "hono/client";

import { createApp, normalizeGetSessionResponse, readCurrentAuthSession, type AppDependencies } from "./app";
import { isCurrentUserSession, type AuthSession } from "./authorization";
import { APIError } from "better-auth/api";
import { unavailableGradeService } from "./grade/service";

/** Compile-only Hono RPC contract. The function is deliberately never invoked. */
const assertRpcContract = (rpcClient: ReturnType<typeof hc<import("./app").AppType>>) => {
  if (false) {
    void rpcClient.api.teacher.subjects.$get;
    void rpcClient.api.teacher.subjects[":id"].grades.$get({
      param: { id: "subject-1" }, query: { term: "1", year: "2026" },
    });
    void rpcClient.api.teacher.subjects[":id"].grades.$put({
      param: { id: "subject-1" }, query: { term: "1" },
      json: { grades: [{ studentId: "student-1", attendanceRate: 80, attitude: 8, assignment: 9 }] },
    });
    void rpcClient.api.admin.subjects[":id"].terms[":term"].reopen.$post({
      param: { id: "subject-1", term: "1" }, json: { reason: "訂正のため" },
    });
    void rpcClient.api.admin.years.current.$post({ json: { year: 2026 } });
    void rpcClient.api.admin.students.$post({
      json: { studentNumber: "100", name: "学生", nameKana: "ガクセイ", birthDate: "2008-01-01", gender: "未回答", courseId: "course-1", enrollmentYear: 2026 },
    });
    void rpcClient.api.admin.teachers.$post({ json: { name: "講師", email: "teacher@example.test" } });
    void rpcClient.api.admin.master.subjects.$post({ json: { name: "科目", gradeLevel: 1, teacherUserId: "teacher-1", courseIds: ["course-1"] } });
  }
};
void assertRpcContract;

const session = (overrides: Partial<AuthSession["user"]> = {}): AuthSession => ({
  session: { id: "session-1", token: "token-1", expiresAt: new Date("2026-08-12T00:00:00.000Z") },
  user: { id: "user-1", role: "teacher", status: "active", mustChangePassword: false, ...overrides },
});

const dependencies = (readSession: AppDependencies["readSession"] = async () => null): AppDependencies => ({
  authHandler: () => new Response(null, { status: 500 }),
  readSession,
  gradeService: unavailableGradeService,
});

describe("API application", () => {
  it("returns the service status", async () => {
    const app = createApp(dependencies());
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ok","service":"grade-management-api"}');
  });

  for (const method of ["GET", "POST"] as const) {
    it(`forwards ${method} auth requests to Better Auth`, async () => {
      let forwardedRequest: Request | undefined;
      const app = createApp({ ...dependencies(), authHandler: (request) => {
        forwardedRequest = request;
        return Response.json({ handled: true });
      } });

      const response = await app.request("/api/auth/session", { method });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"handled":true}');
      expect(forwardedRequest?.method).toBe(method);
      expect(forwardedRequest && new URL(forwardedRequest.url).pathname).toBe(
        "/api/auth/session",
      );
    });
  }

  it("does not expose the public password-reset request endpoint to Better Auth", async () => {
    let calls = 0;
    const app = createApp({ ...dependencies(), authHandler: () => {
      calls += 1;
      return Response.json({ handled: true });
    } });

    const response = await app.request("/api/auth/request-password-reset", { method: "POST" });

    expect(response.status).toBe(404);
    expect(calls).toBe(0);
  });

  for (const method of ["GET", "POST"] as const) {
    it(`keeps ${method} password-reset completion requests with Better Auth`, async () => {
      let calls = 0;
      const app = createApp({ ...dependencies(), authHandler: () => {
        calls += 1;
        return Response.json({ handled: true });
      } });

      const response = await app.request("/api/auth/reset-password", { method });

      expect(response.status).toBe(200);
      expect(calls).toBe(1);
    });
  }

  it("returns the authoritative user flags from a valid session", async () => {
    const app = createApp(dependencies(async () => session({ role: "admin", mustChangePassword: true })));
    const response = await app.request("/api/session");

    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toEqual({
      user: { id: "user-1", role: "admin", status: "active", mustChangePassword: true },
      session: { expiresAt: "2026-08-12T00:00:00.000Z" },
    });
  });

  it("rejects missing sessions", async () => {
    const response = await createApp(dependencies()).request("/api/session");
    expect(response.status).toBe(401);
    expect(await response.json<unknown>()).toEqual({ error: { code: "UNAUTHENTICATED" } });
  });

  it("fails closed for a superseded, missing, or unreadable active-session marker", async () => {
    const active = { activate: async () => {}, permits: async ({ token }: { userId: string; token: string }) => token === "token-current" };
    expect(await isCurrentUserSession(session(), active)).toBe(false);
    expect(await isCurrentUserSession({ ...session(), session: { ...session().session, token: "token-current" } }, active)).toBe(true);
    expect(await isCurrentUserSession(session(), { ...active, permits: async () => { throw new Error("D1 unavailable"); } })).toBe(false);
  });

  it("turns a Better Auth supersession error into a business-route 401 session result", async () => {
    const active = { activate: async () => {}, permits: async () => true };
    const superseded = APIError.from("UNAUTHORIZED", { code: "SESSION_SUPERSEDED", message: "Session is no longer active" });
    expect(await readCurrentAuthSession(async () => { throw superseded; }, new Headers(), active)).toBeNull();
    await expect(readCurrentAuthSession(async () => { throw new Error("database unavailable"); }, new Headers(), active)).rejects.toThrow("database unavailable");
  });

  it("normalizes only unauthorized Better Auth get-session responses to the client null contract", async () => {
    const request = new Request("https://grade.example.test/api/auth/get-session");
    const response = normalizeGetSessionResponse(request, new Response("unauthorized", {
      status: 401,
      headers: { "set-cookie": "session=; Max-Age=0", "x-auth": "preserved" },
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("null");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("x-auth")).toBe("preserved");
    expect(normalizeGetSessionResponse(new Request("https://grade.example.test/api/auth/change-password"), new Response("unauthorized", { status: 401 })).status).toBe(401);
  });

  it("rejects inactive accounts before role checks", async () => {
    const response = await createApp(dependencies(async () => session({ status: "leave" }))).request("/api/teacher/session");
    expect(response.status).toBe(403);
    expect(await response.json<unknown>()).toEqual({ error: { code: "ACCOUNT_INACTIVE" } });
  });

  it("requires the bootstrap password to be changed for business routes", async () => {
    const response = await createApp(dependencies(async () => session({ mustChangePassword: true }))).request("/api/teacher/session");
    expect(response.status).toBe(403);
    expect(await response.json<unknown>()).toEqual({ error: { code: "MUST_CHANGE_PASSWORD" } });
  });

  it("enforces roles after the account is active and password is changed", async () => {
    const app = createApp(dependencies(async () => session({ role: "teacher" })));
    const response = await app.request("/api/admin/session");
    expect(response.status).toBe(403);
    expect(await response.json<unknown>()).toEqual({ error: { code: "FORBIDDEN" } });
  });
});
