import { describe, expect, it } from "bun:test";

import { adminStudentsRequestQuery } from "./admin-api";

describe("admin student API query", () => {
  it("keeps the selected academic year with all student-list filters", () => {
    expect(adminStudentsRequestQuery({ academicYear: 2026, enrollmentYear: 2026, gradeLevel: 1, search: "山田", page: 2, pageSize: 50 })).toEqual({ page: "2", pageSize: "50", academicYear: 2026, search: "山田", courseId: undefined, enrollmentYear: 2026, gradeLevel: 1, status: undefined });
  });
});
