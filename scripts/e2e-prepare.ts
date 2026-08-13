import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";

import { e2eArtifactPath } from "./e2e-artifacts";
import { buildSeedSql, createSeedPlan } from "./seed-dev";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = "grade-management";
const config = join(root, "wrangler.jsonc");
// Do not broaden this target: preparation may only delete the dedicated E2E state.
const e2eState = e2eArtifactPath(root, "apps/web/.wrangler/e2e-state");
const e2eDevVars = e2eArtifactPath(root, ".dev.vars.e2e");
const credentialsFile = e2eArtifactPath(root, "e2e/.credentials.json");
const rolloverGraduateFixtureSql = `
INSERT INTO academic_years (year,is_current,created_at,updated_at) VALUES (2024,0,unixepoch(),unixepoch()) ON CONFLICT(year) DO NOTHING;
INSERT INTO students (id,student_number,name,name_kana,birth_date,gender,email,course_id,enrollment_year,status,status_changed_at,created_at,updated_at) VALUES ('e2e-rollover-graduate','E2E-ROLLOVER-GRADUATE-2024-001','E2E 年度更新卒業候補','イーツーイーネンドコウシンソツギョウコウホ','2006-04-01','女','e2e-rollover-graduate@example.test','system-engineer',2024,'enrolled',unixepoch(),unixepoch(),unixepoch()) ON CONFLICT(id) DO NOTHING;
INSERT INTO student_status_history (id,student_id,status,effective_academic_year,changed_at,reason) SELECT 'e2e-rollover-graduate-enrolled','e2e-rollover-graduate','enrolled',2024,unixepoch(),'E2E年度更新fixture' WHERE NOT EXISTS (SELECT 1 FROM student_status_history WHERE id='e2e-rollover-graduate-enrolled');
`;

type Credentials = {
  admin: { email: string; password: string; changedPassword: string };
  teacher: { email: string; password: string; changedPassword: string };
};

async function run(command: string[]) {
  const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const detail = [stderr, stdout].filter(Boolean).join("\n").replace(/\s+/gu, " ").slice(0, 1_000);
    throw new Error(`E2E local D1 preparation failed: ${detail || "Wrangler exited unsuccessfully."}`);
  }
}

async function seed() {
  const plan = await createSeedPlan([], {
    password: () => randomBytes(24).toString("base64url"),
    hash: hashPassword,
  });
  const credentials = Object.fromEntries(plan.credentials.map((item) => [item.email, item.temporaryPassword]));
  const admin = credentials["dev-admin@example.test"];
  const teacher = credentials["dev-teacher@example.test"];
  if (!admin || !teacher) throw new Error("E2E fixture credentials could not be generated.");

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "grade-management-e2e-"));
  const sqlFile = join(temporaryDirectory, "fixture.sql");
  try {
    await writeFile(sqlFile, `${buildSeedSql(plan)}\n${rolloverGraduateFixtureSql}`, { encoding: "utf8", mode: 0o600 });
    await chmod(sqlFile, 0o600);
    await run([
      process.execPath, "x", "wrangler", "d1", "execute", database,
      "--file", sqlFile, "--local", "--persist-to", e2eState, "--config", config, "--json",
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const payload: Credentials = {
    admin: { email: "dev-admin@example.test", password: admin, changedPassword: randomBytes(24).toString("base64url") },
    teacher: { email: "dev-teacher@example.test", password: teacher, changedPassword: randomBytes(24).toString("base64url") },
  };
  await mkdir(dirname(credentialsFile), { recursive: true });
  await writeFile(credentialsFile, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(credentialsFile, 0o600);
}

async function prepare() {
  await rm(e2eState, { recursive: true, force: true });
  await mkdir(dirname(e2eState), { recursive: true });
  const secret = randomBytes(48).toString("base64url");
  await writeFile(
    e2eDevVars,
    `BETTER_AUTH_SECRET=${secret}\nBETTER_AUTH_URL=http://127.0.0.1:4173\nBETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:4173\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(e2eDevVars, 0o600);
  await run([
    process.execPath, "x", "wrangler", "d1", "migrations", "apply", database,
    "--local", "--persist-to", e2eState, "--config", config,
  ]);
  await seed();
}

await prepare();
