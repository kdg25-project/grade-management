import { describe, expect, it } from "bun:test";

import { calculateGrade, GradeValidationError, letterGradeForNumerator, validateGradeWeights } from "./calculation";
import { editableTermForStatuses } from "./service";

describe("grade calculation", () => {
  const weights = { attendanceWeight: 100, attitudeWeight: 0, assignmentWeight: 0 };

  it.each([
    [8_999, "A"], [9_000, "S"], [7_999, "B"], [8_000, "A"],
    [6_999, "C"], [7_000, "B"], [5_999, "F"], [6_000, "C"],
  ] as const)("assigns %d to %s at inclusive boundaries", (numerator, letterGrade) => {
    expect(letterGradeForNumerator(numerator)).toBe(letterGrade);
  });

  it("persists the exact numerator without rounding", () => {
    expect(calculateGrade(
      { attendanceRate: 89, attitude: 8, assignment: 7 },
      { attendanceWeight: 55, attitudeWeight: 20, assignmentWeight: 25 },
    )).toEqual({ finalScoreNumerator: 8_245, finalScoreDenominator: 100, letterGrade: "A" });
  });

  it("allows incomplete drafts but withholds final score and grade", () => {
    expect(calculateGrade({ attendanceRate: 80, attitude: null, assignment: 10 }, weights)).toBeNull();
  });

  it("rejects invalid input and non-100 weight totals instead of clamping", () => {
    expect(() => calculateGrade({ attendanceRate: 101, attitude: 1, assignment: 1 }, weights)).toThrow(GradeValidationError);
    expect(() => calculateGrade({ attendanceRate: 100, attitude: 0, assignment: 1 }, weights)).toThrow(GradeValidationError);
    expect(() => calculateGrade({ attendanceRate: 100, attitude: 1, assignment: 0 }, weights)).toThrow(GradeValidationError);
    expect(() => validateGradeWeights({ attendanceWeight: 34, attitudeWeight: 33, assignmentWeight: 32 })).toThrow(GradeValidationError);
  });

  it("moves from term 1 to term 2 and then read-only", () => {
    expect(editableTermForStatuses(false, false)).toBe(1);
    expect(editableTermForStatuses(true, false)).toBe(2);
    expect(editableTermForStatuses(true, true)).toBeNull();
  });
});
