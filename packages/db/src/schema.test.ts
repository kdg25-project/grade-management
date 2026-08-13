import { describe, expect, it } from "bun:test";
import { getTableColumns } from "drizzle-orm";

import {
  account,
  academicYears,
  auditLogs,
  courses,
  gradeWeights,
  grades,
  idempotencyOperations,
  session,
  studentStatusHistory,
  students,
  subjectCourses,
  subjects,
  subjectTermStatuses,
  user,
  verification,
} from "./schema";

describe("D1 Better Auth schema", () => {
  it("contains the four required tables and protected application fields", () => {
    expect(Object.keys(getTableColumns(user))).toEqual(expect.arrayContaining(["id", "email", "role", "status", "mustChangePassword"]));
    expect(Object.keys(getTableColumns(session))).toEqual(expect.arrayContaining(["token", "expiresAt", "userId"]));
    expect(Object.keys(getTableColumns(account))).toEqual(expect.arrayContaining(["providerId", "password", "userId"]));
    expect(Object.keys(getTableColumns(verification))).toEqual(expect.arrayContaining(["identifier", "value", "expiresAt"]));
  });
});

describe("grade-management schema", () => {
  it("models the school domain without folding it into Better Auth tables", () => {
    expect(Object.keys(getTableColumns(courses))).toEqual(expect.arrayContaining(["id", "name"]));
    expect(Object.keys(getTableColumns(academicYears))).toEqual(expect.arrayContaining(["year", "isCurrent", "selectedByUserId"]));
    expect(Object.keys(getTableColumns(students))).toEqual(
      expect.arrayContaining([
        "studentNumber",
        "courseId",
        "enrollmentYear",
        "status",
        "statusEffectiveAcademicYear",
        "hasFailedHistory",
      ]),
    );
    expect(Object.keys(getTableColumns(studentStatusHistory))).toEqual(
      expect.arrayContaining(["studentId", "status", "effectiveAcademicYear", "changedAt"]),
    );
  });

  it("keeps subject-term controls, grade inputs, audit records, and idempotency separate", () => {
    expect(Object.keys(getTableColumns(subjects))).toEqual(expect.arrayContaining(["academicYear", "gradeLevel", "teacherUserId"]));
    expect(Object.keys(getTableColumns(subjectCourses))).toEqual(expect.arrayContaining(["subjectId", "courseId"]));
    expect(Object.keys(getTableColumns(gradeWeights))).toEqual(
      expect.arrayContaining(["subjectId", "term", "attendanceWeight", "attitudeWeight", "assignmentWeight"]),
    );
    expect(Object.keys(getTableColumns(subjectTermStatuses))).toEqual(
      expect.arrayContaining(["isFinalized", "finalizedByUserId", "reopenedByUserId"]),
    );
    expect(Object.keys(getTableColumns(grades))).toEqual(
      expect.arrayContaining([
        "studentId",
        "academicYear",
        "term",
        "attempt",
        "attendanceRate",
        "attitude",
        "assignment",
        "finalScoreNumerator",
        "finalScoreDenominator",
      ]),
    );
    expect(Object.keys(getTableColumns(auditLogs))).toEqual(expect.arrayContaining(["actorUserId", "action", "entityType"]));
    expect(Object.keys(getTableColumns(idempotencyOperations))).toEqual(
      expect.arrayContaining(["operationType", "idempotencyKey", "payloadHash", "resultJson"]),
    );
  });
});
