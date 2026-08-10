import { Hono } from "hono";

import { createAuth, type AuthEnvironment } from "./auth";

export type AuthHandler = (request: Request) => Response | Promise<Response>;

export const createApp = (authHandler: AuthHandler) =>
  new Hono()
    .basePath("/api")
    .on(["GET", "POST"], "/auth/*", (c) => authHandler(c.req.raw))
    .get("/health", (c) => c.json({ status: "ok" as const, service: "grade-management-api" as const }));

export const createWorkerApp = (env: AuthEnvironment, executionCtx: ExecutionContext) =>
  createApp((request) => createAuth(env, executionCtx).handler(request));

export type AppType = ReturnType<typeof createApp>;
