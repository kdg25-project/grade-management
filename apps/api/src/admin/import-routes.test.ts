import { describe, expect, it } from "bun:test";

import { createApp } from "../app";
import type { AuthSession } from "../authorization";
import { unavailableGradeService } from "../grade/service";
import { unavailableAuditService } from "./audit";
import type { NormalImportService } from "./import-service";
import { unavailableAdminMasterService } from "./service";

const admin: AuthSession = { session: { id: "s", token: "t", expiresAt: new Date("2027-01-01") }, user: { id: "admin", role: "admin", status: "active", mustChangePassword: false } };
const body = { academicYear: 2027, kind: "students", csv: "" };
const service: NormalImportService = { preview: async () => ({ token: "import-token-0123456789", academicYear: 2027, expiresAt: 99, counts: { students: 0, teachers: 0, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, errors: [] }), apply: async () => ({ applied: true, replayed: false, credentialsAlreadyIssued: false, summary: { students: 0, teachers: 0, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, credentials: [] }) };
const app = (session: AuthSession | null = admin, normalImportService: NormalImportService = service) => createApp({ authHandler: () => new Response(null, { status: 500 }), readSession: async () => session, gradeService: unavailableGradeService, adminMasterService: unavailableAdminMasterService, auditService: unavailableAuditService, normalImportService });

describe("normal import routes", () => {
  it("requires admin authorization and validates an individual kind request", async () => {
    const teacher = { ...admin, user: { ...admin.user, role: "teacher" as const } };
    expect((await app(teacher).request("/api/admin/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(403);
    const malformed = await app().request("/api/admin/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academicYear: 2027 }) }); expect(malformed.status).toBe(400); expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_IMPORT_KIND" } });
    const subjectWithoutGrade = await app().request("/api/admin/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ academicYear: 2027, kind: "subjects", csv: "" }) }); expect(subjectWithoutGrade.status).toBe(400); expect(await subjectWithoutGrade.json()).toMatchObject({ error: { code: "IMPORT_GRADE_LEVEL_REQUIRED" } });
  });
  it("returns typed preview and apply data without putting credentials in requests", async () => {
    const preview = await app().request("/api/admin/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ token: "import-token-0123456789", academicYear: 2027 });
    const apply = await app().request("/api/admin/imports/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "import-token-0123456789", idempotencyKey: "import-route-1" }) }); expect(apply.status).toBe(200); expect(await apply.json()).toMatchObject({ applied: true, credentials: [] });
  });
  it("maps unexpected import errors to a safe 500 response", async () => {
    const secret = "import-internal-detail";
    const response = await app(admin, { ...service, preview: async () => { throw new Error(secret); } }).request("/api/admin/imports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(500); const result = await response.json(); expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } }); expect(JSON.stringify(result)).not.toContain(secret);
  });
});
