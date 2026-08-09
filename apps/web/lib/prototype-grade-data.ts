export type GradeInput = {
  attendanceRate: string;
  attitude: string;
  assignment: string;
};

export type StudentGradeRow = {
  studentNumber: string;
  name: string;
  status: "active" | "leave";
  input: GradeInput;
};

export type Subject = {
  id: string;
  name: string;
  className: string;
  year: string;
  term: "前期" | "後期";
  isCurrentEntry: boolean;
  entryStatus: "入力中" | "未開始" | "確認待ち";
  description: string;
};

export const prototypeSubjects: Subject[] = [
  {
    id: "web-design-2",
    name: "WebデザインⅡ",
    className: "デザイン科 2年A組",
    year: "2026年度",
    term: "前期",
    isCurrentEntry: true,
    entryStatus: "入力中",
    description: "現在、成績を入力する科目です。",
  },
  {
    id: "career-design-2",
    name: "キャリアデザインⅡ",
    className: "デザイン科 2年A組",
    year: "2026年度",
    term: "前期",
    isCurrentEntry: false,
    entryStatus: "確認待ち",
    description: "入力内容の確認待ちです。",
  },
  {
    id: "web-design-1",
    name: "WebデザインⅠ",
    className: "デザイン科 1年A組",
    year: "2026年度",
    term: "前期",
    isCurrentEntry: false,
    entryStatus: "未開始",
    description: "まだ入力を始めていません。",
  },
];

export const prototypeGradeRows: StudentGradeRow[] = [
  {
    studentNumber: "D24-001",
    name: "青木 花",
    status: "active",
    input: { attendanceRate: "92", attitude: "8", assignment: "9" },
  },
  {
    studentNumber: "D24-002",
    name: "井上 悠斗",
    status: "active",
    input: { attendanceRate: "", attitude: "7", assignment: "" },
  },
  {
    studentNumber: "D24-003",
    name: "大西 さくら",
    status: "leave",
    input: { attendanceRate: "", attitude: "", assignment: "" },
  },
  {
    studentNumber: "D24-004",
    name: "加藤 陽介",
    status: "active",
    input: { attendanceRate: "88", attitude: "", assignment: "8" },
  },
];

export function isGradeInputInRange(
  field: keyof GradeInput,
  value: string,
): boolean {
  if (value === "" || !isGradeInputFormat(field, value)) return false;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return false;

  return field === "attendanceRate"
    ? numberValue >= 0 && numberValue <= 100
    : numberValue >= 1 && numberValue <= 10;
}

export function isGradeInputFormat(
  field: keyof GradeInput,
  value: string,
): boolean {
  if (value === "") return true;

  return field === "attendanceRate"
    ? /^\d*(?:\.\d*)?$/.test(value)
    : /^\d+$/.test(value);
}

export function getEntryProgress(rows: StudentGradeRow[]): {
  complete: number;
  total: number;
  pending: number;
} {
  const editableRows = rows.filter((row) => row.status === "active");
  const complete = editableRows.filter((row) =>
    (Object.keys(row.input) as Array<keyof GradeInput>).every((field) =>
      isGradeInputInRange(field, row.input[field]),
    ),
  ).length;

  return {
    complete,
    total: editableRows.length,
    pending: editableRows.length - complete,
  };
}
