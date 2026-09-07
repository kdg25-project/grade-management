import { describe, expect, test } from "bun:test";

import { currentToast, toastDurationMs } from "./toast-model";

describe("toast lifecycle", () => {
  test("keeps a replacement notification when an earlier timer fires", () => {
    expect(currentToast({ id: 2, kind: "success", message: "新しい通知" }, 1)).toBe(false);
    expect(currentToast({ id: 2, kind: "success", message: "新しい通知" }, 2)).toBe(true);
  });

  test("uses the five-second success notification duration", () => {
    expect(toastDurationMs).toBe(5_000);
  });
});
