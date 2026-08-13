import type { GradeExportQuery, GradeExportScope } from "./admin-api";
export const gradeExportPatterns: Array<{ value: GradeExportScope; label: string; description: string }> = [
  { value: "year_all_students", label: "年度・全学生", description: "指定年度の確定済み成績行を出力します。未成績の学生は含みません。" },
  { value: "three_years", label: "直近3年度", description: "指定年度を含む直近3年度の確定済み成績を出力します。" },
  { value: "previous_year", label: "前年度", description: "指定年度の前年度の確定済み成績を出力します。" },
  { value: "confirmed_to_date", label: "確定済み・累計3年度", description: "指定年度を含む直近3年度の、確定済み成績だけを出力します。" },
  { value: "term", label: "年度・学期別", description: "指定年度・学期の確定済み成績を出力します。" },
];
export const gradeExportQuery = (values: { year: string; scope: GradeExportScope; term: string; courseId: string; gradeLevel: string; subjectId: string }): GradeExportQuery => ({ academicYear: /^\d{4}$/.test(values.year) ? Number(values.year) : undefined, scope: values.scope, term: values.scope === "term" && (values.term === "1" || values.term === "2") ? Number(values.term) as 1 | 2 : undefined, courseId: values.courseId || undefined, gradeLevel: ["1", "2", "3"].includes(values.gradeLevel) ? Number(values.gradeLevel) as 1 | 2 | 3 : undefined, subjectId: values.subjectId || undefined });
