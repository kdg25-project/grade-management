import { describe, expect, it } from "bun:test";

import { createApp, type AppDependencies } from "../app";
import type { AuthSession } from "../authorization";
import { GradeDomainError, type GradeService } from "./service";

const session = (role: "teacher" | "admin"): AuthSession => ({
  session: { id: "session", token: "token", expiresAt: new Date("2026-08-12T00:00:00.000Z") },
  user: { id: `${role}-1`, role, status: "active", mustChangePassword: false },
});

const service = (): GradeService => ({
  teacherSubjects: async (teacherUserId, year) => ({ currentAcademicYear: 2026, subjects: [{ id: "subject-1", name: teacherUserId, academicYear: year ?? 2026, gradeLevel: 1, editable: year === undefined, editableTerm: year === undefined ? 1 : null, termStatuses: [{ term: 1, isFinalized: false }, { term: 2, isFinalized: false }] }] }),
  teacherGrades: async (_teacherUserId, _subjectId, _term, year) => ({ academicYear: year ?? 2026, editable: year === undefined, students: [], weights: null, isFinalized: false }),
  saveTeacherGrades: async (_teacherUserId, _subjectId, _term, grades) => ({ saved: grades.length }),
  saveTeacherWeights: async (_teacherUserId, _subjectId, _term, weights) => weights,
  adminSubjects: async () => ({ currentAcademicYear: 2026, subjects: [] }),
  finalize: async () => ({ finalized: true, alreadyFinalized: false, eligibleStudents: 0 }),
  reopen: async () => ({ reopened: true }),
  adminGrades: async () => ({ academicYear: 2026, items: [] }),
  adminGradeDetail: async () => ({ id: "grade-1", studentId: "student-1", studentNumber: "1", studentName: "学生", subjectId: "subject-1", subjectName: "科目", academicYear: 2026, term: 1, attempts: [] }),
  correctAdminGrade: async () => ({ id: "grade-1", letterGrade: "A" }),
  createRetake: async () => ({ id: "grade-2", attempt: 2, letterGrade: "C" }),
});

const app = (auth: AuthSession | null) => createApp({
  authHandler: () => new Response(null, { status: 500 }),
  readSession: async () => auth,
  gradeService: service(),
} satisfies AppDependencies);

describe("grade routes", () => {
  it("returns a teacher's own current subjects", async () => {
    const response = await app(session("teacher")).request("/api/teacher/subjects");
    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toMatchObject({ currentAcademicYear: 2026, subjects: [{ name: "teacher-1", editableTerm: 1 }] });
  });

  it("allows a teacher to read a historical subject detail as read-only", async () => {
    const response = await app(session("teacher")).request("/api/teacher/subjects/subject-2023/grades?term=1&year=2023");
    expect(response.status).toBe(200);
    expect(await response.json<unknown>()).toMatchObject({ academicYear: 2023, editable: false });
  });

  it("returns the current term with a stable conflict for a direct current-year wrong-term URL", async () => {
    const dependencies: AppDependencies = {
      authHandler: () => new Response(null, { status: 500 }), readSession: async () => session("teacher"),
      gradeService: { ...service(), teacherGrades: async () => { throw new GradeDomainError("TERM_NOT_CURRENTLY_EDITABLE", "現在入力する学期ではありません。", 409, { currentTerm: 2 }); } },
    };
    const response = await createApp(dependencies).request("/api/teacher/subjects/subject-1/grades?term=1");
    expect(response.status).toBe(409);
    expect(await response.json<unknown>()).toEqual({ error: { code: "TERM_NOT_CURRENTLY_EDITABLE", message: "現在入力する学期ではありません。", details: { currentTerm: 2 } } });
  });

  it("enforces role before invoking admin operations", async () => {
    const response = await app(session("teacher")).request("/api/admin/subjects");
    expect(response.status).toBe(403);
    expect(await response.json<unknown>()).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("provides bounded admin grade search only to administrators", async () => {
    expect((await app(session("teacher")).request("/api/admin/grades?limit=10")).status).toBe(403);
    const response = await app(session("admin")).request("/api/admin/grades?limit=10&letterGrade=F");
    expect(response.status).toBe(200);
    const invalid = await app(session("admin")).request("/api/admin/grades?limit=101");
    expect(invalid.status).toBe(400);
  });

  it("rejects untrusted grade shapes before invoking the service", async () => {
    const response = await app(session("teacher")).request("/api/teacher/subjects/subject-1/grades?term=1", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ grades: [{ studentId: "student-1", attendanceRate: 60.5, attitude: 3, assignment: 4 }] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json<unknown>()).toEqual({ error: { code: "INVALID_GRADE_INPUT", message: "出席率は整数またはnullで入力してください。" } });
  });

  it("requires a non-empty reason to reopen", async () => {
    const response = await app(session("admin")).request("/api/admin/subjects/subject-1/terms/1/reopen", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json<unknown>()).toEqual({ error: { code: "REOPEN_REASON_REQUIRED", message: "再開理由を入力してください。" } });
  });

  it("returns a stable client error for malformed JSON", async () => {
    const response = await app(session("teacher")).request("/api/teacher/subjects/subject-1/grades?term=1", {
      method: "PUT", headers: { "content-type": "application/json" }, body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json<unknown>()).toEqual({ error: { code: "INVALID_JSON", message: "JSONの形式が正しくありません。" } });
  });
});
