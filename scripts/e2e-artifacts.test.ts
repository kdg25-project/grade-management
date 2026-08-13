import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { assertE2EArtifactPath, cleanupE2EArtifacts, e2eArtifactPaths } from "./e2e-artifacts";

const root = "/tmp/grade-management-e2e-artifacts-test";

describe("E2E artifact cleanup", () => {
  it("removes only its complete, exact allowlist", async () => {
    const removed: string[] = [];
    await cleanupE2EArtifacts(root, async (path) => { removed.push(path); });
    expect(removed).toEqual(e2eArtifactPaths(root));
  });

  it("rejects paths outside the E2E artifact allowlist before deletion", () => {
    expect(() => assertE2EArtifactPath(root, join(root, ".env"))).toThrow("allowlist");
    expect(() => assertE2EArtifactPath(root, join(root, "apps/web/.wrangler/state"))).toThrow("allowlist");
    expect(() => assertE2EArtifactPath(root, join(root, "apps/web/.wrangler/e2e-state"))).not.toThrow();
  });
});
