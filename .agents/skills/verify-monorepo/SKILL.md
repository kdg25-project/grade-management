---
name: verify-monorepo
description: Verify changes in this Bun workspaces monorepo across Vite React, Hono Workers, Drizzle/D1, and Workers Static Assets. Use after implementation, before completion or review, and when diagnosing test, typecheck, build, migration, workspace, health-check, or SPA routing failures.
---

# Verify Monorepo

## Prepare

1. Read `AGENTS.md`, root `package.json`, affected workspace manifests, and `git status --short`.
2. Map changed files to the checks below. Preserve unrelated changes and never commit.
3. Use the repository's pinned Bun version. Run `bun install --frozen-lockfile`; do not update the lockfile during verification.

## Run checks

Run repository-wide checks from the root in this order:

```bash
bun run test
bun run typecheck
bun run build
bun run db:migrate
bun run deploy:dry-run
```

Also run the narrowest relevant test first when it gives faster feedback. Do not treat a later success as cancelling an earlier failure.

Cloudflare Vite plugin injects the static-assets directory into the build-generated Wrangler config, so do not run a deploy dry-run directly against the input `wrangler.jsonc`.

For database schema changes, run `bun run db:generate`, inspect the generated SQL for destructive or unintended operations, and verify migrations against disposable local D1. Do not apply migrations to shared or production data.

For Workers Static Assets changes, validate the Workers dry-run and local Worker when available. Check these routing invariants:

- `/api` and `/api/*` preserve the prefix and reach Hono.
- Non-API paths, including `/apiary`, reach the SPA fallback.
- Deep SPA routes return the client shell.
- `run_worker_first` protects `/api` and `/api/*` from SPA fallback.

## Diagnose and report

- Classify each failure as introduced, pre-existing, environment/tooling, or blocked by unavailable dependencies.
- Include the command, exit status, and concise relevant output. Never report a skipped check as passing.
- If a command cannot run because of sandbox, network, credentials, or missing services, report the exact blocker and a safe rerun command.
- Finish with an explicit list of passed, failed, skipped, and residual-risk checks.
