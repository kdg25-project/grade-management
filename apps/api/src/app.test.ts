import { describe, expect, it } from "bun:test";

import { app } from "./app";

describe("GET /api/health", () => {
  it("returns the service status", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "grade-management-api",
    });
  });
});
