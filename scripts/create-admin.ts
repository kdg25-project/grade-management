import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";

const databaseName = "grade-management";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(projectRoot, "wrangler.jsonc");
// The Vite Cloudflare plugin resolves its local Miniflare state from apps/web.
// Keep local administration commands on that exact state so an account created
// here can immediately sign in to `bun run dev`.
const viteLocalStatePath = join(projectRoot, "apps", "web", ".wrangler", "state");

export type Target = "local" | "remote";

export type ParsedArguments =
  | { kind: "help" }
  | {
      kind: "create";
      name: string;
      email: string;
      target: Target;
      yes: boolean;
    };

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string[], cwd: string) => Promise<CommandResult>;

export type CreateAdminDependencies = {
  runCommand?: CommandRunner;
  hash?: (password: string) => Promise<string>;
  generateId?: () => string;
  generatePassword?: () => string;
  temporaryRoot?: string;
};

export type CreatedAdmin = {
  id: string;
  email: string;
  temporaryPassword: string;
  target: Target;
};

type AdminPayload = {
  id: string;
  accountId: string;
  name: string;
  email: string;
  passwordHash: string;
};

export class CliError extends Error {}

export const helpText = `専任職員アカウントを作成します。

使い方:
  bun run admin:create -- --name "氏名" --email staff@example.com [--remote] [--yes]

オプション:
  --name <氏名>       専任職員の表示名（必須）
  --email <メール>    ログイン用メールアドレス（必須）
  --remote            リモートD1へ作成（既定はlocal D1）
  --yes               リモートD1への対話確認を省略（--remoteと併用）
  --help, -h          このヘルプを表示

パスワードは安全のため引数では受け取りません。作成に成功した場合のみ、
強い一時パスワードを一度だけ表示します。`;

export function parseArguments(args: string[]): ParsedArguments {
  if (args.includes("--help") || args.includes("-h")) {
    if (args.length === 1) return { kind: "help" };
    throw new CliError("--help は他のオプションと併用できません。");
  }

  let name: string | undefined;
  let email: string | undefined;
  let target: Target = "local";
  let yes = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--name" || arg === "--email") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CliError(`${arg} には値が必要です。`);
      }
      if (arg === "--name") {
        if (name !== undefined) throw new CliError("--name は一度だけ指定してください。");
        name = value;
      } else {
        if (email !== undefined) throw new CliError("--email は一度だけ指定してください。");
        email = value;
      }
      index += 1;
      continue;
    }
    if (arg === "--remote") {
      if (target === "remote") throw new CliError("--remote は一度だけ指定してください。");
      target = "remote";
      continue;
    }
    if (arg === "--yes") {
      if (yes) throw new CliError("--yes は一度だけ指定してください。");
      yes = true;
      continue;
    }
    if (arg === "--password" || arg.startsWith("--password=")) {
      throw new CliError("パスワードはコマンドライン引数で指定できません。");
    }
    throw new CliError(`不明なオプションです: ${arg}`);
  }

  if (!name) throw new CliError("--name は必須です。");
  if (!email) throw new CliError("--email は必須です。");
  if (yes && target !== "remote") {
    throw new CliError("--yes は --remote と併用してください。");
  }

  return {
    kind: "create",
    name: validateName(name),
    email: validateEmail(email),
    target,
    yes,
  };
}

export function validateName(value: string) {
  const name = value.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new CliError("氏名は1〜100文字の通常の文字で指定してください。");
  }
  return name;
}

export function validateEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    /[\u0000-\u001f\u007f]/u.test(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new CliError("有効なメールアドレスを指定してください。");
  }
  return email;
}

/** Quotes a string literal for SQLite. Values are validated before reaching this function. */
export function quoteSql(value: string) {
  if (/\u0000/u.test(value)) throw new CliError("SQLに使用できない文字が含まれています。");
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCreateAdminSql(payload: AdminPayload) {
  return `INSERT INTO "user" ("id", "name", "email", "role", "status", "must_change_password")
VALUES (${quoteSql(payload.id)}, ${quoteSql(payload.name)}, ${quoteSql(payload.email)}, 'admin', 'active', 1);
INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password")
VALUES (${quoteSql(payload.accountId)}, ${quoteSql(payload.id)}, 'credential', ${quoteSql(payload.id)}, ${quoteSql(payload.passwordHash)});
`;
}

export function buildVerificationSql(id: string, accountId: string) {
  return `SELECT u.id, u.name, u.email, u.role, u.status, u.must_change_password,
  a.id AS account_id, a.account_id AS provider_account_id, a.provider_id, a.user_id, a.password
FROM "user" AS u
LEFT JOIN "account" AS a ON a.user_id = u.id AND a.id = ${quoteSql(accountId)}
WHERE u.id = ${quoteSql(id)};
`;
}

function buildExistingUserIdSql(id: string) {
  return `SELECT "id" FROM "user" WHERE "id" = ${quoteSql(id)} LIMIT 1;\n`;
}

function buildExistingAccountIdSql(id: string) {
  return `SELECT "id" FROM "account" WHERE "id" = ${quoteSql(id)} LIMIT 1;\n`;
}

export function buildCompensationSql(payload: AdminPayload) {
  return `DELETE FROM "account"
WHERE "id" = ${quoteSql(payload.accountId)}
  AND "account_id" = ${quoteSql(payload.id)}
  AND "provider_id" = 'credential'
  AND "user_id" = ${quoteSql(payload.id)};
DELETE FROM "user"
WHERE "id" = ${quoteSql(payload.id)}
  AND "name" = ${quoteSql(payload.name)}
  AND "email" = ${quoteSql(payload.email)}
  AND "role" = 'admin'
  AND "status" = 'active'
  AND "must_change_password" = 1;
`;
}

export function buildWranglerWriteCommand(sqlFile: string, target: Target) {
  return [
    process.execPath,
    "x",
    "wrangler",
    "d1",
    "execute",
    databaseName,
    "--file",
    sqlFile,
    target === "remote" ? "--remote" : "--local",
    ...(target === "local" ? ["--persist-to", viteLocalStatePath] : []),
    "--config",
    configPath,
    "--json",
  ];
}

export function buildWranglerReadCommand(sql: string, target: Target) {
  return [
    process.execPath,
    "x",
    "wrangler",
    "d1",
    "execute",
    databaseName,
    "--command",
    sql,
    target === "remote" ? "--remote" : "--local",
    ...(target === "local" ? ["--persist-to", viteLocalStatePath] : []),
    "--config",
    configPath,
    "--json",
  ];
}

async function defaultRunCommand(command: string[], cwd: string): Promise<CommandResult> {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const isDatabaseBusy = (result: CommandResult) => /SQLITE_BUSY|database is locked/iu.test(`${result.stderr}\n${result.stdout}`);
const waitForRetry = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

async function runD1Command(
  command: string[],
  target: Target,
  runCommand: CommandRunner,
) {
  let result = await runCommand(command, projectRoot);
  // Miniflare briefly retains SQLite recovery locks after another local Wrangler
  // command exits. Retrying the unchanged command is safe: a busy process has
  // not executed it, and remote writes deliberately never retry here.
  for (let attempt = 0; target === "local" && result.exitCode !== 0 && isDatabaseBusy(result) && attempt < 2; attempt += 1) {
    await waitForRetry((attempt + 1) * 100);
    result = await runCommand(command, projectRoot);
  }
  return result;
}

/** Writes potentially sensitive SQL through a 0600 temporary file. */
export async function executeWriteSql(
  sql: string,
  target: Target,
  dependencies: Pick<CreateAdminDependencies, "runCommand" | "temporaryRoot"> = {},
) {
  const directory = await mkdtemp(join(dependencies.temporaryRoot ?? tmpdir(), "grade-management-admin-"));
  const sqlFile = join(directory, "operation.sql");
  try {
    await writeFile(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
    await chmod(sqlFile, 0o600);
    const result = await runD1Command(
      buildWranglerWriteCommand(sqlFile, target),
      target,
      dependencies.runCommand ?? defaultRunCommand,
    );
    if (result.exitCode !== 0) {
      throw new CliError(formatWranglerError(result));
    }
    return result.stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Reads generated opaque IDs with Wrangler's --command transport, which is the
 * only remote D1 execute mode that returns SELECT rows. Callers must not pass
 * personal data or secrets here because command arguments can be observable.
 */
export async function executeReadSql(
  sql: string,
  target: Target,
  dependencies: Pick<CreateAdminDependencies, "runCommand"> = {},
) {
  const result = await runD1Command(
    buildWranglerReadCommand(sql, target),
    target,
    dependencies.runCommand ?? defaultRunCommand,
  );
  if (result.exitCode !== 0) {
    throw new CliError(formatWranglerError(result));
  }
  return parseD1Rows(result.stdout);
}

function formatWranglerError(result: CommandResult) {
  const raw = [result.stderr, result.stdout].filter(Boolean).join("\n");
  if (isDatabaseBusy(result)) {
    return "local D1が開発serverにより使用中です。bun run dev を停止してから、もう一度実行してください。";
  }
  const detail = raw
    .replace(/\s+/gu, " ")
    .slice(0, 500);
  return detail ? `D1への書き込みに失敗しました: ${detail}` : "D1への書き込みに失敗しました。";
}

export function parseD1Rows(stdout: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || !("results" in entry)) return [];
      const results = (entry as { results?: unknown }).results;
      return Array.isArray(results)
        ? results.filter(
            (row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row),
          )
        : [];
    });
  } catch {
    throw new CliError("D1の応答を確認できませんでした。作成を中止しました。");
  }
}

function isVerifiedAdmin(rows: Array<Record<string, unknown>>, payload: AdminPayload) {
  return rows.some(
    (row) =>
      row.id === payload.id &&
      row.name === payload.name &&
      row.email === payload.email &&
      row.role === "admin" &&
      row.status === "active" &&
      Number(row.must_change_password) === 1 &&
      row.account_id === payload.accountId &&
      row.provider_account_id === payload.id &&
      row.provider_id === "credential" &&
      row.user_id === payload.id &&
      typeof row.password === "string" &&
      row.password.length > 0,
  );
}

function generateTemporaryPassword() {
  return randomBytes(24).toString("base64url");
}

function isDuplicateError(error: unknown) {
  return error instanceof Error && /unique constraint failed: user\.email|duplicate/i.test(error.message);
}

async function ensureNewIds(
  target: Target,
  generateId: () => string,
  dependencies: Pick<CreateAdminDependencies, "runCommand" | "temporaryRoot">,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const userId = generateId();
    const accountId = generateId();
    const [users, accounts] = await Promise.all([
      executeReadSql(buildExistingUserIdSql(userId), target, dependencies),
      executeReadSql(buildExistingAccountIdSql(accountId), target, dependencies),
    ]);
    if (users.length === 0 && accounts.length === 0) {
      return { userId, accountId };
    }
  }
  throw new CliError("新しいアカウントIDを安全に確保できませんでした。もう一度実行してください。");
}

async function compensateForPartialCreation(
  payload: AdminPayload,
  target: Target,
  dependencies: Pick<CreateAdminDependencies, "runCommand" | "temporaryRoot">,
) {
  try {
    await executeWriteSql(buildCompensationSql(payload), target, dependencies);
    const [users, accounts] = await Promise.all([
      executeReadSql(buildExistingUserIdSql(payload.id), target, dependencies),
      executeReadSql(buildExistingAccountIdSql(payload.accountId), target, dependencies),
    ]);
    return users.length === 0 && accounts.length === 0;
  } catch {
    return false;
  }
}

export async function createAdmin(
  input: Omit<Extract<ParsedArguments, { kind: "create" }>, "kind" | "yes">,
  dependencies: CreateAdminDependencies = {},
): Promise<CreatedAdmin> {
  const executionDependencies = {
    runCommand: dependencies.runCommand,
    temporaryRoot: dependencies.temporaryRoot,
  };
  const ids = await ensureNewIds(input.target, dependencies.generateId ?? randomUUID, executionDependencies);
  const password = (dependencies.generatePassword ?? generateTemporaryPassword)();
  const passwordHash = await (dependencies.hash ?? hashPassword)(password);
  const payload: AdminPayload = {
    id: ids.userId,
    accountId: ids.accountId,
    name: input.name,
    email: input.email,
    passwordHash,
  };

  try {
    await executeWriteSql(buildCreateAdminSql(payload), input.target, executionDependencies);
    const rows = await executeReadSql(
      buildVerificationSql(payload.id, payload.accountId),
      input.target,
      executionDependencies,
    );
    if (!isVerifiedAdmin(rows, payload)) {
      const removed = await compensateForPartialCreation(payload, input.target, executionDependencies);
      throw new CliError(
        removed
          ? "作成結果を確認できなかったため、作成したレコードを取り消しました。"
          : `作成結果を確認できませんでした。D1でID ${payload.id} の状態を確認してください。`,
      );
    }
  } catch (error) {
    const removed = await compensateForPartialCreation(payload, input.target, executionDependencies);
    if (isDuplicateError(error)) {
      throw new CliError(`このメールアドレスには既存のアカウントがあります: ${input.email}`);
    }
    if (error instanceof CliError && error.message.includes("作成結果を確認でき")) throw error;
    throw new CliError(
      removed
        ? "専任職員アカウントを作成できませんでした。作成途中のレコードは取り消しました。"
        : `専任職員アカウントを作成できませんでした。D1でID ${payload.id} の状態を確認してください。`,
    );
  }

  return { id: payload.id, email: input.email, temporaryPassword: password, target: input.target };
}

async function confirmRemote() {
  if (!process.stdin.isTTY) {
    throw new CliError("リモートD1へ作成するには対話確認を行うか、CIでは --yes を明示してください。");
  }
  process.stdout.write("リモートD1に専任職員アカウントを作成します。続行しますか？ [y/N] ");
  const answer = await new Promise<string>((resolveAnswer) => {
    process.stdin.once("data", (chunk: Buffer) => resolveAnswer(chunk.toString("utf8").trim()));
  });
  if (!/^(y|yes)$/iu.test(answer)) throw new CliError("リモートD1への作成を中止しました。");
}

export async function runCli(args: string[], dependencies: CreateAdminDependencies = {}) {
  const parsed = parseArguments(args);
  if (parsed.kind === "help") {
    console.log(helpText);
    return;
  }
  if (parsed.target === "remote" && !parsed.yes) await confirmRemote();

  const created = await createAdmin(parsed, dependencies);
  console.log(`専任職員アカウントを${created.target === "remote" ? "リモートD1" : "local D1"}に作成しました。`);
  console.log(`メールアドレス: ${created.email}`);
  console.log("一時パスワード（この表示は一度だけです）:");
  console.log(created.temporaryPassword);
  console.log("初回ログイン後にパスワードを変更してください。");
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "予期しないエラーが発生しました。";
    console.error(`専任職員アカウントを作成できませんでした: ${message}`);
    process.exitCode = 1;
  }
}
