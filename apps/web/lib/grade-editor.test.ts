import { describe, expect, it } from "bun:test";

import { canApplyDraftChange, canEditDraft, canEditInViewport, canSaveGrades, canSaveWeights, draftHasErrors, draftPayload, formatScore, needsInitialWeightSave, previewScore, validateDraftValue, validateWeights } from "./grade-editor";

describe("grade editor helpers", () => {
  it("accepts the attendance zero boundary and rejects values over the range", () => {
    expect(validateDraftValue("attendanceRate", "0")).toBeNull();
    expect(validateDraftValue("attendanceRate", "101")).toContain("0〜100");
  });

  it("does not clamp invalid input and builds a typed save payload", () => {
    expect(validateDraftValue("attitude", "11")).not.toBeNull();
    const rows = [{ studentId: "s1", studentNumber: "1", name: "A", status: "enrolled" as const, editable: true, hasFailedHistory: false, values: { attendanceRate: "0", attitude: "0", assignment: "10" }, score: null }];
    expect(draftHasErrors(rows)).toBeFalse();
    expect(draftPayload(rows)).toEqual([{ studentId: "s1", attendanceRate: 0, attitude: 0, assignment: 10 }]);
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

  it("blocks cross-saving while the other grade draft is dirty", () => {
    expect(canSaveGrades(true, false)).toBeTrue();
    expect(canSaveWeights(true, false)).toBeFalse();
    expect(canSaveGrades(false, true)).toBeFalse();
    expect(canSaveWeights(false, true)).toBeTrue();
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
