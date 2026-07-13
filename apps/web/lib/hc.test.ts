import { describe, expect, it } from "bun:test";

import { createApiClient } from "./hc";

describe("createApiClient", () => {
  it("calls the typed health endpoint through the configured fetch", async () => {
    let capturedRequest: Request | undefined;
    const customFetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedRequest = new Request(input, init);
        return Response.json({
          status: "ok",
          service: "grade-management-api",
        });
      },
      { preconnect: () => {} },
    ) satisfies typeof fetch;
    const client = createApiClient("http://localhost", { fetch: customFetch });

    const response = await client.api.health.$get();
    const health = await response.json();

    expect(capturedRequest?.method).toBe("GET");
    expect(capturedRequest?.url).toBe("http://localhost/api/health");
    expect(health).toEqual({
      status: "ok",
      service: "grade-management-api",
    });
  });
});
