import { Hono } from "hono";
import { validator } from "hono/validator";

import { requireAuthenticatedUser, requirePasswordChanged, requireRole, type AuthVariables, type SessionReader } from "../authorization";
import { respondAdminRouteError } from "./route-errors";
import { AdminDomainError, type AccountStatus, type AdminMasterService, type StudentInput, type StudentStatus, type SubjectInput, validateGradeLevel, validateStudent, validateSubject, validateYear } from "./service";

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const fail = (c: Parameters<typeof respondAdminRouteError>[0], error: unknown) => respondAdminRouteError(c, error, "master");
const parseIntValue = (value: unknown, code: string, message: string) => { if (typeof value !== "number" || !Number.isInteger(value)) throw new AdminDomainError(code, message); return value; };
const string = (value: unknown, code: string, message: string) => { if (typeof value !== "string") throw new AdminDomainError(code, message); return value; };
const optionalString = (value: unknown, code: string, message: string) => value === undefined || value === null ? null : string(value, code, message);
const queryOne = (value: string | string[] | undefined, code: string, message: string) => { if (Array.isArray(value)) throw new AdminDomainError(code, message); return value; };
const studentStatus = (value: unknown): StudentStatus => { const status = string(value, "INVALID_STUDENT_STATUS", "在籍状態を正しく指定してください。"); if (!["enrolled", "suspended", "withdrawn", "graduated"].includes(status)) throw new AdminDomainError("INVALID_STUDENT_STATUS", "在籍状態を正しく指定してください。"); return status as StudentStatus; };
const accountStatus = (value: unknown): AccountStatus => { const status = string(value, "INVALID_TEACHER_STATUS", "講師の状態を正しく指定してください。"); if (!["active", "leave", "retired"].includes(status)) throw new AdminDomainError("INVALID_TEACHER_STATUS", "講師の状態を正しく指定してください。"); return status as AccountStatus; };
const studentInput = (value: unknown): StudentInput => {
  const body = record(value); if (!body) throw new AdminDomainError("INVALID_STUDENT", "学生情報を正しく入力してください。");
  return validateStudent({ studentNumber: string(body.studentNumber, "INVALID_STUDENT_NUMBER", "学籍番号を正しく入力してください。"), name: string(body.name, "INVALID_STUDENT", "氏名を入力してください。"), nameKana: string(body.nameKana, "INVALID_STUDENT", "氏名カナを入力してください。"), birthDate: string(body.birthDate, "INVALID_BIRTH_DATE", "生年月日を入力してください。"), gender: string(body.gender, "INVALID_STUDENT", "性別を入力してください。"), email: optionalString(body.email, "INVALID_STUDENT", "メールアドレスを正しく入力してください。"), phone: optionalString(body.phone, "INVALID_STUDENT", "電話番号を正しく入力してください。"), postalCode: optionalString(body.postalCode, "INVALID_STUDENT", "郵便番号を正しく入力してください。"), address: optionalString(body.address, "INVALID_STUDENT", "住所を正しく入力してください。"), courseId: string(body.courseId, "INVALID_STUDENT", "コースを指定してください。"), enrollmentYear: parseIntValue(body.enrollmentYear, "INVALID_ACADEMIC_YEAR", "入学年度を正しく指定してください。") });
};
const subjectInput = (value: unknown): SubjectInput => {
  const body = record(value); if (!body || !Array.isArray(body.courseIds)) throw new AdminDomainError("INVALID_SUBJECT", "科目情報を正しく入力してください。");
  return validateSubject({ name: string(body.name, "INVALID_SUBJECT", "科目名を入力してください。"), gradeLevel: parseIntValue(body.gradeLevel, "INVALID_GRADE_LEVEL", "学年を正しく指定してください。") as 1 | 2 | 3, teacherUserId: string(body.teacherUserId, "INVALID_TEACHER", "担当講師を指定してください。"), courseIds: body.courseIds.map((id) => string(id, "INVALID_COURSES", "コースを正しく指定してください。")), academicYear: body.academicYear === undefined ? undefined : parseIntValue(body.academicYear, "INVALID_ACADEMIC_YEAR", "年度を正しく指定してください。") });
};
const guarded = (reader: SessionReader) => [requireAuthenticatedUser(reader), requirePasswordChanged, requireRole("admin")] as const;
const idParam = validator("param", (value, c): { id: string } | Response => value.id ? { id: value.id } : fail(c, new AdminDomainError("INVALID_ID", "IDを正しく指定してください。")));
const yearsJson = validator("json", (value, c) => { try { const body = record(value); return { year: validateYear(parseIntValue(body?.year, "INVALID_ACADEMIC_YEAR", "年度を正しく指定してください。")) }; } catch (error) { return fail(c, error); } });
const studentJson = validator("json", (value, c) => { try { return studentInput(value); } catch (error) { return fail(c, error); } });
const statusJson = validator("json", (value, c) => { try { const body = record(value); const reason = string(body?.reason, "INVALID_STATUS_CHANGE", "変更理由を入力してください。").trim(); if (!reason) throw new AdminDomainError("INVALID_STATUS_CHANGE", "変更理由を入力してください。"); return { status: studentStatus(body?.status), effectiveAcademicYear: validateYear(parseIntValue(body?.effectiveAcademicYear, "INVALID_ACADEMIC_YEAR", "適用年度を正しく指定してください。")), reason }; } catch (error) { return fail(c, error); } });
const teacherJson = validator("json", (value, c) => { try { const body = record(value); return { name: string(body?.name, "INVALID_TEACHER", "講師名を入力してください。"), email: string(body?.email, "INVALID_TEACHER", "メールアドレスを入力してください。") }; } catch (error) { return fail(c, error); } });
const staffJson = validator("json", (value, c) => { try { const body = record(value); return { name: string(body?.name, "INVALID_STAFF", "専任職員名を入力してください。"), email: string(body?.email, "INVALID_STAFF", "メールアドレスを入力してください。") }; } catch (error) { return fail(c, error); } });
const teacherStatusJson = validator("json", (value, c) => { try { return { status: accountStatus(record(value)?.status) }; } catch (error) { return fail(c, error); } });
const staffStatusJson = validator("json", (value, c) => { try { const status = string(record(value)?.status, "INVALID_STAFF_STATUS", "専任職員の状態を正しく指定してください。"); if (!(["active", "leave", "retired"] as const).includes(status as AccountStatus)) throw new AdminDomainError("INVALID_STAFF_STATUS", "専任職員の状態を正しく指定してください。"); return { status: status as AccountStatus }; } catch (error) { return fail(c, error); } });
const subjectJson = validator("json", (value, c) => { try { return subjectInput(value); } catch (error) { return fail(c, error); } });

const listQuery = validator("query", (value, c) => { try {
  const number = (name: string, fallback?: number) => { const raw = queryOne(value[name], "INVALID_QUERY", "検索条件を正しく指定してください。"); if (raw === undefined) return fallback; if (!/^\d+$/.test(raw)) throw new AdminDomainError("INVALID_QUERY", "検索条件を正しく指定してください。"); return Number(raw); };
  const status = queryOne(value.status, "INVALID_QUERY", "検索条件を正しく指定してください。"); if (status !== undefined && !["enrolled", "suspended", "withdrawn", "graduated"].includes(status)) throw new AdminDomainError("INVALID_STUDENT_STATUS", "在籍状態を正しく指定してください。");
  const academicYear = number("academicYear");
  const gradeLevel = number("gradeLevel");
  return { page: number("page", 1)!, pageSize: number("pageSize", 20)!, academicYear: academicYear === undefined ? undefined : validateYear(academicYear), search: queryOne(value.search, "INVALID_QUERY", "検索条件を正しく指定してください。"), courseId: queryOne(value.courseId, "INVALID_QUERY", "検索条件を正しく指定してください。"), enrollmentYear: number("enrollmentYear"), gradeLevel: gradeLevel === undefined ? undefined : validateGradeLevel(gradeLevel), status: status as StudentStatus | undefined };
} catch (error) { return fail(c, error); } });

const teachersQuery = validator("query", (value, c) => { try { const status = queryOne(value.status, "INVALID_QUERY", "検索条件を正しく指定してください。"); if (status !== undefined && !["active", "leave", "retired"].includes(status)) throw new AdminDomainError("INVALID_TEACHER_STATUS", "講師の状態を正しく指定してください。"); return { search: queryOne(value.search, "INVALID_QUERY", "検索条件を正しく指定してください。"), status: status as AccountStatus | undefined }; } catch (error) { return fail(c, error); } });
const staffQuery = validator("query", (value, c) => { try { const status = queryOne(value.status, "INVALID_QUERY", "検索条件を正しく指定してください。"); if (status !== undefined && !["active", "leave", "retired"].includes(status)) throw new AdminDomainError("INVALID_STAFF_STATUS", "専任職員の状態を正しく指定してください。"); return { search: queryOne(value.search, "INVALID_QUERY", "検索条件を正しく指定してください。"), status: status as AccountStatus | undefined }; } catch (error) { return fail(c, error); } });
const yearQuery = validator("query", (value, c) => { try { const raw = queryOne(value.year, "INVALID_ACADEMIC_YEAR", "年度を正しく指定してください。"); return { year: raw === undefined ? undefined : validateYear(Number(raw)) }; } catch (error) { return fail(c, error); } });

export const createAdminMasterRoutes = (service: AdminMasterService, reader: SessionReader) => new Hono<{ Variables: AuthVariables }>()
  .get("/admin/years", ...guarded(reader), async (c) => { try { return c.json(await service.years(), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/years/current", ...guarded(reader), yearsJson, async (c) => { try { return c.json(await service.selectCurrentYear(c.get("authUser").id, c.req.valid("json").year), 200); } catch (error) { return fail(c, error); } })
  .get("/admin/students", ...guarded(reader), listQuery, async (c) => { try { return c.json(await service.students(c.req.valid("query")), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/students", ...guarded(reader), studentJson, async (c) => { try { return c.json(await service.createStudent(c.get("authUser").id, c.req.valid("json")), 201); } catch (error) { return fail(c, error); } })
  .put("/admin/students/:id", ...guarded(reader), idParam, studentJson, async (c) => { try { return c.json(await service.updateStudent(c.get("authUser").id, c.req.valid("param").id, c.req.valid("json")), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/students/:id/status", ...guarded(reader), idParam, statusJson, async (c) => { try { const body = c.req.valid("json"); return c.json(await service.changeStudentStatus(c.get("authUser").id, c.req.valid("param").id, body.status, body.effectiveAcademicYear, body.reason), 200); } catch (error) { return fail(c, error); } })
  .get("/admin/teachers", ...guarded(reader), teachersQuery, async (c) => { try { return c.json(await service.teachers(c.req.valid("query")), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/teachers", ...guarded(reader), teacherJson, async (c) => { try { return c.json(await service.createTeacher(c.get("authUser").id, c.req.valid("json")), 201); } catch (error) { return fail(c, error); } })
  .post("/admin/teachers/:id/status", ...guarded(reader), idParam, teacherStatusJson, async (c) => { try { return c.json(await service.changeTeacherStatus(c.get("authUser").id, c.req.valid("param").id, c.req.valid("json").status), 200); } catch (error) { return fail(c, error); } })
  .get("/admin/staff", ...guarded(reader), staffQuery, async (c) => { try { return c.json(await service.staff(c.req.valid("query")), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/staff", ...guarded(reader), staffJson, async (c) => { try { return c.json(await service.createStaff(c.get("authUser").id, c.req.valid("json")), 201); } catch (error) { return fail(c, error); } })
  .post("/admin/staff/:id/status", ...guarded(reader), idParam, staffStatusJson, async (c) => { try { return c.json(await service.changeStaffStatus(c.get("authUser").id, c.req.valid("param").id, c.req.valid("json").status), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/accounts/:id/password-reset", ...guarded(reader), idParam, async (c) => { try { return c.json(await service.requestAccountPasswordReset(c.get("authUser").id, c.req.valid("param").id), 202); } catch (error) { return fail(c, error); } })
  .get("/admin/catalog", ...guarded(reader), async (c) => { try { return c.json(await service.catalog(), 200); } catch (error) { return fail(c, error); } })
  .get("/admin/master/subjects", ...guarded(reader), yearQuery, async (c) => { try { return c.json(await service.subjects(c.req.valid("query").year), 200); } catch (error) { return fail(c, error); } })
  .post("/admin/master/subjects", ...guarded(reader), subjectJson, async (c) => { try { return c.json(await service.createSubject(c.get("authUser").id, c.req.valid("json")), 201); } catch (error) { return fail(c, error); } })
  .put("/admin/master/subjects/:id", ...guarded(reader), idParam, subjectJson, async (c) => { try { return c.json(await service.updateSubject(c.get("authUser").id, c.req.valid("param").id, c.req.valid("json")), 200); } catch (error) { return fail(c, error); } })
  .onError((error, c) => {
    if (error instanceof SyntaxError || error.message === "Malformed JSON in request body") return c.json({ error: { code: "INVALID_JSON", message: "JSONの形式が正しくありません。" } }, 400);
    return fail(c, error);
  });
