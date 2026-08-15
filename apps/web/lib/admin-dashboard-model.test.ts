import { describe, expect, test } from "bun:test";

import { emptyDashboardActions } from "./admin-dashboard-model";

describe("empty admin dashboard", () => {
  test("offers direct subject registration and CSV import actions", () => {
    expect(emptyDashboardActions).toEqual([
      { label: "科目を登録する", to: "/admin/subjects", tone: "primary" },
      { label: "CSVでまとめて取込", to: "/admin/imports", tone: "secondary" },
    ]);
  });
});
