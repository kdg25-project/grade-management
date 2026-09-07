import { calculateGrade, type GradeInputs, type GradeWeights, GradeValidationError, validateGradeInputs, validateGradeWeights } from "./calculation";
import { ensureCurrentAcademicYear, type Clock } from "../academic-year";
import { createWorkerId } from "../worker-crypto";

export type StudentStatus = "enrolled" | "suspended" | "withdrawn" | "graduated";
export type GradeStudent = {
  id: string;
  studentNumber: string;
  name: string;
  status: StudentStatus;
  editable: boolean;
  hasFailedHistory: boolean;
  grade: {
    attempt: number;
    attendanceRate: number | null;
    attitude: number | null;
    assignment: number | null;
    finalScoreNumerator: number | null;
    finalScoreDenominator: number | null;
    letterGrade: "S" | "A" | "B" | "C" | "F" | null;
  } | null;
};

export type TeacherSubject = {
  id: string;
  name: string;
  academicYear: number;
  gradeLevel: number;
  editable: boolean;
  editableTerm: 1 | 2 | null;
  termStatuses: { term: 1 | 2; isFinalized: boolean }[];
};

export type AdminSubject = TeacherSubject & {
  completion: Record<1 | 2, { complete: number; eligible: number }>;
};

export type GradeWrite = GradeInputs & { studentId: string };
export type AdminGradeQuery = { academicYear?: number; term?: 1 | 2; courseId?: string; gradeLevel?: 1 | 2 | 3; subjectId?: string; studentSearch?: string; letterGrade?: "S" | "A" | "B" | "C" | "F"; limit: number };
export type AdminGradeAttempt = { id: string; attempt: number; attendanceRate: number | null; attitude: number | null; assignment: number | null; finalScoreNumerator: number | null; finalScoreDenominator: number | null; letterGrade: "S" | "A" | "B" | "C" | "F" | null; hasFailedHistory: boolean };
export type AdminGradeDetail = { id: string; studentId: string; studentNumber: string; studentName: string; subjectId: string; subjectName: string; academicYear: number; term: 1 | 2; attempts: AdminGradeAttempt[] };

export class GradeDomainError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 500 | 503 = 400, readonly details?: { currentTerm: 1 | 2 | null }) {
    super(message);
  }
}

const d1Boolean = (value: unknown) => value === true || value === 1;
const asNumber = (value: unknown) => (typeof value === "number" ? value : Number(value));
const asNullableNumber = (value: unknown) => (value === null || value === undefined ? null : asNumber(value));
const asStatus = (value: unknown): StudentStatus => {
  if (value === "enrolled" || value === "suspended" || value === "withdrawn" || value === "graduated") return value;
  throw new Error("Unexpected student status from database");
};

type SqlRow = Record<string, unknown>;

export const editableTermForStatuses = (term1Finalized: boolean, term2Finalized: boolean): 1 | 2 | null => {
  if (!term1Finalized) return 1;
  if (!term2Finalized) return 2;
  return null;
};

export type GradeService = {
  teacherSubjects(teacherUserId: string, requestedYear?: number): Promise<{ currentAcademicYear: number; subjects: TeacherSubject[] }>;
  teacherGrades(teacherUserId: string, subjectId: string, term: 1 | 2, requestedYear?: number): Promise<{ academicYear: number; editable: boolean; students: GradeStudent[]; weights: GradeWeights | null; isFinalized: boolean }>;
  saveTeacherGrades(teacherUserId: string, subjectId: string, term: 1 | 2, grades: GradeWrite[]): Promise<{ saved: number }>;
  saveTeacherWeights(teacherUserId: string, subjectId: string, term: 1 | 2, weights: GradeWeights): Promise<GradeWeights>;
  adminSubjects(requestedYear?: number): Promise<{ currentAcademicYear: number; subjects: AdminSubject[] }>;
  finalize(adminUserId: string, subjectId: string, term: 1 | 2): Promise<{ finalized: boolean; alreadyFinalized: boolean; eligibleStudents: number }>;
  reopen(adminUserId: string, subjectId: string, term: 1 | 2, reason: string): Promise<{ reopened: boolean }>;
  adminGrades(query: AdminGradeQuery): Promise<{ academicYear: number; items: Array<AdminGradeDetail & { latest: AdminGradeAttempt }> }>;
  adminGradeDetail(gradeId: string): Promise<AdminGradeDetail>;
  correctAdminGrade(adminUserId: string, gradeId: string, input: GradeInputs, reason: string): Promise<{ id: string; letterGrade: "S" | "A" | "B" | "C" | "F" | null }>;
  createRetake(adminUserId: string, gradeId: string, input: GradeInputs, reason: string): Promise<{ id: string; attempt: number; letterGrade: "S" | "A" | "B" | "C" | "F" }>;
};

export const unavailableGradeService: GradeService = {
  teacherSubjects: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  teacherGrades: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  saveTeacherGrades: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  saveTeacherWeights: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  adminSubjects: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  finalize: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  reopen: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  adminGrades: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  adminGradeDetail: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  correctAdminGrade: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
  createRetake: async () => { throw new GradeDomainError("GRADE_SERVICE_UNAVAILABLE", "成績機能を利用できません。", 503); },
};

export class D1GradeService implements GradeService {
  constructor(private readonly database: D1Database, private readonly newId: () => string = () => createWorkerId(), private readonly clock: Clock = () => new Date()) {}

  private async first<T extends SqlRow>(statement: D1PreparedStatement): Promise<T | null> {
    const result = await statement.first<T>();
    return result ?? null;
  }

  private async rows<T extends SqlRow>(statement: D1PreparedStatement): Promise<T[]> {
    const result = await statement.all<T>();
    return result.results ?? [];
  }

  private async currentAcademicYear(): Promise<number> {
    return ensureCurrentAcademicYear(this.database, this.clock);
  }

  private validateRequestedYear(currentAcademicYear: number, requestedYear: number | undefined) {
    const year = requestedYear ?? currentAcademicYear;
    if (!Number.isInteger(year) || year < currentAcademicYear - 3 || year > currentAcademicYear) {
      throw new GradeDomainError("INVALID_ACADEMIC_YEAR", "閲覧できる年度は現在年度から過去3年度までです。");
    }
    return year;
  }

  private async subject(subjectId: string, academicYear: number, teacherUserId?: string) {
    const clauses = ["id = ?", "academic_year = ?"];
    const values: unknown[] = [subjectId, academicYear];
    if (teacherUserId) {
      clauses.push("teacher_user_id = ?");
      values.push(teacherUserId);
    }
    const row = await this.first<{ id: string; academic_year: number; name: string; grade_level: number }>(
      this.database.prepare(`SELECT id, academic_year, name, grade_level FROM subjects WHERE ${clauses.join(" AND ")} LIMIT 1`).bind(...values),
    );
    if (!row) {
      throw new GradeDomainError(teacherUserId ? "SUBJECT_NOT_ASSIGNED" : "SUBJECT_NOT_FOUND", teacherUserId ? "担当科目ではありません。" : "科目が見つかりません。", teacherUserId ? 403 : 404);
    }
    return { id: row.id, academicYear: asNumber(row.academic_year), name: row.name, gradeLevel: asNumber(row.grade_level) };
  }

  private async termStatus(subjectId: string, term: 1 | 2) {
    const row = await this.first<{ is_finalized: number | boolean }>(
      this.database.prepare("SELECT is_finalized FROM subject_term_statuses WHERE subject_id = ? AND term = ? LIMIT 1").bind(subjectId, term),
    );
    return d1Boolean(row?.is_finalized);
  }

  private async weights(subjectId: string, term: 1 | 2): Promise<GradeWeights | null> {
    const row = await this.first<{ attendance_weight: number; attitude_weight: number; assignment_weight: number }>(
      this.database.prepare("SELECT attendance_weight, attitude_weight, assignment_weight FROM grade_weights WHERE subject_id = ? AND term = ? LIMIT 1").bind(subjectId, term),
    );
    if (!row) return null;
    const weights = { attendanceWeight: asNumber(row.attendance_weight), attitudeWeight: asNumber(row.attitude_weight), assignmentWeight: asNumber(row.assignment_weight) };
    try { validateGradeWeights(weights); } catch (error) {
      throw new GradeDomainError("INVALID_SAVED_WEIGHTS", "評価比重の設定が不正です。", 409);
    }
    return weights;
  }

  private async eligibleStudents(subjectId: string, academicYear: number, gradeLevel: number, term: 1 | 2): Promise<GradeStudent[]> {
    const rows = await this.rows<SqlRow>(this.database.prepare(`
      WITH student_snapshot AS (
        SELECT s.*,
          COALESCE((SELECT h.status FROM student_status_history h
            WHERE h.student_id = s.id AND h.effective_academic_year <= ?
            ORDER BY h.effective_academic_year DESC, h.changed_at DESC, h.id DESC LIMIT 1),
            CASE WHEN s.status_effective_academic_year IS NULL OR s.status_effective_academic_year > ? THEN 'enrolled' ELSE s.status END) AS snapshot_status,
          COALESCE((SELECT h.effective_academic_year FROM student_status_history h
            WHERE h.student_id = s.id AND h.effective_academic_year <= ?
            ORDER BY h.effective_academic_year DESC, h.changed_at DESC, h.id DESC LIMIT 1),
            CASE WHEN s.status_effective_academic_year IS NULL OR s.status_effective_academic_year > ? THEN NULL ELSE s.status_effective_academic_year END) AS snapshot_status_effective_academic_year
        FROM students s
      )
      SELECT s.id, s.student_number, s.name, s.snapshot_status AS status,
             g.attempt, g.attendance_rate, g.attitude, g.assignment,
             g.final_score_numerator, g.final_score_denominator, g.letter_grade,
             EXISTS(
               SELECT 1 FROM grades failed
               JOIN subject_term_statuses failed_term ON failed_term.subject_id=failed.subject_id AND failed_term.term=failed.term
               WHERE failed.student_id=s.id AND failed.subject_id=? AND failed.academic_year=? AND failed.term=?
                 AND failed.letter_grade='F' AND failed_term.is_finalized=1
             ) AS has_failed_history
      FROM student_snapshot s
      INNER JOIN subject_courses sc ON sc.course_id = s.course_id AND sc.subject_id = ?
      LEFT JOIN grades g ON g.id = (
        SELECT latest.id FROM grades latest
        WHERE latest.student_id = s.id AND latest.subject_id = ?
          AND latest.academic_year = ? AND latest.term = ?
        ORDER BY latest.attempt DESC LIMIT 1
      )
      WHERE s.enrollment_year = ?
        AND NOT (s.snapshot_status = 'withdrawn' AND s.snapshot_status_effective_academic_year < ?)
      ORDER BY s.student_number ASC
    `).bind(academicYear, academicYear, academicYear, academicYear, subjectId, academicYear, term, subjectId, subjectId, academicYear, term, academicYear - gradeLevel + 1, academicYear));
    return rows.map((row) => {
      const status = asStatus(row.status);
      const hasGrade = row.attempt !== null && row.attempt !== undefined;
      return {
        id: String(row.id), studentNumber: String(row.student_number), name: String(row.name), status, hasFailedHistory: d1Boolean(row.has_failed_history),
        editable: status === "enrolled",
        grade: hasGrade ? {
          attempt: asNumber(row.attempt), attendanceRate: asNullableNumber(row.attendance_rate), attitude: asNullableNumber(row.attitude), assignment: asNullableNumber(row.assignment),
          finalScoreNumerator: asNullableNumber(row.final_score_numerator), finalScoreDenominator: asNullableNumber(row.final_score_denominator),
          letterGrade: row.letter_grade === "S" || row.letter_grade === "A" || row.letter_grade === "B" || row.letter_grade === "C" || row.letter_grade === "F" ? row.letter_grade : null,
        } : null,
      };
    });
  }

  async teacherSubjects(teacherUserId: string, requestedYear?: number) {
    const currentAcademicYear = await this.currentAcademicYear();
    const academicYear = this.validateRequestedYear(currentAcademicYear, requestedYear);
    const rows = await this.rows<{ id: string; name: string; academic_year: number; grade_level: number; term_1_finalized: number | boolean | null; term_2_finalized: number | boolean | null }>(
      this.database.prepare(`
        SELECT s.id, s.name, s.academic_year, s.grade_level,
               t1.is_finalized AS term_1_finalized, t2.is_finalized AS term_2_finalized
        FROM subjects s
        LEFT JOIN subject_term_statuses t1 ON t1.subject_id = s.id AND t1.term = 1
        LEFT JOIN subject_term_statuses t2 ON t2.subject_id = s.id AND t2.term = 2
        WHERE s.teacher_user_id = ? AND s.academic_year = ?
        ORDER BY s.grade_level, s.name
      `).bind(teacherUserId, academicYear),
    );
    return {
      currentAcademicYear,
      subjects: rows.map((row) => {
        const term1Finalized = d1Boolean(row.term_1_finalized);
        const term2Finalized = d1Boolean(row.term_2_finalized);
        const editable = academicYear === currentAcademicYear;
        return {
          id: row.id, name: row.name, academicYear: asNumber(row.academic_year), gradeLevel: asNumber(row.grade_level), editable,
          editableTerm: editable ? editableTermForStatuses(term1Finalized, term2Finalized) : null,
          termStatuses: [{ term: 1 as const, isFinalized: term1Finalized }, { term: 2 as const, isFinalized: term2Finalized }],
        };
      }),
    };
  }

  async teacherGrades(teacherUserId: string, subjectId: string, term: 1 | 2, requestedYear?: number) {
    const currentAcademicYear = await this.currentAcademicYear();
    const academicYear = this.validateRequestedYear(currentAcademicYear, requestedYear);
    const subject = await this.subject(subjectId, academicYear, teacherUserId);
    const [term1Finalized, term2Finalized] = await Promise.all([this.termStatus(subject.id, 1), this.termStatus(subject.id, 2)]);
    const currentEditableTerm = editableTermForStatuses(term1Finalized, term2Finalized);
    if (academicYear === currentAcademicYear && currentEditableTerm !== null && term !== currentEditableTerm) {
      throw new GradeDomainError("TERM_NOT_CURRENTLY_EDITABLE", "現在入力する学期ではありません。", 409, { currentTerm: currentEditableTerm });
    }
    const isFinalized = term === 1 ? term1Finalized : term2Finalized;
    const [students, weights] = await Promise.all([
      this.eligibleStudents(subject.id, academicYear, subject.gradeLevel, term), this.weights(subject.id, term),
    ]);
    return { academicYear, editable: academicYear === currentAcademicYear && currentEditableTerm === term && !isFinalized, students, weights, isFinalized };
  }

  private async assertTeacherEditable(teacherUserId: string, subjectId: string, term: 1 | 2) {
    const academicYear = await this.currentAcademicYear();
    const subject = await this.subject(subjectId, academicYear, teacherUserId);
    const term1Finalized = await this.termStatus(subjectId, 1);
    const term2Finalized = await this.termStatus(subjectId, 2);
    if (editableTermForStatuses(term1Finalized, term2Finalized) !== term || await this.termStatus(subjectId, term)) {
      throw new GradeDomainError("TERM_NOT_EDITABLE", "この学期の成績は入力できません。", 409);
    }
    return { academicYear, subject };
  }

  async saveTeacherGrades(teacherUserId: string, subjectId: string, term: 1 | 2, writes: GradeWrite[]) {
    if (writes.length === 0) throw new GradeDomainError("EMPTY_GRADES", "保存する成績がありません。");
    const uniqueIds = new Set<string>();
    for (const write of writes) {
      if (!write.studentId || uniqueIds.has(write.studentId)) throw new GradeDomainError("DUPLICATE_STUDENT", "同じ学生を重複して保存できません。");
      uniqueIds.add(write.studentId);
      try { validateGradeInputs(write); } catch (error) {
        if (error instanceof GradeValidationError) throw new GradeDomainError(error.code, error.message);
        throw error;
      }
    }
    const academicYear = await this.currentAcademicYear();
    const values = writes.map(() => "(?, ?, ?, ?)").join(", ");
    const bindings: unknown[] = writes.flatMap((write) => [write.studentId, write.attendanceRate, write.attitude, write.assignment]);
    const result = await this.database.batch([this.database.prepare(`
      WITH requested(student_id, attendance_rate, attitude, assignment) AS (VALUES ${values}),
      guard AS (
        SELECT s.id AS subject_id, s.academic_year, s.grade_level,
          w.attendance_weight, w.attitude_weight, w.assignment_weight
        FROM subjects s JOIN academic_years ay ON ay.year = s.academic_year AND ay.is_current = 1
        JOIN grade_weights w ON w.subject_id = s.id AND w.term = ?
        WHERE s.id = ? AND s.teacher_user_id = ?
          AND NOT EXISTS (SELECT 1 FROM subject_term_statuses st WHERE st.subject_id = s.id AND st.term = ? AND st.is_finalized = 1)
          AND (? = 1 OR EXISTS (SELECT 1 FROM subject_term_statuses st WHERE st.subject_id = s.id AND st.term = 1 AND st.is_finalized = 1))
          AND NOT EXISTS (SELECT 1 FROM requested r WHERE NOT EXISTS (
            SELECT 1 FROM students student JOIN subject_courses sc ON sc.course_id = student.course_id AND sc.subject_id = s.id
            WHERE student.id = r.student_id AND student.enrollment_year = s.academic_year - s.grade_level + 1
              AND COALESCE((SELECT h.status FROM student_status_history h
                WHERE h.student_id = student.id AND h.effective_academic_year <= s.academic_year
                ORDER BY h.effective_academic_year DESC, h.changed_at DESC, h.id DESC LIMIT 1),
                CASE WHEN student.status_effective_academic_year IS NULL OR student.status_effective_academic_year > s.academic_year THEN 'enrolled' ELSE student.status END) = 'enrolled'
          ))
      )
      INSERT INTO grades (id, student_id, subject_id, academic_year, term, attempt, attendance_rate, attitude, assignment,
        final_score_numerator, final_score_denominator, letter_grade, entered_by_user_id, last_updated_by_user_id)
      SELECT lower(hex(randomblob(16))), r.student_id, g.subject_id, g.academic_year, ?,
        COALESCE((SELECT MAX(old.attempt) FROM grades old WHERE old.student_id = r.student_id AND old.subject_id = g.subject_id AND old.term = ?), 1),
        r.attendance_rate, r.attitude, r.assignment,
        CASE WHEN r.attendance_rate IS NULL OR r.attitude IS NULL OR r.assignment IS NULL THEN NULL
          ELSE r.attendance_rate * g.attendance_weight + r.attitude * 10 * g.attitude_weight + r.assignment * 10 * g.assignment_weight END,
        CASE WHEN r.attendance_rate IS NULL OR r.attitude IS NULL OR r.assignment IS NULL THEN NULL ELSE 100 END,
        CASE WHEN r.attendance_rate IS NULL OR r.attitude IS NULL OR r.assignment IS NULL THEN NULL
          WHEN r.attendance_rate * g.attendance_weight + r.attitude * 10 * g.attitude_weight + r.assignment * 10 * g.assignment_weight >= 9000 THEN 'S'
          WHEN r.attendance_rate * g.attendance_weight + r.attitude * 10 * g.attitude_weight + r.assignment * 10 * g.assignment_weight >= 8000 THEN 'A'
          WHEN r.attendance_rate * g.attendance_weight + r.attitude * 10 * g.attitude_weight + r.assignment * 10 * g.assignment_weight >= 7000 THEN 'B'
          WHEN r.attendance_rate * g.attendance_weight + r.attitude * 10 * g.attitude_weight + r.assignment * 10 * g.assignment_weight >= 6000 THEN 'C' ELSE 'F' END,
        ?, ? FROM requested r CROSS JOIN guard g WHERE true
      ON CONFLICT(student_id, subject_id, term, attempt) DO UPDATE SET attendance_rate = excluded.attendance_rate,
        attitude = excluded.attitude, assignment = excluded.assignment, final_score_numerator = excluded.final_score_numerator,
        final_score_denominator = excluded.final_score_denominator, letter_grade = excluded.letter_grade,
        last_updated_by_user_id = excluded.last_updated_by_user_id, updated_at = unixepoch()
    `).bind(...bindings, term, subjectId, teacherUserId, term, term, term, term, teacherUserId, teacherUserId)]);
    if ((result[0]?.meta.changes ?? 0) !== writes.length) {
      throw new GradeDomainError("TERM_NOT_EDITABLE", "この学期または対象学生は成績入力できません。", 409);
    }
    return { saved: writes.length };
  }

  async saveTeacherWeights(teacherUserId: string, subjectId: string, term: 1 | 2, weights: GradeWeights) {
    try { validateGradeWeights(weights); } catch (error) {
      if (error instanceof GradeValidationError) throw new GradeDomainError(error.code, error.message);
      throw error;
    }
    const result = await this.database.batch([this.database.prepare(`
      INSERT INTO grade_weights (id, subject_id, term, attendance_weight, attitude_weight, assignment_weight)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM subjects s JOIN academic_years ay ON ay.year = s.academic_year AND ay.is_current = 1
        WHERE s.id = ? AND s.teacher_user_id = ?
          AND NOT EXISTS (SELECT 1 FROM subject_term_statuses st WHERE st.subject_id = s.id AND st.term = ? AND st.is_finalized = 1)
          AND (? = 1 OR EXISTS (SELECT 1 FROM subject_term_statuses st WHERE st.subject_id = s.id AND st.term = 1 AND st.is_finalized = 1))
      )
      ON CONFLICT(subject_id, term) DO UPDATE SET attendance_weight = excluded.attendance_weight,
        attitude_weight = excluded.attitude_weight, assignment_weight = excluded.assignment_weight, updated_at = unixepoch()
    `).bind(this.newId(), subjectId, term, weights.attendanceWeight, weights.attitudeWeight, weights.assignmentWeight, subjectId, teacherUserId, term, term),
    this.database.prepare(`
      UPDATE grades SET final_score_numerator = CASE WHEN attendance_rate IS NULL OR attitude IS NULL OR assignment IS NULL THEN NULL
          ELSE attendance_rate * ? + attitude * 10 * ? + assignment * 10 * ? END,
        final_score_denominator = CASE WHEN attendance_rate IS NULL OR attitude IS NULL OR assignment IS NULL THEN NULL ELSE 100 END,
        letter_grade = CASE WHEN attendance_rate IS NULL OR attitude IS NULL OR assignment IS NULL THEN NULL
          WHEN attendance_rate * ? + attitude * 10 * ? + assignment * 10 * ? >= 9000 THEN 'S'
          WHEN attendance_rate * ? + attitude * 10 * ? + assignment * 10 * ? >= 8000 THEN 'A'
          WHEN attendance_rate * ? + attitude * 10 * ? + assignment * 10 * ? >= 7000 THEN 'B'
          WHEN attendance_rate * ? + attitude * 10 * ? + assignment * 10 * ? >= 6000 THEN 'C' ELSE 'F' END,
        last_updated_by_user_id = ?, updated_at = unixepoch()
      WHERE subject_id = ? AND term = ? AND EXISTS (
        SELECT 1 FROM subjects s JOIN academic_years ay ON ay.year = s.academic_year AND ay.is_current = 1
        WHERE s.id = grades.subject_id AND s.teacher_user_id = ?
          AND NOT EXISTS (SELECT 1 FROM subject_term_statuses st WHERE st.subject_id = s.id AND st.term = ? AND st.is_finalized = 1)
      )
    `).bind(...Array(5).fill([weights.attendanceWeight, weights.attitudeWeight, weights.assignmentWeight]).flat(), teacherUserId, subjectId, term, teacherUserId, term)]);
    if ((result[0]?.meta.changes ?? 0) !== 1) throw new GradeDomainError("TERM_NOT_EDITABLE", "この学期の評価比重は変更できません。", 409);
    return weights;
  }

  async adminSubjects(requestedYear?: number) {
    const currentAcademicYear = await this.currentAcademicYear();
    const academicYear = this.validateRequestedYear(currentAcademicYear, requestedYear);
    const rows = await this.rows<{ id: string; name: string; academic_year: number; grade_level: number; term_1_finalized: number | boolean | null; term_2_finalized: number | boolean | null }>(
      this.database.prepare(`
        SELECT s.id, s.name, s.academic_year, s.grade_level, t1.is_finalized AS term_1_finalized, t2.is_finalized AS term_2_finalized
        FROM subjects s LEFT JOIN subject_term_statuses t1 ON t1.subject_id = s.id AND t1.term = 1
        LEFT JOIN subject_term_statuses t2 ON t2.subject_id = s.id AND t2.term = 2
        WHERE s.academic_year = ? ORDER BY s.grade_level, s.name
      `).bind(academicYear),
    );
    const subjects = await Promise.all(rows.map(async (row) => {
      const term1Finalized = d1Boolean(row.term_1_finalized);
      const term2Finalized = d1Boolean(row.term_2_finalized);
      const subject = { id: row.id, name: row.name, academicYear: asNumber(row.academic_year), gradeLevel: asNumber(row.grade_level) };
      const [term1Students, term2Students] = await Promise.all([
        this.eligibleStudents(subject.id, academicYear, subject.gradeLevel, 1), this.eligibleStudents(subject.id, academicYear, subject.gradeLevel, 2),
      ]);
      const count = (students: GradeStudent[]) => ({
        eligible: students.filter((student) => student.status === "enrolled").length,
        complete: students.filter((student) => student.status === "enrolled" && student.grade?.attendanceRate != null && student.grade?.attitude != null && student.grade?.assignment != null).length,
      });
      const editable = academicYear === currentAcademicYear;
      return { ...subject, editable, editableTerm: editable ? editableTermForStatuses(term1Finalized, term2Finalized) : null,
        termStatuses: [{ term: 1 as const, isFinalized: term1Finalized }, { term: 2 as const, isFinalized: term2Finalized }],
        completion: { 1: count(term1Students), 2: count(term2Students) },
      };
    }));
    return { currentAcademicYear, subjects };
  }

  async finalize(adminUserId: string, subjectId: string, term: 1 | 2) {
    const academicYear = await this.currentAcademicYear();
    const transitionId = this.newId();
    const auditId = this.newId();
    await this.database.batch([
      this.database.prepare(`
        INSERT INTO subject_term_statuses (subject_id, term, is_finalized, finalized_by_user_id, finalized_at, last_transition_id)
        SELECT s.id, ?, 1, ?, unixepoch(), ? FROM subjects s
        JOIN grade_weights w ON w.subject_id = s.id AND w.term = ?
        WHERE s.id = ? AND s.academic_year = ?
          AND NOT EXISTS (SELECT 1 FROM subject_term_statuses current WHERE current.subject_id = s.id AND current.term = ? AND current.is_finalized = 1)
          AND (? = 1 OR EXISTS (SELECT 1 FROM subject_term_statuses first_term WHERE first_term.subject_id = s.id AND first_term.term = 1 AND first_term.is_finalized = 1))
          AND NOT EXISTS (
            SELECT 1 FROM students student JOIN subject_courses sc ON sc.course_id = student.course_id AND sc.subject_id = s.id
            WHERE student.enrollment_year = s.academic_year - s.grade_level + 1
              AND COALESCE((SELECT h.status FROM student_status_history h
                WHERE h.student_id = student.id AND h.effective_academic_year <= s.academic_year
                ORDER BY h.effective_academic_year DESC, h.changed_at DESC, h.id DESC LIMIT 1),
                CASE WHEN student.status_effective_academic_year IS NULL OR student.status_effective_academic_year > s.academic_year THEN 'enrolled' ELSE student.status END) = 'enrolled'
              AND NOT EXISTS (
                SELECT 1 FROM grades g WHERE g.student_id = student.id AND g.subject_id = s.id AND g.academic_year = s.academic_year AND g.term = ?
                  AND g.attempt = (SELECT MAX(latest.attempt) FROM grades latest WHERE latest.student_id = student.id AND latest.subject_id = s.id AND latest.academic_year = s.academic_year AND latest.term = ?)
                  AND g.attendance_rate IS NOT NULL AND g.attitude IS NOT NULL AND g.assignment IS NOT NULL
                  AND g.final_score_numerator = g.attendance_rate * w.attendance_weight + g.attitude * 10 * w.attitude_weight + g.assignment * 10 * w.assignment_weight
                  AND g.final_score_denominator = 100
                  AND g.letter_grade = CASE WHEN g.final_score_numerator >= 9000 THEN 'S' WHEN g.final_score_numerator >= 8000 THEN 'A' WHEN g.final_score_numerator >= 7000 THEN 'B' WHEN g.final_score_numerator >= 6000 THEN 'C' ELSE 'F' END
              )
          )
        ON CONFLICT(subject_id, term) DO UPDATE SET is_finalized = 1, finalized_by_user_id = excluded.finalized_by_user_id,
          finalized_at = excluded.finalized_at, last_transition_id = excluded.last_transition_id, updated_at = unixepoch()
          WHERE subject_term_statuses.is_finalized = 0
      `).bind(term, adminUserId, transitionId, term, subjectId, academicYear, term, term, term, term),
      this.database.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, academic_year, payload_json)
        SELECT ?, ?, 'subject_term_finalized', 'subject_term', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM subject_term_statuses WHERE subject_id = ? AND term = ? AND last_transition_id = ?)
      `).bind(auditId, adminUserId, `${subjectId}:${term}`, academicYear, JSON.stringify({ term }), subjectId, term, transitionId),
      // A draft F is not a failure history.  Gate this sticky update on this
      // finalization transition so a rejected transition cannot mark a student.
      this.database.prepare(`UPDATE students SET has_failed_history=1, updated_at=unixepoch()
        WHERE EXISTS (SELECT 1 FROM subject_term_statuses st WHERE st.subject_id=? AND st.term=? AND st.is_finalized=1 AND st.last_transition_id=?)
          AND id IN (SELECT g.student_id FROM grades g WHERE g.subject_id=? AND g.academic_year=? AND g.term=? AND g.letter_grade='F')`).bind(subjectId, term, transitionId, subjectId, academicYear, term),
    ]);
    const state = await this.first<{ is_finalized: number; last_transition_id: string | null }>(this.database.prepare(
      "SELECT is_finalized, last_transition_id FROM subject_term_statuses WHERE subject_id = ? AND term = ?",
    ).bind(subjectId, term));
    if (!state || !d1Boolean(state.is_finalized)) throw new GradeDomainError("FINALIZATION_PRECONDITION_FAILED", "評価比重、成績入力、または学期順序を確認してください。", 409);
    const subject = await this.subject(subjectId, academicYear);
    const students = await this.eligibleStudents(subjectId, academicYear, subject.gradeLevel, term);
    return { finalized: true, alreadyFinalized: state.last_transition_id !== transitionId, eligibleStudents: students.filter((student) => student.status === "enrolled").length };
  }

  async reopen(adminUserId: string, subjectId: string, term: 1 | 2, reason: string) {
    if (!reason.trim()) throw new GradeDomainError("REOPEN_REASON_REQUIRED", "再開理由を入力してください。");
    const academicYear = await this.currentAcademicYear();
    const transitionId = this.newId();
    await this.database.batch([
      this.database.prepare(`
        UPDATE subject_term_statuses SET is_finalized = 0, reopened_by_user_id = ?, reopened_at = unixepoch(),
          reopened_reason = ?, last_transition_id = ?, updated_at = unixepoch()
        WHERE subject_id = ? AND term = ? AND is_finalized = 1
          AND EXISTS (SELECT 1 FROM subjects s WHERE s.id = subject_term_statuses.subject_id AND s.academic_year = ?)
          AND (? = 2 OR (NOT EXISTS (SELECT 1 FROM subject_term_statuses t2 WHERE t2.subject_id = subject_term_statuses.subject_id AND t2.term = 2 AND t2.is_finalized = 1)
            AND NOT EXISTS (SELECT 1 FROM grades g2 WHERE g2.subject_id = subject_term_statuses.subject_id AND g2.academic_year = ? AND g2.term = 2)))
      `).bind(adminUserId, reason.trim(), transitionId, subjectId, term, academicYear, term, academicYear),
      this.database.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, academic_year, payload_json)
        SELECT ?, ?, 'subject_term_reopened', 'subject_term', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM subject_term_statuses WHERE subject_id = ? AND term = ? AND last_transition_id = ? AND is_finalized = 0)
      `).bind(this.newId(), adminUserId, `${subjectId}:${term}`, academicYear, JSON.stringify({ term, reason: reason.trim() }), subjectId, term, transitionId),
    ]);
    const state = await this.first<{ is_finalized: number; last_transition_id: string | null }>(this.database.prepare(
      "SELECT is_finalized, last_transition_id FROM subject_term_statuses WHERE subject_id = ? AND term = ?",
    ).bind(subjectId, term));
    if (!state || d1Boolean(state.is_finalized) || state.last_transition_id !== transitionId) {
      throw new GradeDomainError("REOPEN_PRECONDITION_FAILED", "確定状態または後期の成績を確認してください。", 409);
    }
    return { reopened: true };
  }

  private attempt(row: SqlRow): AdminGradeAttempt {
    const letter = row.letter_grade;
    return { id: String(row.id), attempt: asNumber(row.attempt), attendanceRate: asNullableNumber(row.attendance_rate), attitude: asNullableNumber(row.attitude), assignment: asNullableNumber(row.assignment), finalScoreNumerator: asNullableNumber(row.final_score_numerator), finalScoreDenominator: asNullableNumber(row.final_score_denominator), letterGrade: letter === "S" || letter === "A" || letter === "B" || letter === "C" || letter === "F" ? letter : null, hasFailedHistory: d1Boolean(row.has_failed_history) };
  }

  private async detailFromLatest(latestId: string): Promise<AdminGradeDetail> {
    const base = await this.first<SqlRow>(this.database.prepare(`SELECT g.id, g.student_id, s.student_number, s.name AS student_name, g.subject_id, sub.name AS subject_name, g.academic_year, g.term
      FROM grades g JOIN students s ON s.id=g.student_id JOIN subjects sub ON sub.id=g.subject_id AND sub.academic_year=g.academic_year WHERE g.id=?`).bind(latestId));
    if (!base) throw new GradeDomainError("GRADE_NOT_FOUND", "成績が見つかりません。", 404);
    const attempts = await this.rows<SqlRow>(this.database.prepare(`SELECT g.*, EXISTS(
      SELECT 1 FROM grades failed JOIN subject_term_statuses failed_term ON failed_term.subject_id=failed.subject_id AND failed_term.term=failed.term
      WHERE failed.student_id=g.student_id AND failed.subject_id=g.subject_id AND failed.academic_year=g.academic_year AND failed.term=g.term
        AND failed.letter_grade='F' AND failed_term.is_finalized=1
    ) AS has_failed_history FROM grades g WHERE g.student_id=? AND g.subject_id=? AND g.academic_year=? AND g.term=? ORDER BY g.attempt DESC`).bind(base.student_id, base.subject_id, base.academic_year, base.term));
    const term = asNumber(base.term);
    if (term !== 1 && term !== 2) throw new Error("Unexpected term");
    return { id: String(base.id), studentId: String(base.student_id), studentNumber: String(base.student_number), studentName: String(base.student_name), subjectId: String(base.subject_id), subjectName: String(base.subject_name), academicYear: asNumber(base.academic_year), term, attempts: attempts.map((row) => this.attempt(row)) };
  }

  async adminGrades(query: AdminGradeQuery) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new GradeDomainError("INVALID_GRADE_QUERY", "検索条件を正しく指定してください。");
    const current = await this.currentAcademicYear(); const year = this.validateRequestedYear(current, query.academicYear);
    const clauses = ["g.academic_year=?", "g.attempt=(SELECT MAX(latest.attempt) FROM grades latest WHERE latest.student_id=g.student_id AND latest.subject_id=g.subject_id AND latest.academic_year=g.academic_year AND latest.term=g.term)"]; const values: unknown[] = [year];
    if (query.term) { clauses.push("g.term=?"); values.push(query.term); } if (query.courseId) { clauses.push("s.course_id=?"); values.push(query.courseId); } if (query.gradeLevel) { clauses.push("sub.grade_level=?"); values.push(query.gradeLevel); } if (query.subjectId) { clauses.push("g.subject_id=?"); values.push(query.subjectId); } if (query.letterGrade) { clauses.push("g.letter_grade=?"); values.push(query.letterGrade); } if (query.studentSearch) { clauses.push("(s.name LIKE ? OR s.student_number LIKE ?)"); values.push(`%${query.studentSearch.trim()}%`, `%${query.studentSearch.trim()}%`); }
    const rows = await this.rows<SqlRow>(this.database.prepare(`SELECT g.id FROM grades g JOIN students s ON s.id=g.student_id JOIN subjects sub ON sub.id=g.subject_id AND sub.academic_year=g.academic_year WHERE ${clauses.join(" AND ")} ORDER BY s.student_number, g.subject_id, g.term LIMIT ?`).bind(...values, query.limit));
    const details = await Promise.all(rows.map((row) => this.detailFromLatest(String(row.id))));
    return { academicYear: year, items: details.map((detail) => ({ ...detail, latest: detail.attempts[0]! })) };
  }

  async adminGradeDetail(gradeId: string) { return this.detailFromLatest(gradeId); }

  private async calculatedForGrade(gradeId: string, input: GradeInputs) {
    try { validateGradeInputs(input); } catch (error) { if (error instanceof GradeValidationError) throw new GradeDomainError(error.code, error.message); throw error; }
    const grade = await this.first<{ subject_id: string; term: number }>(this.database.prepare("SELECT subject_id, term FROM grades WHERE id=?").bind(gradeId));
    if (!grade || (grade.term !== 1 && grade.term !== 2)) throw new GradeDomainError("GRADE_NOT_FOUND", "成績が見つかりません。", 404);
    const weights = await this.weights(grade.subject_id, grade.term);
    if (!weights) throw new GradeDomainError("GRADE_WEIGHTS_NOT_FOUND", "評価比重が設定されていません。", 409);
    return { grade, calculated: calculateGrade(input, weights) };
  }

  async correctAdminGrade(adminUserId: string, gradeId: string, input: GradeInputs, reason: string) {
    if (!reason.trim()) throw new GradeDomainError("CORRECTION_REASON_REQUIRED", "修正理由を入力してください。");
    const { calculated } = await this.calculatedForGrade(gradeId, input);
    const current = await this.first<{ student_id: string; subject_id: string; academic_year: number; term: number; attempt: number; letter_grade: string | null }>(this.database.prepare("SELECT student_id, subject_id, academic_year, term, attempt, letter_grade FROM grades WHERE id=?").bind(gradeId));
    if (!current) throw new GradeDomainError("GRADE_NOT_FOUND", "成績が見つかりません。", 404);
    const auditId = this.newId(); const previousGrade = current.letter_grade;
    const result = await this.database.batch([
      this.database.prepare(`UPDATE grades SET attendance_rate=?, attitude=?, assignment=?, final_score_numerator=?, final_score_denominator=?, letter_grade=?, last_updated_by_user_id=?, updated_at=unixepoch() WHERE id=? AND attempt=(SELECT MAX(latest.attempt) FROM grades latest WHERE latest.student_id=grades.student_id AND latest.subject_id=grades.subject_id AND latest.academic_year=grades.academic_year AND latest.term=grades.term)`).bind(input.attendanceRate, input.attitude, input.assignment, calculated?.finalScoreNumerator ?? null, calculated?.finalScoreDenominator ?? null, calculated?.letterGrade ?? null, adminUserId, gradeId),
      this.database.prepare(`INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) SELECT ?,?,'grade_corrected','grade',?,academic_year,? FROM grades WHERE id=? AND changes()=1`).bind(auditId, adminUserId, gradeId, JSON.stringify({ attempt: current.attempt, previousGrade, newGrade: calculated?.letterGrade ?? null }), gradeId),
      // An unfinalized draft F is not yet a failure history.
      this.database.prepare(`UPDATE students SET has_failed_history=1,updated_at=unixepoch()
        WHERE id=(SELECT student_id FROM grades WHERE id=?)
          AND EXISTS(SELECT 1 FROM grades g JOIN subject_term_statuses st ON st.subject_id=g.subject_id AND st.term=g.term
            WHERE g.id=? AND g.letter_grade='F' AND st.is_finalized=1)`).bind(gradeId, gradeId),
    ]);
    if ((result[0]?.meta.changes ?? 0) !== 1) throw new GradeDomainError("GRADE_CONFLICT", "成績が更新されています。再読み込みしてください。", 409);
    return { id: gradeId, letterGrade: calculated?.letterGrade ?? null };
  }

  async createRetake(adminUserId: string, gradeId: string, input: GradeInputs, reason: string) {
    if (!reason.trim()) throw new GradeDomainError("RETAKE_REASON_REQUIRED", "再試験の理由を入力してください。");
    const { calculated } = await this.calculatedForGrade(gradeId, input);
    if (!calculated || calculated.letterGrade === "F") throw new GradeDomainError("RETAKE_PASS_REQUIRED", "再試験では合格となる成績を入力してください。", 409);
    const id = this.newId(); const auditId = this.newId();
    let result: D1Result[];
    try {
      result = await this.database.batch([
      this.database.prepare(`INSERT INTO grades (id,student_id,subject_id,academic_year,term,attempt,attendance_rate,attitude,assignment,final_score_numerator,final_score_denominator,letter_grade,entered_by_user_id,last_updated_by_user_id,created_at,updated_at)
        SELECT ?,g.student_id,g.subject_id,g.academic_year,g.term,g.attempt+1,?,?,?,?,?,?,?, ?,unixepoch(),unixepoch() FROM grades g
        WHERE g.id=? AND g.letter_grade='F' AND g.attempt=(SELECT MAX(latest.attempt) FROM grades latest WHERE latest.student_id=g.student_id AND latest.subject_id=g.subject_id AND latest.academic_year=g.academic_year AND latest.term=g.term)
          AND EXISTS(SELECT 1 FROM subject_term_statuses st WHERE st.subject_id=g.subject_id AND st.term=g.term AND st.is_finalized=1)`).bind(id, input.attendanceRate, input.attitude, input.assignment, calculated.finalScoreNumerator, calculated.finalScoreDenominator, calculated.letterGrade, adminUserId, adminUserId, gradeId),
      this.database.prepare(`INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,academic_year,payload_json) SELECT ?,?,'grade_retake_created','grade',?,academic_year,? FROM grades WHERE id=? AND changes()=1`).bind(auditId, adminUserId, id, JSON.stringify({ attempt: "next", previousGrade: "F", newGrade: calculated.letterGrade }), id),
      this.database.prepare(`UPDATE students SET has_failed_history=1,updated_at=unixepoch()
        WHERE id=(SELECT student_id FROM grades WHERE id=?) AND EXISTS(SELECT 1 FROM grades WHERE id=?)`).bind(gradeId, id),
      ]);
    } catch (error) {
      // The unique attempt key is the final concurrency guard; normalize the
      // expected losing insert into the stable 409 domain response.
      if (String(error).includes("UNIQUE constraint failed: grades.student_id")) {
        throw new GradeDomainError("RETAKE_NOT_AVAILABLE", "最新の確定済み不可評価のみ再試験にできます。", 409);
      }
      throw error;
    }
    if ((result[0]?.meta.changes ?? 0) !== 1) throw new GradeDomainError("RETAKE_NOT_AVAILABLE", "最新の確定済み不可評価のみ再試験にできます。", 409);
    const row = await this.first<{ attempt: number }>(this.database.prepare("SELECT attempt FROM grades WHERE id=?").bind(id));
    return { id, attempt: asNumber(row?.attempt), letterGrade: calculated.letterGrade };
  }
}

export const createGradeService = (database: D1Database) => new D1GradeService(database);
