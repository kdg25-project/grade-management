import { describe, expect, it } from "bun:test";

import { currentTermRedirect, destinationForApiError, GradeApiError, parseTeacherGradesResponse, type GradesResponse } from "./grade-api";

const validTeacherGrades: GradesResponse = {
  academicYear: 2026,
  editable: true,
  isFinalized: false,
  weights: { attendanceWeight: 100, attitudeWeight: 0, assignmentWeight: 0 },
  students: [
    { id: "student-s", studentNumber: "A-001", name: "S", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 90, attitude: 0, assignment: 0, finalScoreNumerator: 9000, finalScoreDenominator: 100, letterGrade: "S" } },
    { id: "student-a", studentNumber: "A-002", name: "A", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 80, attitude: 0, assignment: 0, finalScoreNumerator: 8000, finalScoreDenominator: 100, letterGrade: "A" } },
    { id: "student-b", studentNumber: "A-003", name: "B", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 70, attitude: 0, assignment: 0, finalScoreNumerator: 7000, finalScoreDenominator: 100, letterGrade: "B" } },
    { id: "student-c", studentNumber: "A-004", name: "C", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 60, attitude: 0, assignment: 0, finalScoreNumerator: 6000, finalScoreDenominator: 100, letterGrade: "C" } },
    { id: "student-f", studentNumber: "A-005", name: "F", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 59, attitude: 0, assignment: 0, finalScoreNumerator: 5900, finalScoreDenominator: 100, letterGrade: "F" } },
    { id: "student-draft", studentNumber: "A-006", name: "下書き", status: "enrolled", editable: true, hasFailedHistory: false, grade: { attempt: 1, attendanceRate: 80, attitude: null, assignment: null, finalScoreNumerator: null, finalScoreDenominator: null, letterGrade: null } },
  ],
};

describe("grade API error routing", () => {
  it("routes authentication failures to the appropriate recovery screen", () => {
    expect(destinationForApiError(new GradeApiError("UNAUTHORIZED", "", 401))).toBe("/login");
    expect(destinationForApiError(new GradeApiError("MUST_CHANGE_PASSWORD", "", 403))).toBe("/change-password");
    expect(destinationForApiError(new GradeApiError("ACCOUNT_INACTIVE", "", 403))).toBe("/account-inactive");
  });

  it("keeps ordinary permission failures in the current screen", () => {
    expect(destinationForApiError(new GradeApiError("FORBIDDEN", "", 403))).toBeNull();
  });

  it("identifies the current-term redirect only from typed conflict details", () => {
    expect(currentTermRedirect(new GradeApiError("TERM_NOT_CURRENTLY_EDITABLE", "", 409, 2))).toBe(2);
    expect(currentTermRedirect(new GradeApiError("TERM_NOT_EDITABLE", "", 409, 1))).toBeUndefined();
  });

  it("accepts API-calculated grade boundaries and incomplete null values", () => {
    expect(parseTeacherGradesResponse(validTeacherGrades)).toEqual(validTeacherGrades);
  });

  it("continues to accept legacy persisted zero values at the response boundary", () => {
    const legacy = { ...validTeacherGrades, students: [{ ...validTeacherGrades.students[0]!, grade: { ...validTeacherGrades.students[0]!.grade!, attitude: 0, assignment: 0 } }] };
    expect(parseTeacherGradesResponse(legacy)).toEqual(legacy);
  });

  it("rejects a successful but domain-invalid grade response before it reaches the editor", () => {
    expect(() => parseTeacherGradesResponse({ ...validTeacherGrades, students: null })).toThrow(GradeApiError);
    expect(() => parseTeacherGradesResponse({ ...validTeacherGrades, students: [{ ...validTeacherGrades.students[0]!, grade: { ...validTeacherGrades.students[0]!.grade!, attendanceRate: 101, finalScoreNumerator: 10_100 } }] })).toThrow(GradeApiError);
    expect(() => parseTeacherGradesResponse({ ...validTeacherGrades, students: [{ ...validTeacherGrades.students[0]!, grade: { ...validTeacherGrades.students[0]!.grade!, finalScoreNumerator: 8_999, letterGrade: "A" } }] })).toThrow(GradeApiError);
    expect(() => parseTeacherGradesResponse({ ...validTeacherGrades, students: [{ ...validTeacherGrades.students[0]!, grade: { ...validTeacherGrades.students[0]!.grade!, attempt: 0 } }] })).toThrow(GradeApiError);
  });
});
