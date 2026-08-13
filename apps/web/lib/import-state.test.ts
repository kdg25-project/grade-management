import { describe, expect, it } from "bun:test";
import { importFingerprint, sameImportSnapshot, snapshotIsReady } from "./import-state";

describe("individual normal import state", () => {
  it("invalidates confirmation when the kind, grade, or file changes", () => { const first = { academicYear: 2027, kind: "subjects" as const, gradeLevel: 1 as const, csv: "CSV" }; expect(sameImportSnapshot(first, { ...first })).toBeTrue(); expect(importFingerprint(first)).not.toBe(importFingerprint({ ...first, gradeLevel: 2 })); expect(sameImportSnapshot(first, { ...first, csv: "changed" })).toBeFalse(); });
  it("requires a selected grade only for subject CSV", () => { expect(snapshotIsReady({ academicYear: 2027, kind: "students", csv: "CSV" })).toBeTrue(); expect(snapshotIsReady({ academicYear: 2027, kind: "subjects", csv: "CSV" })).toBeFalse(); expect(snapshotIsReady({ academicYear: 2027, kind: "subjects", csv: "CSV", gradeLevel: 3 })).toBeTrue(); });
});
