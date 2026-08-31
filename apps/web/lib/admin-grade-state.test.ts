import { describe, expect, it } from "bun:test";
import { adminGradeDraftFromAttempt, adminGradePayload, isAdminGradeDirty } from "./admin-grade-state";

describe("admin grade editor state", () => {
  it("keeps a required reason separate from numeric grade inputs", () => {
    const initial = adminGradeDraftFromAttempt({ attendanceRate: 50, attitude: 0, assignment: 0 });
    expect(isAdminGradeDirty(initial, initial)).toBeFalse();
    expect(adminGradePayload({ ...initial, attendanceRate: "70", reason: "再試験許可" })).toBeNull();
    expect(adminGradePayload({ ...initial, attendanceRate: "70", attitude: "1", assignment: "1", reason: "再試験許可" })).toEqual({ attendanceRate: 70, attitude: 1, assignment: 1, reason: "再試験許可" });
    expect(adminGradePayload({ ...initial, reason: "" })).toBeNull();
  });

  it("requires new attitude and assignment corrections to be 1 through 10", () => {
    expect(adminGradePayload({ attendanceRate: "80", attitude: "0", assignment: "10", reason: "修正" })).toBeNull();
    expect(adminGradePayload({ attendanceRate: "80", attitude: "1", assignment: "0", reason: "修正" })).toBeNull();
  });

  it("accepts nullable or boundary attendance rates and rejects values outside 0 through 100", () => {
    expect(adminGradePayload({ attendanceRate: "", attitude: "", assignment: "", reason: "未完成の訂正" })).toEqual({ attendanceRate: null, attitude: null, assignment: null, reason: "未完成の訂正" });
    expect(adminGradePayload({ attendanceRate: "0", attitude: "1", assignment: "1", reason: "下限" })).toEqual({ attendanceRate: 0, attitude: 1, assignment: 1, reason: "下限" });
    expect(adminGradePayload({ attendanceRate: "100", attitude: "10", assignment: "10", reason: "上限" })).toEqual({ attendanceRate: 100, attitude: 10, assignment: 10, reason: "上限" });
    expect(adminGradePayload({ attendanceRate: "-1", attitude: "1", assignment: "1", reason: "範囲外" })).toBeNull();
    expect(adminGradePayload({ attendanceRate: "101", attitude: "1", assignment: "1", reason: "範囲外" })).toBeNull();
  });
});
