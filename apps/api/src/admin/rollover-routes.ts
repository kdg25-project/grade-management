import { Hono } from "hono";
import { validator } from "hono/validator";

import { requireAuthenticatedUser, requirePasswordChanged, requireRole, type AuthVariables, type SessionReader } from "../authorization";
import { respondAdminRouteError } from "./route-errors";
import { AdminDomainError } from "./service";
import { type RolloverInput, type D1RolloverService } from "./rollover";

const fail = (c: Parameters<typeof respondAdminRouteError>[0], error: unknown) => respondAdminRouteError(c, error, "rollover");
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown, code: string) => { if (typeof value !== "string") throw new AdminDomainError(code, "年度更新の入力内容を確認してください。"); return value; };
const input = (value: unknown, requireKey: boolean): RolloverInput => {
  const body = record(value); if (!body || typeof body.targetYear !== "number" || !Number.isInteger(body.targetYear)) throw new AdminDomainError("INVALID_ROLLOVER", "年度更新の入力内容を確認してください。");
  const key = body.idempotencyKey === undefined ? undefined : string(body.idempotencyKey, "INVALID_IDEMPOTENCY_KEY"); if (requireKey && !key) throw new AdminDomainError("INVALID_IDEMPOTENCY_KEY", "再実行キーを正しく指定してください。");
  return { targetYear: body.targetYear, idempotencyKey: key, teachersCsv: string(body.teachersCsv, "INVALID_ROLLOVER"), grade1SubjectsCsv: string(body.grade1SubjectsCsv, "INVALID_ROLLOVER"), grade2SubjectsCsv: string(body.grade2SubjectsCsv, "INVALID_ROLLOVER"), grade3SubjectsCsv: string(body.grade3SubjectsCsv, "INVALID_ROLLOVER"), newStudentsCsv: string(body.newStudentsCsv, "INVALID_ROLLOVER") };
};
const guarded = (reader: SessionReader) => [requireAuthenticatedUser(reader), requirePasswordChanged, requireRole("admin")] as const;
export const createRolloverRoutes = (service: Pick<D1RolloverService, "preview" | "apply">, reader: SessionReader) => new Hono<{ Variables: AuthVariables }>()
  .post("/admin/rollover/preview", ...guarded(reader), validator("json", (value, c) => { try { return input(value, false); } catch (error) { return fail(c, error); } }), async (c) => { try { return c.json(await service.preview(c.req.valid("json")), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/rollover/apply", ...guarded(reader), validator("json", (value, c) => { try { return input(value, true); } catch (error) { return fail(c, error); } }), async (c) => { try { return c.json(await service.apply(c.get("authUser").id, c.req.valid("json")), 200); } catch (error) { return fail(c, error); } })
  .onError((error, c) => error instanceof SyntaxError || error.message === "Malformed JSON in request body" ? c.json({ error: { code: "INVALID_JSON", message: "JSONの形式が正しくありません。" } }, 400) : fail(c, error));
