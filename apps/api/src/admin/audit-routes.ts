import { Hono } from "hono";
import { validator } from "hono/validator";

import { requireAuthenticatedUser, requirePasswordChanged, requireRole, type AuthVariables, type SessionReader } from "../authorization";
import { respondAdminRouteError } from "./route-errors";
import { AdminDomainError } from "./service";
import { auditActions, type AuditEntityType, type AuditService, type IdempotencyStatus, validateAuditQuery, validateOperationQuery } from "./audit";

const fail = (c: Parameters<typeof respondAdminRouteError>[0], error: unknown) => respondAdminRouteError(c, error, "audit");
const one = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) throw new AdminDomainError("INVALID_AUDIT_QUERY", "表示条件を正しく指定してください。");
  return value;
};
const optionalInteger = (value: string | string[] | undefined) => {
  const raw = one(value); if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new AdminDomainError("INVALID_AUDIT_QUERY", "表示条件を正しく指定してください。");
  return Number(raw);
};
const pagination = (value: Record<string, string | string[] | undefined>) => ({ limit: optionalInteger(value.limit) ?? 20, cursor: one(value.cursor) });
const auditQuery = validator("query", (value, c) => { try {
  const action = one(value.action); const actorId = one(value.actorId); const targetType = one(value.targetType);
  return validateAuditQuery({ ...pagination(value), academicYear: optionalInteger(value.academicYear), action, actorId, targetType: targetType as AuditEntityType | undefined });
} catch (error) { return fail(c, error); } });
const operationQuery = validator("query", (value, c) => { try {
  const status = one(value.status);
  return validateOperationQuery({ ...pagination(value), academicYear: optionalInteger(value.academicYear), status: status as IdempotencyStatus | undefined });
} catch (error) { return fail(c, error); } });
const guarded = (reader: SessionReader) => [requireAuthenticatedUser(reader), requirePasswordChanged, requireRole("admin")] as const;

export const createAuditRoutes = (service: AuditService, reader: SessionReader) => new Hono<{ Variables: AuthVariables }>()
  .get("/admin/audit", ...guarded(reader), auditQuery, async (c) => { try { return c.json(await service.logs(c.req.valid("query")), 200); } catch (error) { return fail(c, error); } })
  .get("/admin/audit/actors", ...guarded(reader), async (c) => { try { return c.json(await service.actors(), 200); } catch (error) { return fail(c, error); } })
  .get("/admin/audit/operations", ...guarded(reader), operationQuery, async (c) => { try { return c.json(await service.operations(c.req.valid("query")), 200); } catch (error) { return fail(c, error); } });

export { auditActions };
