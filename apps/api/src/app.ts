import { Hono } from "hono";

export type AuthHandler = (request: Request) => Response | Promise<Response>;

export const createApp = (authHandler: AuthHandler) => {
  const app = new Hono().basePath("/api");

  return app
    .on(["GET", "POST"], "/auth/*", (c) => authHandler(c.req.raw))
    .get("/health", (c) =>
      c.json({
        status: "ok" as const,
        service: "grade-management-api" as const,
      }),
    );
};

export type AppType = ReturnType<typeof createApp>;
