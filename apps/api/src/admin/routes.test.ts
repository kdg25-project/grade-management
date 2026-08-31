import { describe, expect, it } from "bun:test";

import { createApp } from "../app";
import type { AuthSession } from "../authorization";
import { unavailableGradeService } from "../grade/service";
import { unavailableAdminMasterService } from "./service";
import { unavailableAuditService } from "./audit";

const session: AuthSession = { session: { id: "s", token: "t", expiresAt: new Date("2026-01-01") }, user: { id: "admin-1", role: "admin", status: "active", mustChangePassword: false } };
const masterService = { ...unavailableAdminMasterService, years: async () => ({ years: [{ year: 2026, isCurrent: true, selectedAt: null }] }), createTeacher: async () => ({ id: "teacher-1", email: "teacher@example.test", temporaryPassword: "only-once" }), createStaff: async () => ({ id: "staff-1", email: "staff@example.test", temporaryPassword: "only-once" }), requestAccountPasswordReset: async (actorId: string, id: string) => ({ id }) };
const auditService = { ...unavailableAuditService, logs: async () => ({ limit: 20, nextCursor: null, items: [{ id: "a-1", occurredAt: 1, action: "student_created" as const, actionLabel: "学生登録", actor: "職員", targetType: "student" as const, targetLabel: "学生", summary: "学生を登録" }] }), actors: async () => ({ items: [{ id: "admin-1", name: "職員" }] }), operations: async () => ({ limit: 20, nextCursor: null, items: [] }) };
const app = (auth: AuthSession | null = session, adminMasterService = masterService, audit = auditService) => createApp({
  authHandler: () => new Response(null, { status: 500 }), readSession: async () => auth, gradeService: unavailableGradeService,
  adminMasterService,
  auditService: audit,
});

describe("admin master routes", () => {
  it("requires an administrator", async () => {
    const teacher = { ...session, user: { ...session.user, role: "teacher" as const } };
    expect((await app(teacher).request("/api/admin/years")).status).toBe(403);
  });

  it("returns typed administrative data", async () => {
    const response = await app().request("/api/admin/years");
    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toEqual({ years: [{ year: 2026, isCurrent: true, selectedAt: null }] });
  });

  it("maps unexpected master service errors to a safe 500 response", async () => {
    const secret = "master-internal-detail";
    const response = await app(session, { ...masterService, years: async () => { throw new Error(secret); } }).request("/api/admin/years");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。時間をおいてもう一度お試しください。" } });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("rejects malformed master input before service invocation", async () => {
    const response = await app().request("/api/admin/students", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ studentNumber: "1" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_STUDENT" } });
  });

  it("validates and forwards the student-list academic year", async () => {
    let received: unknown = null;
    const response = await app(session, { ...masterService, students: async (query) => { received = query; return { currentAcademicYear: 2027, academicYear: 2026, total: 0, items: [] }; } }).request("/api/admin/students?academicYear=2026&gradeLevel=1");
    expect(response.status).toBe(200);
    expect(received).toMatchObject({ academicYear: 2026, gradeLevel: 1 });
    const invalid = await app().request("/api/admin/students?academicYear=1999");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_ACADEMIC_YEAR" } });
    for (const gradeLevel of ["0", "4"]) {
      const invalidGrade = await app().request(`/api/admin/students?gradeLevel=${gradeLevel}`);
      expect(invalidGrade.status).toBe(400);
      expect(await invalidGrade.json()).toMatchObject({ error: { code: "INVALID_GRADE_LEVEL" } });
    }
  });

  it("returns the temporary password only in the successful create response", async () => {
    const response = await app().request("/api/admin/teachers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "講師", email: "teacher@example.test" }) });
    expect(response.status).toBe(201);
    expect(await response.json<unknown>()).toEqual({ id: "teacher-1", email: "teacher@example.test", temporaryPassword: "only-once" });
  });

  it("allows only administrators to create dedicated staff and returns their one-time credential", async () => {
    const teacher = { ...session, user: { ...session.user, role: "teacher" as const } };
    expect((await app(teacher).request("/api/admin/staff")).status).toBe(403);
    const response = await app().request("/api/admin/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "職員", email: "staff@example.test" }) });
    expect(response.status).toBe(201);
    expect(await response.json<unknown>()).toEqual({ id: "staff-1", email: "staff@example.test", temporaryPassword: "only-once" });
    const invalid = await app().request("/api/admin/staff/staff-1/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "invalid" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_STAFF_STATUS" } });
    const invalidList = await app().request("/api/admin/staff?status=invalid");
    expect(invalidList.status).toBe(400);
    expect(await invalidList.json()).toMatchObject({ error: { code: "INVALID_STAFF_STATUS", message: "専任職員の状態を正しく指定してください。" } });
  });

  it("allows only administrators to request a reset by opaque account ID without returning email data", async () => {
    const teacher = { ...session, user: { ...session.user, role: "teacher" as const } };
    expect((await app(teacher).request("/api/admin/accounts/teacher-1/password-reset", { method: "POST" })).status).toBe(403);
    const response = await app().request("/api/admin/accounts/teacher-1/password-reset", { method: "POST" });
    expect(response.status).toBe(202);
    const body: unknown = await response.json();
    expect(body).toEqual({ id: "teacher-1" });
  });

  it("protects audit history and rejects invalid unbounded filter input", async () => {
    const teacher = { ...session, user: { ...session.user, role: "teacher" as const } };
    expect((await app(teacher).request("/api/admin/audit")).status).toBe(403);
    const invalid = await app().request("/api/admin/audit?limit=101");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_AUDIT_QUERY" } });
    const response = await app().request("/api/admin/audit");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ limit: 20, nextCursor: null, items: [{ summary: "学生を登録" }] });
  });

  it("maps unexpected audit service errors to a safe 500 response", async () => {
    const secret = "audit-internal-detail";
    const response = await app(session, masterService, { ...auditService, logs: async () => { throw new Error(secret); } }).request("/api/admin/audit");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
