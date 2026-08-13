import { Hono } from "hono";
import { validator } from "hono/validator";

import { requireAuthenticatedUser, requirePasswordChanged, requireRole, type AuthVariables, type SessionReader } from "../authorization";
import { importKinds, type ImportInput } from "./imports";
import { type NormalImportService } from "./import-service";
import { respondAdminRouteError } from "./route-errors";
import { AdminDomainError } from "./service";

const fail = (context: Parameters<typeof respondAdminRouteError>[0], error: unknown) => respondAdminRouteError(context, error, "import");
const object = (value: unknown) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AdminDomainError("INVALID_IMPORT_REQUEST", "CSV取込の内容を確認してください。");
  return value as Record<string, unknown>;
};
const importInput = (value: unknown): ImportInput => {
  const row = object(value);
  const academicYear = row.academicYear;
  if (typeof academicYear !== "number" || !Number.isInteger(academicYear)) throw new AdminDomainError("INVALID_ACADEMIC_YEAR", "年度を正しく指定してください。");
  if (typeof row.kind !== "string" || !importKinds.includes(row.kind as typeof importKinds[number])) throw new AdminDomainError("INVALID_IMPORT_KIND", "CSVの種類を正しく指定してください。");
  if (typeof row.csv !== "string") throw new AdminDomainError("INVALID_IMPORT_REQUEST", "CSVを指定してください。");
  const gradeLevel = row.gradeLevel;
  if (row.kind === "subjects") {
    if (gradeLevel !== 1 && gradeLevel !== 2 && gradeLevel !== 3) throw new AdminDomainError("IMPORT_GRADE_LEVEL_REQUIRED", "科目CSVでは対象学年を指定してください。");
    return { academicYear, kind: "subjects", csv: row.csv, gradeLevel };
  }
  if (gradeLevel !== undefined) throw new AdminDomainError("IMPORT_GRADE_LEVEL_FORBIDDEN", "対象学年は科目CSVでのみ指定できます。");
  if (row.kind === "students" || row.kind === "teachers" || row.kind === "staff") return { academicYear, kind: row.kind, csv: row.csv };
  throw new AdminDomainError("INVALID_IMPORT_KIND", "CSVの種類を正しく指定してください。");
};
const applyInput = (value: unknown) => {
  const row = object(value);
  if (typeof row.token !== "string" || typeof row.idempotencyKey !== "string") throw new AdminDomainError("INVALID_IMPORT_REQUEST", "確認情報を正しく指定してください。");
  return { token: row.token, idempotencyKey: row.idempotencyKey };
};
const guarded = (reader: SessionReader) => [requireAuthenticatedUser(reader), requirePasswordChanged, requireRole("admin")] as const;

export const createNormalImportRoutes = (service: NormalImportService, reader: SessionReader) => new Hono<{ Variables: AuthVariables }>()
  .post("/admin/imports/preview", ...guarded(reader), validator("json", (value, context) => { try { return importInput(value); } catch (error) { return fail(context, error); } }), async (context) => { try { return context.json(await service.preview(context.get("authUser").id, context.req.valid("json")), 200); } catch (error) { return fail(context, error); } })
  .post("/admin/imports/apply", ...guarded(reader), validator("json", (value, context) => { try { return applyInput(value); } catch (error) { return fail(context, error); } }), async (context) => { try { return context.json(await service.apply(context.get("authUser").id, context.req.valid("json")), 200); } catch (error) { return fail(context, error); } });
