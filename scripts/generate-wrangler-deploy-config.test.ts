import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import {
  createWranglerDeployRedirect,
  generatedWranglerConfigPath,
  getWranglerDeployRedirectPath,
  writeWranglerDeployRedirect,
} from "./generate-wrangler-deploy-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Wrangler deploy redirect", () => {
  it("creates the generated config protocol payload", () => {
    expect(createWranglerDeployRedirect()).toEqual({
      configPath: generatedWranglerConfigPath,
      auxiliaryWorkers: [],
    });
  });

  it("writes the redirect below an injected root directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "grade-management-wrangler-"));
    temporaryDirectories.push(rootDir);

    const redirectPath = await writeWranglerDeployRedirect(rootDir);

    expect(redirectPath).toBe(getWranglerDeployRedirectPath(rootDir));
    await expect(readFile(redirectPath, "utf8")).resolves.toBe(
      `${JSON.stringify(createWranglerDeployRedirect(), null, 2)}\n`,
    );
  });
});
