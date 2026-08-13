import { describe, expect, it } from "bun:test";
import { toGradeCsv, validateGradeExportQuery } from "./grade-export";

describe("grade CSV export rules", () => {
  it("defines bounded scope years and makes term mandatory only for term export", () => {
    expect(validateGradeExportQuery({ scope: "three_years" }, 2027).years).toEqual([2025, 2026, 2027]);
    expect(validateGradeExportQuery({ scope: "previous_year" }, 2027).years).toEqual([2026]);
    expect(() => validateGradeExportQuery({ scope: "term" }, 2027)).toThrow();
    expect(validateGradeExportQuery({ scope: "term", term: 2 }, 2027).years).toEqual([2027]);
  });
  it("writes BOM RFC4180 cells and neutralizes spreadsheet formulas", () => {
    const csv = toGradeCsv([{ id: "g1", studentNumber: "\t=HYPERLINK()", studentName: " =SUM()", academicYear: 2027, term: 1, courseName: "\r@course", gradeLevel: 1, subjectName: "-1", attendanceRate: 100, letterGrade: "S" }]);
    expect(csv.startsWith("\uFEFF学籍番号")).toBeTrue(); expect(csv).toContain("'\t=HYPERLINK()"); expect(csv).toContain("' =SUM()"); expect(csv).toContain("'\r@course"); expect(csv).toContain("'-1");
  });
});
