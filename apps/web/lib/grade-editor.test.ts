import { describe, expect, it } from "bun:test";

import { canApplyDraftChange, canEditDraft, canEditInViewport, canSaveGrades, canSaveWeights, draftHasErrors, draftPayload, formatScore, hasUnreplacedLegacyValues, needsInitialWeightSave, previewScore, rowsFromStudents, validateDraftValue, validateWeights } from "./grade-editor";

describe("grade editor helpers", () => {
  it("accepts the attendance zero boundary and rejects values over the range", () => {
    expect(validateDraftValue("attendanceRate", "0")).toBeNull();
    expect(validateDraftValue("attendanceRate", "101")).toContain("0〜100");
  });

  it("requires new attitude and assignment values to start at one", () => {
    expect(validateDraftValue("attitude", "0")).toContain("1〜10");
    expect(validateDraftValue("assignment", "0")).toContain("1〜10");
  });

  it("does not clamp invalid input and builds a typed save payload", () => {
    expect(validateDraftValue("attitude", "11")).not.toBeNull();
    const rows = [{ studentId: "s1", studentNumber: "1", name: "A", status: "enrolled" as const, editable: true, hasFailedHistory: false, values: { attendanceRate: "0", attitude: "1", assignment: "10" }, score: null }];
    expect(draftHasErrors(rows)).toBeFalse();
    expect(draftPayload(rows)).toEqual([{ studentId: "s1", attendanceRate: 0, attitude: 1, assignment: 10 }]);
  });

  it("blocks only save-eligible legacy zero values and omits non-eligible rows from the payload", () => {
    const rows = rowsFromStudents([
      { id: "enrolled-legacy", studentNumber: "1", name: "在籍旧値", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 90, attitude: 0, assignment: 0, finalScoreNumerator: 9000, finalScoreDenominator: 100, letterGrade: "S" } },
      { id: "enrolled-clean", studentNumber: "2", name: "在籍", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 80, attitude: 8, assignment: 8, finalScoreNumerator: 8000, finalScoreDenominator: 100, letterGrade: "A" } },
      { id: "suspended-legacy", studentNumber: "3", name: "休学旧値", status: "suspended", editable: false, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 70, attitude: 0, assignment: 0, finalScoreNumerator: 7000, finalScoreDenominator: 100, letterGrade: "B" } },
      { id: "withdrawn-legacy", studentNumber: "4", name: "退学旧値", status: "withdrawn", editable: false, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 60, attitude: 0, assignment: 0, finalScoreNumerator: 6000, finalScoreDenominator: 100, letterGrade: "C" } },
    ]);
    expect(rows[0]?.values).toMatchObject({ attitude: "0", assignment: "0" });
    expect(draftHasErrors(rows)).toBeFalse();
    expect(hasUnreplacedLegacyValues(rows)).toBeTrue();
    expect(canSaveGrades(true, false) && !hasUnreplacedLegacyValues(rows)).toBeFalse();
    expect(draftPayload(rows).map((row) => row.studentId)).toEqual(["enrolled-legacy", "enrolled-clean"]);

    const replaced = rows.map((row) => row.studentId === "enrolled-legacy" ? { ...row, values: { ...row.values, attitude: "1", assignment: "1" }, legacyZeroFields: [] } : row);
    expect(hasUnreplacedLegacyValues(replaced)).toBeFalse();
    expect(draftPayload(replaced).map((row) => row.studentId)).toEqual(["enrolled-legacy", "enrolled-clean"]);
  });

  it("requires weight total 100 and preserves exact score representation", () => {
    expect(validateWeights({ attendanceWeight: 50, attitudeWeight: 25, assignmentWeight: 25 })).toBeNull();
    expect(validateWeights({ attendanceWeight: 50, attitudeWeight: 25, assignmentWeight: 24 })).toContain("100");
    expect(formatScore(8765, 100)).toBe("87.65/100");
  });

  it("disables editing in a mobile viewport", () => {
    expect(canEditInViewport(true, true)).toBeFalse();
    expect(canEditInViewport(true, false)).toBeTrue();
  });

  it("previews the exact unrounded score for dirty input", () => {
    expect(previewScore({ attendanceRate: "89", attitude: "8", assignment: "7" }, { attendanceWeight: 55, attitudeWeight: 20, assignmentWeight: 25 }))
      .toEqual({ finalScoreNumerator: 8245, finalScoreDenominator: 100, letterGrade: "A" });
  });

  it("keeps a retained dirty snapshot saveable for a reload retry while blocking cross-saving", () => {
    // A POST can succeed while its following GET fails. The retained snapshot
    // must remain dirty so the teacher can submit the same values again.
    expect(canSaveGrades(true, false)).toBeTrue();
    expect(canSaveWeights(true, false)).toBeFalse();
    expect(canSaveGrades(false, true)).toBeFalse();
    expect(canSaveWeights(false, true)).toBeTrue();
    expect(canSaveGrades(false, false)).toBeFalse();
    expect(canSaveWeights(false, false)).toBeFalse();
  });

  it("requires a new subject's default weights to be saved before grade entry can be saved", () => {
    expect(needsInitialWeightSave(null, true)).toBeTrue();
    expect(needsInitialWeightSave(null, false)).toBeFalse();
    expect(needsInitialWeightSave({ attendanceWeight: 100, attitudeWeight: 0, assignmentWeight: 0 }, true)).toBeFalse();
    expect(canSaveGrades(true, false, false, false)).toBeFalse();
    expect(canSaveWeights(false, true)).toBeTrue();
  });

  it("locks every draft control while either save is in progress", () => {
    expect(canEditDraft(true, false, true)).toBeFalse();
    expect(canApplyDraftChange(true)).toBeFalse();
    expect(canSaveGrades(true, false, true)).toBeFalse();
    expect(canSaveWeights(false, true, true)).toBeFalse();
  });
});
