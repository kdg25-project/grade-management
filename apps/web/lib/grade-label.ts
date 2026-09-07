export type LetterGrade = "S" | "A" | "B" | "C" | "F";

export const gradeLabels: Record<LetterGrade, string> = { S: "秀", A: "優", B: "良", C: "可", F: "不可" };

export const displayGrade = (grade: LetterGrade | null | undefined) => grade === null || grade === undefined ? "未算出" : gradeLabels[grade];
