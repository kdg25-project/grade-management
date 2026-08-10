---
name: grade-management-domain
description: Apply the confirmed SANSUN grade-management business rules for grades, term finalization, permissions, students, CSV import, annual rollover, academic years, PDF output, and performance requirements. Use when designing, implementing, testing, or reviewing domain logic, database schema, API routes, authorization, import workflows, or grade-related UI in this repository.
---

# Grade Management Domain

## Workflow

1. Read [references/domain-rules.md](references/domain-rules.md) completely before changing domain behavior.
2. Compare the request with the precedence order in `AGENTS.md`. Treat the latest user instruction as authoritative.
3. Identify affected invariants, roles, transaction boundaries, and audit requirements before editing.
4. Keep unresolved choices unresolved. Ask the orchestrator to clarify any ambiguity that could alter architecture, data modeling, authorization, or UX.
5. Add tests for calculations, grade boundaries, authorization, finalization transitions, and all-or-nothing imports as applicable.

## Implementation guardrails

- Put schema and migration changes in `packages/db` and generate a Drizzle migration.
- Enforce permissions and finalized-state restrictions in the API, not only in the UI.
- Use D1 `batch()` plus unique idempotency keys for imports and rollover operations.
- Preserve historical academic-year and term records; do not derive mutable history from the current date.
- Use integer or fixed-precision arithmetic for persisted grade calculations. Define rounding explicitly before implementation.
- Record assumptions and unresolved rules in the handoff instead of silently inventing policy.
