import { describe, expect, it } from "bun:test";
import { gradeExportScopeLabels, gradePdfOptions, toGradeCsv, toGradePdfHtml, validateGradeExportQuery } from "./grade-export";

describe("grade CSV export rules", () => {
  it("defines bounded scope years and makes term mandatory only for term export", () => {
    expect(validateGradeExportQuery({ scope: "three_years", format: "csv" }, 2027).years).toEqual([2025, 2026, 2027]);
    expect(validateGradeExportQuery({ scope: "previous_year", format: "pdf" }, 2027).years).toEqual([2026]);
    expect(() => validateGradeExportQuery({ scope: "term", format: "csv" }, 2027)).toThrow();
    expect(() => validateGradeExportQuery({ scope: "term", format: "unknown" as "csv" }, 2027)).toThrow();
    expect(validateGradeExportQuery({ scope: "term", format: "pdf", term: 2 }, 2027).years).toEqual([2027]);
  });
  it("writes BOM RFC4180 cells and neutralizes spreadsheet formulas", () => {
    const csv = toGradeCsv([{ id: "g1", studentNumber: "\t=HYPERLINK()", studentName: " =SUM()", academicYear: 2027, term: 1, courseName: "\r@course", gradeLevel: 1, subjectName: "-1", attendanceRate: 100, letterGrade: "S" }]);
    expect(csv.startsWith("\uFEFF学籍番号")).toBeTrue(); expect(csv).toContain("'\t=HYPERLINK()"); expect(csv).toContain("' =SUM()"); expect(csv).toContain("'\r@course"); expect(csv).toContain("'-1");
  });
  it("renders self-contained escaped A4-landscape PDF HTML with the same nine columns", () => {
    const html = toGradePdfHtml([{ id: "g1", studentNumber: "<A&>", studentName: `\"'`, academicYear: 2027, term: 1, courseName: "Web", gradeLevel: 1, subjectName: "<script>", attendanceRate: 88, letterGrade: "A" }], { academicYear: 2027, scope: "term", generatedAt: 1_800_000_000 });
    expect(gradeExportScopeLabels.term).toBe("年度・学期別"); expect(gradePdfOptions).toMatchObject({ format: "a4", landscape: true, printBackground: true });
    expect(html).toContain("&lt;A&amp;&gt;"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain("IPAfont Gothic"); expect(html).toContain("Noto Sans CJK JP"); expect(html).toContain("table-header-group"); expect(gradePdfOptions.footerTemplate).toContain("totalPages"); expect((html.match(/<th>/g) ?? [])).toHaveLength(9);
  });
});
