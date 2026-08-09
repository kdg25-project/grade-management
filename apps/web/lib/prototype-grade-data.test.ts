import { describe, expect, it } from "bun:test";

import {
  getEntryProgress,
  isGradeInputFormat,
  isGradeInputInRange,
  prototypeGradeRows,
} from "./prototype-grade-data";

describe("prototype grade display helpers", () => {
  it("uses the specified entry ranges without silently clamping", () => {
    expect(isGradeInputInRange("attendanceRate", "0")).toBe(true);
    expect(isGradeInputInRange("attendanceRate", "100")).toBe(true);
    expect(isGradeInputInRange("attendanceRate", "101")).toBe(false);
    expect(isGradeInputInRange("attitude", "0")).toBe(false);
    expect(isGradeInputInRange("attitude", "1")).toBe(true);
    expect(isGradeInputInRange("attitude", "10")).toBe(true);
    expect(isGradeInputInRange("attitude", "1.5")).toBe(false);
    expect(isGradeInputInRange("assignment", "9.5")).toBe(false);
    expect(isGradeInputInRange("assignment", "10")).toBe(true);
    expect(isGradeInputInRange("assignment", "11")).toBe(false);
  });

  it("allows an empty value while editing, but never treats it as complete", () => {
    expect(isGradeInputFormat("attendanceRate", "")).toBe(true);
    expect(isGradeInputFormat("attitude", "")).toBe(true);
    expect(isGradeInputFormat("attitude", "1.5")).toBe(false);
    expect(isGradeInputInRange("attendanceRate", "")).toBe(false);
  });

  it("does not count students on leave in the editable progress", () => {
    expect(getEntryProgress(prototypeGradeRows)).toEqual({
      complete: 1,
      total: 3,
      pending: 2,
    });
  });

  it("keeps an active student pending until every value is in range", () => {
    const rows = prototypeGradeRows.map((row) => ({
      ...row,
      input: { ...row.input },
    }));
    rows[0].input.attendanceRate = "101";
    rows[1].input = { attendanceRate: "99.5", attitude: "1", assignment: "10" };
    rows[3].input = { attendanceRate: "0", attitude: "10", assignment: "1" };

    expect(getEntryProgress(rows)).toEqual({
      complete: 2,
      total: 3,
      pending: 1,
    });
  });

  it("marks all editable students complete when all three inputs are valid", () => {
    const rows = prototypeGradeRows.map((row) => ({
      ...row,
      input: { attendanceRate: "100", attitude: "10", assignment: "1" },
    }));

    expect(getEntryProgress(rows)).toEqual({
      complete: 3,
      total: 3,
      pending: 0,
    });
  });
});
