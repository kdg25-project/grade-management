import { describe, expect, test } from "bun:test";

import { adminNavigationGroups, isNavigationCurrent } from "./navigation-model";

describe("admin navigation", () => {
  test("keeps routes in task-oriented groups", () => {
    expect(adminNavigationGroups.map((group) => group.label)).toEqual(["日常業務", "年度・取込", "マスタ管理", "運用"]);
    expect(adminNavigationGroups.flatMap((group) => group.items.map((item) => item.to))).toEqual([
      "/admin", "/admin/grades", "/admin/exports", "/admin/years", "/admin/rollover", "/admin/imports", "/admin/students", "/admin/teachers", "/admin/staff", "/admin/subjects", "/admin/audit",
    ]);
  });

  test("keeps dashboard and admin child routes exact", () => {
    expect(isNavigationCurrent("/admin", "/admin", "exact")).toBe(true);
    expect(isNavigationCurrent("/admin/", "/admin", "exact")).toBe(true);
    expect(isNavigationCurrent("/admin/grades", "/admin", "exact")).toBe(false);
    expect(isNavigationCurrent("/admin/grades?year=2026", "/admin/grades", "exact")).toBe(true);
  });

  test("keeps the teacher subjects route current for nested grade details", () => {
    expect(isNavigationCurrent("/teacher/subjects", "/teacher/subjects", "prefix")).toBe(true);
    expect(isNavigationCurrent("/teacher/subjects/subject-1/grades", "/teacher/subjects", "prefix")).toBe(true);
    expect(isNavigationCurrent("/teacher/subjects/subject-1/grades/?year=2026", "/teacher/subjects", "prefix")).toBe(true);
    expect(isNavigationCurrent("/teacher/subject-settings", "/teacher/subjects", "prefix")).toBe(false);
  });
});
