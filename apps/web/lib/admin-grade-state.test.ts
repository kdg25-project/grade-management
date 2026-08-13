import { describe, expect, it } from "bun:test";
import { adminGradeDraftFromAttempt, adminGradePayload, isAdminGradeDirty } from "./admin-grade-state";

describe("admin grade editor state", () => {
  it("keeps a required reason separate from numeric grade inputs", () => {
    const initial = adminGradeDraftFromAttempt({ attendanceRate: 50, attitude: 0, assignment: 0 });
    expect(isAdminGradeDirty(initial, initial)).toBeFalse();
    expect(adminGradePayload({ ...initial, attendanceRate: "70", reason: "再試験許可" })).toEqual({ attendanceRate: 70, attitude: 0, assignment: 0, reason: "再試験許可" });
    expect(adminGradePayload({ ...initial, reason: "" })).toBeNull();
  });
});
