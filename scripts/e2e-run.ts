import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupE2EArtifacts } from "./e2e-artifacts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let running: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;

const interrupt = () => {
  interrupted = true;
  running?.kill();
};

process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

async function run(command: string[]) {
  running = Bun.spawn(command, { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exitCode = await running.exited;
  running = undefined;
  return exitCode;
}

try {
  const prepared = await run([process.execPath, "scripts/e2e-prepare.ts"]);
  if (prepared !== 0) process.exitCode = prepared;
  else process.exitCode = await run([process.execPath, "x", "playwright", "test"]);
} finally {
  // Playwright owns and stops webServer before its process exits; clean only after that.
  await cleanupE2EArtifacts(root);
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}

if (interrupted) process.exitCode = 130;
