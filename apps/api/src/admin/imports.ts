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
type ImportStudent = { studentNumber: string; name: string; kana: string; birthDate: string; gender: string; email: string; phone: string; postalCode: string; address: string; course: string; row: number };
type ImportUser = { name: string; email: string; role: "teacher" | "admin"; row: number };
type ImportSubject = { gradeLevel: 1 | 2 | 3; course: string; name: string; teacherName: string; row: number };
const duplicate = <T>(items: T[], value: (item: T) => string, row: (item: T) => number, file: string, field: string, errors: ImportRowError[]) => {
  const firstRows = new Map<string, number>();
  for (const item of items) {
    const key = value(item);
    if (!key) continue;
    const first = firstRows.get(key);
    if (first === undefined) firstRows.set(key, row(item));
    else errors.push({ file, row: row(item), field, reason: `CSV内で重複しています（最初の記載: ${first}行目）。` });
  }
};
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
  const students: ImportStudent[] = [];
  const teachers: Array<ImportUser & { role: "teacher" }> = [];
  const staff: Array<ImportUser & { role: "admin" }> = [];
  const subjects: ImportSubject[] = [];
  if (input.kind === "students") {
    for (const row of parseCsv(file, input.csv, importHeaders.students, errors)) {
      if (row.length !== importHeaders.students.length) continue;
      const [studentNumber, name, kana, rawAge, rawDate, gender, rawEmail, phone, postalCode, address, course] = row.map(trim); const birthDate = date(rawDate); const age = Number(rawAge); const normalizedEmail = rawEmail.toLowerCase();
      if (!studentNumber) errors.push({ file, row: row.sourceRow, field: "学籍番号", reason: "学籍番号を入力してください。" });
      if (!name) errors.push({ file, row: row.sourceRow, field: "氏名", reason: "氏名を入力してください。" });
      if (!kana) errors.push({ file, row: row.sourceRow, field: "氏名（ひらがな）", reason: "氏名（ひらがな）を入力してください。" });
      if (!Number.isInteger(age) || (birthDate && ageLooksImpossible(age, birthDate))) errors.push({ file, row: row.sourceRow, field: "年齢", reason: "年齢を正しく入力してください。" });
      if (!birthDate) errors.push({ file, row: row.sourceRow, field: "生年月日", reason: "生年月日を正しく入力してください。" });
      if (!["男", "女"].includes(gender)) errors.push({ file, row: row.sourceRow, field: "性別", reason: "性別は「男」または「女」を指定してください。" });
      if (!email(normalizedEmail)) errors.push({ file, row: row.sourceRow, field: "メールアドレス", reason: "メールアドレスを正しく入力してください。" });
      if (!["システムエンジニア", "Webデザイナー"].includes(course)) errors.push({ file, row: row.sourceRow, field: "専攻", reason: "専攻を正しく指定してください。" });
      students.push({ studentNumber, name, kana, birthDate: birthDate ?? "", gender, email: normalizedEmail, phone, postalCode, address, course, row: row.sourceRow });
    }
    duplicate(students, (item) => item.studentNumber, (item) => item.row, file, "学籍番号", errors); duplicate(students, (item) => item.email, (item) => item.row, file, "メールアドレス", errors);
  }
  if (input.kind === "teachers" || input.kind === "staff") {
    const role = input.kind === "teachers" ? "teacher" as const : "admin" as const;
    for (const row of parseCsv(file, input.csv, importHeaders.users, errors)) {
      if (row.length !== importHeaders.users.length) continue;
      const [name, kana, rawAge, gender, rawEmail] = row.map(trim); const age = Number(rawAge); const normalizedEmail = rawEmail.toLowerCase();
      if (!name) errors.push({ file, row: row.sourceRow, field: "氏名", reason: "氏名を入力してください。" });
      if (!kana) errors.push({ file, row: row.sourceRow, field: "氏名（ひらがな）", reason: "氏名（ひらがな）を入力してください。" });
      if (!Number.isInteger(age) || age < 18 || age > 120) errors.push({ file, row: row.sourceRow, field: "年齢", reason: "年齢は18歳から120歳の範囲で入力してください。" });
      if (!["男", "女"].includes(gender)) errors.push({ file, row: row.sourceRow, field: "性別", reason: "性別は「男」または「女」を指定してください。" });
      if (!email(normalizedEmail)) errors.push({ file, row: row.sourceRow, field: "メールアドレス", reason: "メールアドレスを正しく入力してください。" });
      if (role === "teacher") teachers.push({ name, email: normalizedEmail, role, row: row.sourceRow }); else staff.push({ name, email: normalizedEmail, role, row: row.sourceRow });
    }
    const accounts: ImportUser[] = role === "teacher" ? teachers : staff;
    duplicate(accounts, (item) => item.email, (item) => item.row, file, "メールアドレス", errors);
  }
  if (input.kind === "subjects") {
    for (const row of parseCsv(file, input.csv, importHeaders.subjects, errors)) {
      if (row.length !== importHeaders.subjects.length) continue;
      const [course, name, teacherName] = row.map(trim);
      if (!["システムエンジニア", "Webデザイナー", "共通"].includes(course)) errors.push({ file, row: row.sourceRow, field: "専攻", reason: "専攻を正しく指定してください。" });
      if (!name) errors.push({ file, row: row.sourceRow, field: "科目名", reason: "科目名を入力してください。" });
      if (!teacherName) errors.push({ file, row: row.sourceRow, field: "担当講師", reason: "担当講師を入力してください。" });
      subjects.push({ gradeLevel: input.gradeLevel!, course, name, teacherName, row: row.sourceRow });
    }
    duplicate(subjects, (item) => item.name, (item) => item.row, file, "科目名", errors);
  }
  return { students, teachers, staff, subjects, errors };
};
