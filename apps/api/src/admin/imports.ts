import { AdminDomainError, validateYear } from "./service";
import { parseCsv } from "./rollover";

export const importKinds = ["students", "teachers", "staff", "subjects"] as const;
export type ImportKind = typeof importKinds[number];
export type ImportInput = { academicYear: number; kind: ImportKind; csv: string; gradeLevel?: 1 | 2 | 3 };
export type ImportRowError = { file: string; row: number; field: string; reason: string };
export const importHeaders = {
  students: ["学籍番号", "氏名", "氏名（ひらがな）", "年齢", "生年月日", "性別", "メールアドレス", "電話番号", "郵便番号", "住所", "専攻"],
  users: ["氏名", "氏名（ひらがな）", "年齢", "性別", "メールアドレス"],
  subjects: ["専攻", "科目名", "担当講師"],
} as const;

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const trim = (value: string) => value.trim();
const email = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const date = (value: string) => {
  const match = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const duplicate = (values: string[], file: string, field: string, errors: ImportRowError[]) => { if (new Set(values).size !== values.length) errors.push({ file, row: 0, field, reason: "重複しています。" }); };
const fileFor = (kind: ImportKind) => ({ students: "学生CSV", teachers: "講師CSV", staff: "専任職員CSV", subjects: "科目CSV" })[kind];
const ageLooksImpossible = (age: number, birthDate: string) => {
  const birthYear = Number(birthDate.slice(0, 4));
  const difference = new Date().getUTCFullYear() - birthYear;
  // CSV ages are captured at different times.  Only reject values that are
  // plainly incompatible, rather than requiring a birthday-exact equality.
  return age < 0 || age > 120 || Math.abs(age - difference) > 3;
};

export const parseImport = (input: ImportInput) => {
  validateYear(input.academicYear);
  if (!importKinds.includes(input.kind)) throw new AdminDomainError("INVALID_IMPORT_KIND", "CSVの種類を正しく指定してください。");
  if (typeof input.csv !== "string" || bytes(input.csv) > 600_000) throw new AdminDomainError("IMPORT_PAYLOAD_TOO_LARGE", "CSVは600KB以下にしてください。", 413);
  if (input.kind === "subjects" && input.gradeLevel !== 1 && input.gradeLevel !== 2 && input.gradeLevel !== 3) throw new AdminDomainError("IMPORT_GRADE_LEVEL_REQUIRED", "科目CSVでは対象学年を指定してください。");
  if (input.kind !== "subjects" && input.gradeLevel !== undefined) throw new AdminDomainError("IMPORT_GRADE_LEVEL_FORBIDDEN", "対象学年は科目CSVでのみ指定できます。");
  const errors: ImportRowError[] = []; const file = fileFor(input.kind);
  const students: Array<{ studentNumber: string; name: string; kana: string; birthDate: string; gender: string; email: string; phone: string; postalCode: string; address: string; course: string }> = [];
  const teachers: Array<{ name: string; email: string; role: "teacher"; row: number }> = [];
  const staff: Array<{ name: string; email: string; role: "admin"; row: number }> = [];
  const subjects: Array<{ gradeLevel: 1 | 2 | 3; course: string; name: string; teacherName: string }> = [];
  if (input.kind === "students") {
    for (const [index, row] of parseCsv(file, input.csv, importHeaders.students, errors).entries()) {
      const [studentNumber, name, kana, rawAge, rawDate, gender, rawEmail, phone, postalCode, address, course] = row.map(trim); const birthDate = date(rawDate); const age = Number(rawAge); const normalizedEmail = rawEmail.toLowerCase();
      if (!studentNumber || !name || !kana || !birthDate || !Number.isInteger(age) || ageLooksImpossible(age, birthDate) || !["男", "女"].includes(gender) || !email(normalizedEmail) || !["システムエンジニア", "Webデザイナー"].includes(course)) errors.push({ file, row: index + 2, field: "入力値", reason: "学生情報を確認してください。" });
      students.push({ studentNumber, name, kana, birthDate: birthDate ?? "", gender, email: normalizedEmail, phone, postalCode, address, course });
    }
    duplicate(students.map((item) => item.studentNumber), file, "学籍番号", errors); duplicate(students.map((item) => item.email), file, "メールアドレス", errors);
  }
  if (input.kind === "teachers" || input.kind === "staff") {
    const role = input.kind === "teachers" ? "teacher" as const : "admin" as const;
    for (const [index, row] of parseCsv(file, input.csv, importHeaders.users, errors).entries()) {
      const [name, kana, rawAge, gender, rawEmail] = row.map(trim); const age = Number(rawAge); const normalizedEmail = rawEmail.toLowerCase();
      if (!name || !kana || !Number.isInteger(age) || age < 18 || age > 120 || !["男", "女"].includes(gender) || !email(normalizedEmail)) errors.push({ file, row: index + 2, field: "入力値", reason: "氏名・年齢・性別・メールアドレスを確認してください。" });
      if (role === "teacher") teachers.push({ name, email: normalizedEmail, role, row: index + 2 }); else staff.push({ name, email: normalizedEmail, role, row: index + 2 });
    }
    duplicate((role === "teacher" ? teachers : staff).map((item) => item.email), file, "メールアドレス", errors);
  }
  if (input.kind === "subjects") {
    for (const [index, row] of parseCsv(file, input.csv, importHeaders.subjects, errors).entries()) {
      const [course, name, teacherName] = row.map(trim);
      if (!name || !teacherName || !["システムエンジニア", "Webデザイナー", "共通"].includes(course)) errors.push({ file, row: index + 2, field: "入力値", reason: "専攻・科目名・担当講師を確認してください。" });
      subjects.push({ gradeLevel: input.gradeLevel!, course, name, teacherName });
    }
    duplicate(subjects.map((item) => item.name), file, "科目名", errors);
  }
  return { students, teachers, staff, subjects, errors };
};
