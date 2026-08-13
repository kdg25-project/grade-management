import { describe, expect, it } from "bun:test";

import { createPasswordResetDeliveryChannel } from "./auth";

describe("admin password-reset delivery channel", () => {
  it("waits for the configured Better Auth sendResetPassword callback before resolving", async () => {
    const delivered: string[] = [];
    const channel = createPasswordResetDeliveryChannel(async ({ to }) => { delivered.push(to); });
    await channel.requestAndWait("teacher@example.test", async () => {
      await channel.sendResetPassword({ user: { email: "teacher@example.test" }, url: "https://example.test/token" });
    });
    expect(delivered).toEqual(["teacher@example.test"]);
  });

  it("rejects an admin request when the configured sender fails even if the auth endpoint itself resolves", async () => {
    const channel = createPasswordResetDeliveryChannel(async () => { throw new Error("provider unavailable"); });
    await expect(channel.requestAndWait("teacher@example.test", async () => {
      try { await channel.sendResetPassword({ user: { email: "teacher@example.test" }, url: "https://example.test/token" }); } catch { /* Better Auth swallows callback errors. */ }
    })).rejects.toThrow("provider unavailable");
  });

  it("times out a permanently pending sender even while Better Auth is still awaiting its callback", async () => {
    const channel = createPasswordResetDeliveryChannel(async () => new Promise<void>(() => undefined), undefined, 5);
    const startedAt = Date.now();
    await expect(channel.requestAndWait("teacher@example.test", async () => {
      await channel.sendResetPassword({ user: { email: "teacher@example.test" }, url: "https://example.test/token" });
    })).rejects.toThrow("timed out");
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("keeps public reset sends enumeration-safe when a Worker execution context is present", async () => {
    const background: Promise<unknown>[] = [];
    const executionCtx = { waitUntil: (promise: Promise<unknown>) => { background.push(promise); } } as ExecutionContext;
    const channel = createPasswordResetDeliveryChannel(async () => { throw new Error("provider unavailable"); }, executionCtx);
    await expect(channel.sendResetPassword({ user: { email: "public@example.test" }, url: "https://example.test/token" })).resolves.toBeUndefined();
    await Promise.all(background);
  });
});
