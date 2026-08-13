import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import type { AuthSession } from "../authorization";
import { unavailableGradeService } from "../grade/service";
import { unavailableAdminMasterService } from "./service";
import { unavailableAuditService } from "./audit";

const admin: AuthSession = { session: { id: "s", token: "t", expiresAt: new Date("2027-01-01") }, user: { id: "admin", role: "admin", status: "active", mustChangePassword: false } };
const body = { targetYear: 2027, teachersCsv: "", grade1SubjectsCsv: "", grade2SubjectsCsv: "", grade3SubjectsCsv: "", newStudentsCsv: "" };
const rolloverService = { preview: async () => ({ targetYear: 2027, graduationCandidates: 0, teacherCount: 0, subjectCounts: { 1: 0, 2: 0, 3: 0 }, studentCount: 0, errors: [] }), apply: async () => ({ applied: true as const, summary: { targetYear: 2027, graduationCandidates: 0, teacherCount: 0, subjectCounts: { 1: 0, 2: 0, 3: 0 }, studentCount: 0, errors: [] } }) };
const app = (session: AuthSession | null = admin, service = rolloverService) => createApp({ authHandler: () => new Response(null, { status: 500 }), readSession: async () => session, gradeService: unavailableGradeService, adminMasterService: unavailableAdminMasterService, auditService: unavailableAuditService, rolloverService: service });
describe("rollover routes", () => {
  it("requires an admin and validates an apply idempotency key", async () => { const teacher = { ...admin, user: { ...admin.user, role: "teacher" as const } }; expect((await app(teacher).request("/api/admin/rollover/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(403); const invalid = await app().request("/api/admin/rollover/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_IDEMPOTENCY_KEY" } }); });
  it("returns a typed preview without mutation", async () => { const response = await app().request("/api/admin/rollover/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ targetYear: 2027, errors: [] }); });
  it("maps unexpected rollover errors to a safe 500 response", async () => { const secret = "rollover-internal-detail"; const response = await app(admin, { ...rolloverService, preview: async () => { throw new Error(secret); } }).request("/api/admin/rollover/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); expect(response.status).toBe(500); const result = await response.json(); expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } }); expect(JSON.stringify(result)).not.toContain(secret); });
});
