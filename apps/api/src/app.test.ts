import { describe, expect, it } from "bun:test";
import { hc } from "hono/client";

import { createApp, type AppDependencies } from "./app";
import type { AuthSession } from "./authorization";
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
