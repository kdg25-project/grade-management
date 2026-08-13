import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const relativeArtifactPaths = [
  "apps/web/.wrangler/e2e-state",
  ".dev.vars.e2e",
  "e2e/.credentials.json",
  "test-results",
  "playwright-report",
] as const;

export type E2EArtifactRemover = (path: string, options: { recursive: true; force: true }) => Promise<void>;

export function e2eArtifactPaths(projectRoot: string) {
  const root = resolve(projectRoot);
  return relativeArtifactPaths.map((relativePath) => resolve(root, relativePath));
}

export function assertE2EArtifactPath(projectRoot: string, candidate: string) {
  const normalized = resolve(candidate);
  if (!e2eArtifactPaths(projectRoot).includes(normalized)) {
    throw new Error(`Refusing to remove a path outside the E2E artifact allowlist: ${normalized}`);
  }
  return normalized;
}

export async function cleanupE2EArtifacts(projectRoot: string, remove: E2EArtifactRemover = rm) {
  for (const path of e2eArtifactPaths(projectRoot)) {
    await remove(assertE2EArtifactPath(projectRoot, path), { recursive: true, force: true });
  }
}

export const e2eArtifactPath = (projectRoot: string, relativePath: (typeof relativeArtifactPaths)[number]) =>
  join(resolve(projectRoot), relativePath);
