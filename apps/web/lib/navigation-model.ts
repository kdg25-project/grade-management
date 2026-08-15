export type NavigationItem = {
  readonly icon: "grades" | "search" | "years" | "rollover" | "imports" | "exports" | "students" | "teachers" | "staff" | "subjects" | "audit";
  readonly label: string;
  readonly match: "exact" | "prefix";
  readonly to: string;
};

export type NavigationGroup = {
  readonly label: string;
  readonly items: readonly NavigationItem[];
};

export const adminNavigationGroups: readonly NavigationGroup[] = [
  {
    label: "日常業務",
    items: [
      { icon: "grades", label: "成績確定", match: "exact", to: "/admin" },
      { icon: "search", label: "成績検索・修正", match: "exact", to: "/admin/grades" },
      { icon: "exports", label: "成績出力", match: "exact", to: "/admin/exports" },
    ],
  },
  {
    label: "年度・取込",
    items: [
      { icon: "years", label: "年度管理", match: "exact", to: "/admin/years" },
      { icon: "rollover", label: "年度更新", match: "exact", to: "/admin/rollover" },
      { icon: "imports", label: "通常CSV取込", match: "exact", to: "/admin/imports" },
    ],
  },
  {
    label: "マスタ管理",
    items: [
      { icon: "students", label: "学生管理", match: "exact", to: "/admin/students" },
      { icon: "teachers", label: "講師管理", match: "exact", to: "/admin/teachers" },
      { icon: "staff", label: "専任職員管理", match: "exact", to: "/admin/staff" },
      { icon: "subjects", label: "科目管理", match: "exact", to: "/admin/subjects" },
    ],
  },
  {
    label: "運用",
    items: [{ icon: "audit", label: "監査履歴", match: "exact", to: "/admin/audit" }],
  },
];

export const teacherNavigationGroups: readonly NavigationGroup[] = [
  {
    label: "担当業務",
    items: [{ icon: "subjects", label: "担当科目", match: "prefix", to: "/teacher/subjects" }],
  },
];

const normalizePathname = (pathname: string) => {
  const path = pathname.split(/[?#]/u, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/u, "") : path;
};

export const isNavigationCurrent = (pathname: string, destination: string, match: NavigationItem["match"]) => {
  const current = normalizePathname(pathname);
  const target = normalizePathname(destination);
  return match === "exact" ? current === target : current === target || current.startsWith(`${target}/`);
};
