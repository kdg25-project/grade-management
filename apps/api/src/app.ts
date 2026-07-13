import { Hono } from "hono";

const app = new Hono().basePath("/api");

const routes = app.get("/health", (c) =>
  c.json({
    status: "ok" as const,
    service: "grade-management-api" as const,
  }),
);

export type AppType = typeof routes;
export { app };
