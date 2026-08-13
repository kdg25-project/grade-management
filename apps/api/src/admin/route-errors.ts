import type { Context } from "hono";

import { AdminDomainError } from "./service";

const internalError = new AdminDomainError("INTERNAL_ERROR", "処理に失敗しました。時間をおいてもう一度お試しください。", 500);

/** Keeps expected domain failures public while never exposing unexpected errors. */
export const respondAdminRouteError = (context: Context, error: unknown, route: string) => {
  if (!(error instanceof AdminDomainError)) {
    console.error(JSON.stringify({ event: "admin_route_unexpected_error", route, errorType: error instanceof Error ? error.name : typeof error }));
  }
  const domain = error instanceof AdminDomainError ? error : internalError;
  return context.json({ error: { code: domain.code, message: domain.message } }, domain.status);
};
