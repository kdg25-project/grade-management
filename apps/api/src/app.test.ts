import { describe, expect, it } from "bun:test";

import { createApp } from "./app";

describe("API application", () => {
  it("returns the service status", async () => {
    const app = createApp(() => new Response(null, { status: 500 }));
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "grade-management-api",
    });
  });

  for (const method of ["GET", "POST"] as const) {
    it(`forwards ${method} auth requests to Better Auth`, async () => {
      let forwardedRequest: Request | undefined;
      const app = createApp((request) => {
        forwardedRequest = request;
        return Response.json({ handled: true });
      });

      const response = await app.request("/api/auth/session", { method });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ handled: true });
      expect(forwardedRequest?.method).toBe(method);
      expect(forwardedRequest && new URL(forwardedRequest.url).pathname).toBe(
        "/api/auth/session",
      );
    });
  }
});
