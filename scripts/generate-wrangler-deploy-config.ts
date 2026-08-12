import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const generatedWranglerConfigPath =
  "../../dist/client/grade_management/wrangler.json";

export function createWranglerDeployRedirect() {
  return {
    configPath: generatedWranglerConfigPath,
    auxiliaryWorkers: [],
  };
}

export function getWranglerDeployRedirectPath(rootDir: string) {
  return join(rootDir, ".wrangler", "deploy", "config.json");
}

export async function writeWranglerDeployRedirect(rootDir = process.cwd()) {
  const redirectPath = getWranglerDeployRedirectPath(rootDir);
  await mkdir(dirname(redirectPath), { recursive: true });
  await writeFile(
    redirectPath,
    `${JSON.stringify(createWranglerDeployRedirect(), null, 2)}\n`,
    "utf8",
  );
  return redirectPath;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await writeWranglerDeployRedirect();
}
