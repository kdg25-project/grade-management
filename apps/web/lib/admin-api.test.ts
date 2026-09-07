import { describe, expect, it } from "bun:test";

import { adminStudentsRequestQuery, applyNormalImport, responseShape } from "./admin-api";

const importApplyResult = (overrides: Record<string, unknown> = {}) => ({ applied: true, replayed: false, credentialsAlreadyIssued: false, summary: { students: 1, teachers: 0, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, credentials: [], ...overrides });
const responseFetch = (body: unknown) => Object.assign(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(body), { preconnect: () => {} }) satisfies typeof fetch;

describe("admin student API query", () => {
  it("keeps the selected academic year with all student-list filters", () => {
    expect(adminStudentsRequestQuery({ academicYear: 2026, enrollmentYear: 2026, gradeLevel: 1, search: "山田", page: 2, pageSize: 50 })).toEqual({ page: "2", pageSize: "50", academicYear: 2026, search: "山田", courseId: undefined, enrollmentYear: 2026, gradeLevel: 1, status: undefined });
  });

  it("rejects malformed import and rollover successes before the pages render them", () => {
    expect(responseShape.isNormalImportApply({ applied: true, replayed: false, credentialsAlreadyIssued: false, summary: { students: 1, teachers: 0, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } } })).toBeFalse();
    expect(responseShape.isNormalImportApply({ applied: true, replayed: false, credentialsAlreadyIssued: false, summary: { students: 1, teachers: 0, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, credentials: [] })).toBeTrue();
    expect(responseShape.isNormalImportApply(importApplyResult({ applied: false }))).toBeFalse();
    expect(responseShape.isNormalImportPreview({ academicYear: 2027, counts: { students: 0, teachers: 0, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, errors: [{ file: "講師CSV", field: "上限", reason: "上限です" }] })).toBeTrue();
    expect(responseShape.isRolloverPreview({ targetYear: 2027, errors: undefined })).toBeFalse();
  });

  it("rejects a false HTTP 200 apply response before it can become applied page state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = responseFetch(importApplyResult({ applied: false }));
    try {
      await expect(applyNormalImport({ token: "import-token-0123456789", idempotencyKey: "retry-key-0123456789" })).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 502 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts normal and replayed import successes through the client boundary", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = responseFetch(importApplyResult({ replayed: true, credentialsAlreadyIssued: true }));
    try {
      await expect(applyNormalImport({ token: "import-token-0123456789", idempotencyKey: "retry-key-0123456789" })).resolves.toMatchObject({ applied: true, replayed: true, credentialsAlreadyIssued: true, credentials: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
