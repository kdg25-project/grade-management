import { describe, expect, it } from "bun:test";

import { createWorkerId } from "./worker-crypto";

describe("Worker Crypto helpers", () => {
  it("invokes randomUUID with its Web Crypto receiver", () => {
    let receiver: unknown = null;
    const webCrypto = { randomUUID() { receiver = this; return "worker-id"; } };

    expect(createWorkerId(webCrypto)).toBe("worker-id");
    expect(receiver).toBe(webCrypto);
  });
});
