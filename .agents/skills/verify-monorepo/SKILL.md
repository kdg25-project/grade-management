---
name: verify-monorepo
description: Verify changes in this Bun workspaces monorepo across Next.js, Hono, Drizzle/PostgreSQL, Docker Compose, and Nginx. Use after implementation, before completion or review, and when diagnosing test, typecheck, build, migration, workspace, container, health-check, or reverse-proxy failures.
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
docker compose config --quiet
```

Also run the narrowest relevant test first when it gives faster feedback. Do not treat a later success as cancelling an earlier failure.

For database schema changes, run `bun run db:generate`, inspect the generated SQL for destructive or unintended operations, and verify migrations against a disposable PostgreSQL database when available. Do not apply migrations to shared or production data.

For Docker or Nginx changes, validate container builds and `nginx -t` when the daemon and images are available. Check these routing invariants:

- `/api` and `/api/*` preserve the prefix and reach Hono.
- Non-API paths, including `/apiary`, reach Next.js.
- Forwarded host, protocol, and client IP headers are present.
- Health checks and `depends_on` conditions match actual service endpoints.

## Diagnose and report

- Classify each failure as introduced, pre-existing, environment/tooling, or blocked by unavailable dependencies.
- Include the command, exit status, and concise relevant output. Never report a skipped check as passing.
- If a command cannot run because of sandbox, network, Docker daemon, credentials, or missing services, report the exact blocker and a safe rerun command.
- Finish with an explicit list of passed, failed, skipped, and residual-risk checks.
