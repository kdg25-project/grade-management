import { describe, expect, it } from "bun:test";
import { createApp } from "../app";
import type { AuthSession } from "../authorization";
import { unavailableGradeService } from "../grade/service";
import { unavailableAdminMasterService } from "./service";
import { unavailableAuditService } from "./audit";

const admin: AuthSession = { session: { id: "s", token: "t", expiresAt: new Date("2027-01-01") }, user: { id: "admin", role: "admin", status: "active", mustChangePassword: false } };
const gradeExportService = { preview: async () => ({ token: "snapshot-token-0123456789", rowCount: 1, academicYear: 2027, years: [2027], scope: "year_all_students" as const }), download: async () => ({ csv: "\uFEFFa\r\n", filename: "成績一覧_2027年度.csv", rowCount: 1 }) };
const app = (session: AuthSession | null = admin, service = gradeExportService) => createApp({ authHandler: () => new Response(null, { status: 500 }), readSession: async () => session, gradeService: unavailableGradeService, adminMasterService: unavailableAdminMasterService, auditService: unavailableAuditService, gradeExportService: service });
describe("grade export routes", () => {
  it("requires an admin and validates preview filters", async () => { const teacher = { ...admin, user: { ...admin.user, role: "teacher" as const } }; expect((await app(teacher).request("/api/admin/grade-export/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "year_all_students" }) })).status).toBe(403); expect((await app().request("/api/admin/grade-export/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "invalid" }) })).status).toBe(400); });
  it("returns download headers only after a tokenized preview", async () => { const preview = await app().request("/api/admin/grade-export/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "year_all_students" }) }); expect(preview.status).toBe(200); const response = await app().request("/api/admin/grade-export/download?token=snapshot-token-0123456789"); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/csv"); expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''"); expect(response.headers.get("cache-control")).toBe("no-store"); expect((await response.text()).startsWith("\uFEFF")).toBeTrue(); });
  it("maps an unexpected download error to a safe 500 response", async () => { const secret = "export-internal-detail"; const response = await app(admin, { ...gradeExportService, download: async () => { throw new Error(secret); } }).request("/api/admin/grade-export/download?token=snapshot-token-0123456789"); expect(response.status).toBe(500); const result = await response.json(); expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } }); expect(JSON.stringify(result)).not.toContain(secret); });
});
