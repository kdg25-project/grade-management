export type ImportKind = "students" | "teachers" | "staff" | "subjects";
export type ImportSnapshot = { academicYear: number; kind: ImportKind; csv: string; gradeLevel?: 1 | 2 | 3 };
export const importKindLabels: Record<ImportKind, string> = { students: "学生CSV", teachers: "講師CSV", staff: "専任職員CSV", subjects: "科目CSV" };
const source = (snapshot: ImportSnapshot) => JSON.stringify(snapshot);
export const importFingerprint = (snapshot: ImportSnapshot) => {
  let hash = 2_166_136_261;
  for (const char of source(snapshot)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16_777_619); }
  return `${snapshot.academicYear}:${(hash >>> 0).toString(16)}`;
};
export const sameImportSnapshot = (left: ImportSnapshot, right: ImportSnapshot) => source(left) === source(right);
export const snapshotIsReady = (snapshot: ImportSnapshot) => Boolean(snapshot.csv) && (snapshot.kind !== "subjects" || snapshot.gradeLevel === 1 || snapshot.gradeLevel === 2 || snapshot.gradeLevel === 3);
export const safeCredentialCsv = (items: Array<{ name: string; email: string; role: string; temporaryPassword: string }>) => {
  const guard = (value: string) => /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
  const quote = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `\uFEFF氏名,メールアドレス,権限,一時パスワード\r\n${items.map((item) => [item.name, item.email, item.role === "teacher" ? "講師" : "専任職員", item.temporaryPassword].map((value) => quote(guard(value))).join(",")).join("\r\n")}\r\n`;
};
