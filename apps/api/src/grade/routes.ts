import { Hono, type Context } from "hono";
import { validator } from "hono/validator";

import { requireAuthenticatedUser, requirePasswordChanged, requireRole, type AuthVariables, type SessionReader } from "../authorization";
import { GradeDomainError, type AdminGradeQuery, type GradeService, type GradeWrite } from "./service";
import type { GradeInputs, GradeWeights } from "./calculation";

const invalid = (code: string, message: string) => new GradeDomainError(code, message);
const parseTerm = (value: string | undefined): 1 | 2 => {
  if (value === "1") return 1;
  if (value === "2") return 2;
  throw invalid("INVALID_TERM", "学期は1または2を指定してください。");
};
const parseYear = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (!/^[0-9]{4}$/.test(value)) throw invalid("INVALID_ACADEMIC_YEAR", "年度を正しく指定してください。");
  return Number(value);
};
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableInteger = (value: unknown, field: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalid("INVALID_GRADE_INPUT", `${field}は整数またはnullで入力してください。`);
  return value;
};
const gradeWrite = (value: unknown): GradeWrite => {
  const body = record(value);
  if (!body || typeof body.studentId !== "string" || !body.studentId.trim()) throw invalid("INVALID_STUDENT_ID", "学生を正しく指定してください。");
  return {
    studentId: body.studentId,
    attendanceRate: nullableInteger(body.attendanceRate, "出席率"),
    attitude: nullableInteger(body.attitude, "平常点"),
    assignment: nullableInteger(body.assignment, "課題点"),
  };
};
const gradeInputs = (value: unknown): GradeInputs => {
  const body = record(value); if (!body) throw invalid("INVALID_GRADE_INPUT", "成績を正しく入力してください。");
  return { attendanceRate: nullableInteger(body.attendanceRate, "出席率"), attitude: nullableInteger(body.attitude, "平常点"), assignment: nullableInteger(body.assignment, "課題点") };
};
const gradeWrites = (value: unknown): GradeWrite[] => {
  const body = record(value);
  if (!body || !Array.isArray(body.grades)) throw invalid("INVALID_GRADES", "grades配列を指定してください。");
  return body.grades.map(gradeWrite);
};
const gradeWeights = (value: unknown): GradeWeights => {
  const body = record(value);
  if (!body) throw invalid("INVALID_WEIGHTS", "評価比重を指定してください。");
  const weight = (name: "attendanceWeight" | "attitudeWeight" | "assignmentWeight") => {
    if (typeof body[name] !== "number" || !Number.isInteger(body[name])) throw invalid("INVALID_WEIGHTS", "評価比重は整数で入力してください。");
    return body[name];
  };
  return { attendanceWeight: weight("attendanceWeight"), attitudeWeight: weight("attitudeWeight"), assignmentWeight: weight("assignmentWeight") };
};
const reopenReason = (value: unknown) => {
  const body = record(value);
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) throw invalid("REOPEN_REASON_REQUIRED", "再開理由を入力してください。");
  return body.reason;
};

const validationError = (c: Context, error: unknown) => {
  const domain = error instanceof GradeDomainError ? error : invalid("INVALID_REQUEST", "リクエストを確認してください。");
  return c.json({ error: { code: domain.code, message: domain.message } }, 400);
};

const yearQuery = validator("query", (value, c): { year?: string } | Response => {
  try {
    if (Array.isArray(value.year)) throw invalid("INVALID_ACADEMIC_YEAR", "年度を正しく指定してください。");
    parseYear(value.year);
    return { year: value.year };
  }
  catch (error) { return validationError(c, error); }
});
const termQuery = validator("query", (value, c): { term: string; year?: string } | Response => {
  try {
    if (Array.isArray(value.term) || Array.isArray(value.year)) throw invalid("INVALID_TERM", "学期または年度を正しく指定してください。");
    parseTerm(value.term); parseYear(value.year);
    return { term: value.term, year: value.year };
  }
  catch (error) { return validationError(c, error); }
});
const subjectParam = validator("param", (value, c) => {
  if (!value.id) return validationError(c, invalid("INVALID_SUBJECT_ID", "科目を正しく指定してください。"));
  return { id: value.id };
});
const subjectTermParam = validator("param", (value, c) => {
  try {
    if (!value.id) throw invalid("INVALID_SUBJECT_ID", "科目を正しく指定してください。");
    parseTerm(value.term);
    return { id: value.id, term: value.term };
  } catch (error) { return validationError(c, error); }
});
const gradesJson = validator("json", (value, c) => {
  try { return { grades: gradeWrites(value) }; }
  catch (error) { return validationError(c, error); }
});
const weightsJson = validator("json", (value, c) => {
  try { return gradeWeights(value); }
  catch (error) { return validationError(c, error); }
});
const reopenJson = validator("json", (value, c) => {
  try { return { reason: reopenReason(value) }; }
  catch (error) { return validationError(c, error); }
});
const adminGradeQuery = validator("query", (value, c): AdminGradeQuery | Response => { try {
  const one = (name: string) => { const raw = value[name]; if (Array.isArray(raw)) throw invalid("INVALID_GRADE_QUERY", "検索条件を正しく指定してください。"); return raw; };
  const year = one("academicYear"); const term = one("term"); const gradeLevel = one("gradeLevel"); const limit = one("limit"); const letter = one("letterGrade");
  if (year !== undefined) parseYear(year); if (term !== undefined) parseTerm(term); if (gradeLevel !== undefined && !["1", "2", "3"].includes(gradeLevel)) throw invalid("INVALID_GRADE_QUERY", "検索条件を正しく指定してください。"); if (letter !== undefined && !["S", "A", "B", "C", "F"].includes(letter)) throw invalid("INVALID_GRADE_QUERY", "検索条件を正しく指定してください。");
  const parsedLimit = limit === undefined ? 50 : Number(limit); if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw invalid("INVALID_GRADE_QUERY", "検索条件を正しく指定してください。");
  return { academicYear: year === undefined ? undefined : Number(year), term: term === undefined ? undefined : parseTerm(term), gradeLevel: gradeLevel === undefined ? undefined : Number(gradeLevel) as 1 | 2 | 3, courseId: one("courseId"), subjectId: one("subjectId"), studentSearch: one("studentSearch"), letterGrade: letter as AdminGradeQuery["letterGrade"], limit: parsedLimit };
} catch (error) { return validationError(c, error); } });
const reasonAndGradeJson = validator("json", (value, c) => { try { const body = record(value); if (!body || typeof body.reason !== "string" || !body.reason.trim()) throw invalid("CORRECTION_REASON_REQUIRED", "理由を入力してください。"); return { ...gradeInputs(body), reason: body.reason.trim() }; } catch (error) { return validationError(c, error); } });

const serviceError = (context: Context, error: unknown) => {
  if (error instanceof GradeDomainError) {
    const body = { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } };
    switch (error.status) {
      case 400: return context.json(body, 400);
      case 403: return context.json(body, 403);
      case 404: return context.json(body, 404);
      case 409: return context.json(body, 409);
      case 503: return context.json(body, 503);
      default: return context.json(body, 500);
    }
  }
  console.error(JSON.stringify({ event: "grade_api_error", error: String(error) }));
  return context.json({ error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。" } }, 500);
};

const guarded = (readSession: SessionReader, role: "admin" | "teacher") => [requireAuthenticatedUser(readSession), requirePasswordChanged, requireRole(role)] as const;
type TeacherSubjectsResult = Awaited<ReturnType<GradeService["teacherSubjects"]>>;
type TeacherGradesResult = Awaited<ReturnType<GradeService["teacherGrades"]>>;
type SavedGradesResult = Awaited<ReturnType<GradeService["saveTeacherGrades"]>>;
type SavedWeightsResult = Awaited<ReturnType<GradeService["saveTeacherWeights"]>>;
type AdminSubjectsResult = Awaited<ReturnType<GradeService["adminSubjects"]>>;
type FinalizeResult = Awaited<ReturnType<GradeService["finalize"]>>;
type ReopenResult = Awaited<ReturnType<GradeService["reopen"]>>;
type AdminGradesResult = Awaited<ReturnType<GradeService["adminGrades"]>>;
type AdminGradeDetailResult = Awaited<ReturnType<GradeService["adminGradeDetail"]>>;
type GradeCorrectionResult = Awaited<ReturnType<GradeService["correctAdminGrade"]>>;
type RetakeResult = Awaited<ReturnType<GradeService["createRetake"]>>;

export const createGradeRoutes = (service: GradeService, readSession: SessionReader) =>
  new Hono<{ Variables: AuthVariables }>()
  .get("/teacher/subjects", ...guarded(readSession, "teacher"), yearQuery, async (c) => {
    try { return c.json<TeacherSubjectsResult, 200>(await service.teacherSubjects(c.get("authUser").id, parseYear(c.req.valid("query").year)), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .get("/teacher/subjects/:id/grades", ...guarded(readSession, "teacher"), subjectParam, termQuery, async (c) => {
    const param = c.req.valid("param");
    const query = c.req.valid("query");
    try { return c.json<TeacherGradesResult, 200>(await service.teacherGrades(c.get("authUser").id, param.id, parseTerm(query.term), parseYear(query.year)), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .put("/teacher/subjects/:id/grades", ...guarded(readSession, "teacher"), subjectParam, termQuery, gradesJson, async (c) => {
    const param = c.req.valid("param");
    const query = c.req.valid("query");
    try { return c.json<SavedGradesResult, 200>(await service.saveTeacherGrades(c.get("authUser").id, param.id, parseTerm(query.term), c.req.valid("json").grades), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .put("/teacher/subjects/:id/weights", ...guarded(readSession, "teacher"), subjectParam, termQuery, weightsJson, async (c) => {
    const param = c.req.valid("param");
    const query = c.req.valid("query");
    try { return c.json<SavedWeightsResult, 200>(await service.saveTeacherWeights(c.get("authUser").id, param.id, parseTerm(query.term), c.req.valid("json")), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .get("/admin/subjects", ...guarded(readSession, "admin"), yearQuery, async (c) => {
    try { return c.json<AdminSubjectsResult, 200>(await service.adminSubjects(parseYear(c.req.valid("query").year)), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .get("/admin/grades", ...guarded(readSession, "admin"), adminGradeQuery, async (c) => {
    try { return c.json<AdminGradesResult, 200>(await service.adminGrades(c.req.valid("query")), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .get("/admin/grades/:id", ...guarded(readSession, "admin"), subjectParam, async (c) => {
    try { return c.json<AdminGradeDetailResult, 200>(await service.adminGradeDetail(c.req.valid("param").id), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .put("/admin/grades/:id/correction", ...guarded(readSession, "admin"), subjectParam, reasonAndGradeJson, async (c) => {
    try { const body = c.req.valid("json"); return c.json<GradeCorrectionResult, 200>(await service.correctAdminGrade(c.get("authUser").id, c.req.valid("param").id, body, body.reason), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .post("/admin/grades/:id/retake", ...guarded(readSession, "admin"), subjectParam, reasonAndGradeJson, async (c) => {
    try { const body = c.req.valid("json"); return c.json<RetakeResult, 201>(await service.createRetake(c.get("authUser").id, c.req.valid("param").id, body, body.reason), 201); }
    catch (error) { return serviceError(c, error); }
  })
  .post("/admin/subjects/:id/terms/:term/finalize", ...guarded(readSession, "admin"), subjectTermParam, async (c) => {
    const param = c.req.valid("param");
    try { return c.json<FinalizeResult, 200>(await service.finalize(c.get("authUser").id, param.id, parseTerm(param.term)), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .post("/admin/subjects/:id/terms/:term/reopen", ...guarded(readSession, "admin"), subjectTermParam, reopenJson, async (c) => {
    const param = c.req.valid("param");
    try { return c.json<ReopenResult, 200>(await service.reopen(c.get("authUser").id, param.id, parseTerm(param.term), c.req.valid("json").reason), 200); }
    catch (error) { return serviceError(c, error); }
  })
  .onError((error, c) => {
    if (error instanceof SyntaxError || error.message === "Malformed JSON in request body") {
      return c.json({ error: { code: "INVALID_JSON", message: "JSONの形式が正しくありません。" } }, 400);
    }
    console.error(JSON.stringify({ event: "grade_api_unhandled_error", error: String(error) }));
    return c.json({ error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。" } }, 500);
  });
