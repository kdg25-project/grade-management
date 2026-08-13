import { describe, expect, it } from "bun:test";

import { isCurrentRequest } from "./request-generation";

describe("request generation", () => {
  it("ignores responses from a request superseded by a later one", () => {
    expect(isCurrentRequest(1, 2)).toBeFalse();
    expect(isCurrentRequest(2, 2)).toBeTrue();
  });
});
