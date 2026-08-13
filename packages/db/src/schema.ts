import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const unixNow = sql`(unixepoch())`;

/** Better Auth's required SQLite/D1 tables and the application user fields. */
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    role: text("role", { enum: ["admin", "teacher"] }).notNull().default("teacher"),
    status: text("status", { enum: ["active", "leave", "retired"] }).notNull().default("active"),
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [index("user_email_idx").on(table.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_token_idx").on(table.token), index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/** The two courses supplied by the school. Their IDs are stable import/API identifiers. */
export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
);

/**
 * Administrative selection, rather than the current date, determines the active year.
 * The partial unique index permits exactly zero or one current year while an administrator
 * is performing the first setup or a controlled rollover.
 */
export const academicYears = sqliteTable(
  "academic_years",
  {
    year: integer("year").primaryKey(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
    selectedByUserId: text("selected_by_user_id").references(() => user.id),
    selectedAt: integer("selected_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    check("academic_years_current_check", sql`${table.isCurrent} IN (0, 1)`),
    uniqueIndex("academic_years_current_unique")
      .on(table.isCurrent)
      .where(sql`${table.isCurrent} = 1`),
  ],
);

/** Current enrollment state; every change is retained in studentStatusHistory. */
export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    studentNumber: text("student_number").notNull().unique(),
    name: text("name").notNull(),
    nameKana: text("name_kana").notNull(),
    birthDate: text("birth_date").notNull(),
    // Gender policy has not been specified. Keep its value lossless instead of imposing categories.
    gender: text("gender").notNull(),
    email: text("email"),
    phone: text("phone"),
    postalCode: text("postal_code"),
    address: text("address"),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    enrollmentYear: integer("enrollment_year")
      .notNull()
      .references(() => academicYears.year),
    status: text("status", { enum: ["enrolled", "suspended", "withdrawn", "graduated"] })
      .notNull()
      .default("enrolled"),
    /** The year in which the current status takes effect; used to preserve withdrawn history. */
    statusEffectiveAcademicYear: integer("status_effective_academic_year").references(
      () => academicYears.year,
    ),
    statusChangedAt: integer("status_changed_at", { mode: "timestamp" }).notNull().default(unixNow),
    statusChangedByUserId: text("status_changed_by_user_id").references(() => user.id),
    hasFailedHistory: integer("has_failed_history", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    check(
      "students_status_check",
      sql`${table.status} IN ('enrolled', 'suspended', 'withdrawn', 'graduated')`,
    ),
    check(
      "students_terminal_status_effective_year_check",
      sql`${table.status} NOT IN ('withdrawn', 'graduated') OR ${table.statusEffectiveAcademicYear} IS NOT NULL`,
    ),
    check("students_failed_history_check", sql`${table.hasFailedHistory} IN (0, 1)`),
    index("students_course_year_idx").on(table.courseId, table.enrollmentYear),
    index("students_status_effective_year_idx").on(table.status, table.statusEffectiveAcademicYear),
  ],
);

/** Immutable record of changes to an individual student's enrollment status. */
export const studentStatusHistory = sqliteTable(
  "student_status_history",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    status: text("status", { enum: ["enrolled", "suspended", "withdrawn", "graduated"] }).notNull(),
    effectiveAcademicYear: integer("effective_academic_year")
      .notNull()
      .references(() => academicYears.year),
    changedAt: integer("changed_at", { mode: "timestamp" }).notNull().default(unixNow),
    changedByUserId: text("changed_by_user_id").references(() => user.id),
    reason: text("reason"),
  },
  (table) => [
    check(
      "student_status_history_status_check",
      sql`${table.status} IN ('enrolled', 'suspended', 'withdrawn', 'graduated')`,
    ),
    index("student_status_history_student_changed_idx").on(table.studentId, table.changedAt),
    index("student_status_history_effective_year_idx").on(table.effectiveAcademicYear),
  ],
);

export const subjects = sqliteTable(
  "subjects",
  {
    /** A UUID identifies one yearly subject offering; it is never reused by annual rollover. */
    id: text("id").primaryKey(),
    academicYear: integer("academic_year")
      .notNull()
      .references(() => academicYears.year),
    name: text("name").notNull(),
    gradeLevel: integer("grade_level").notNull(),
    teacherUserId: text("teacher_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    check("subjects_grade_level_check", sql`${table.gradeLevel} BETWEEN 1 AND 3`),
    // Retained for grades' composite FK: an offering UUID must always agree with its year.
    uniqueIndex("subjects_id_academic_year_unique").on(table.id, table.academicYear),
    uniqueIndex("subjects_year_name_grade_unique").on(table.academicYear, table.name, table.gradeLevel),
    index("subjects_teacher_year_idx").on(table.teacherUserId, table.academicYear),
  ],
);

/** A subject can be offered to one or both courses in its academic year. */
export const subjectCourses = sqliteTable(
  "subject_courses",
  {
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
  },
  (table) => [
    primaryKey({ columns: [table.subjectId, table.courseId] }),
    index("subject_courses_course_idx").on(table.courseId),
  ],
);

/** Percentage weights are configured independently for each subject and term. */
export const gradeWeights = sqliteTable(
  "grade_weights",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    term: integer("term").notNull(),
    attendanceWeight: integer("attendance_weight").notNull(),
    attitudeWeight: integer("attitude_weight").notNull(),
    assignmentWeight: integer("assignment_weight").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    check("grade_weights_term_check", sql`${table.term} IN (1, 2)`),
    check(
      "grade_weights_range_check",
      sql`${table.attendanceWeight} BETWEEN 0 AND 100
          AND ${table.attitudeWeight} BETWEEN 0 AND 100
          AND ${table.assignmentWeight} BETWEEN 0 AND 100`,
    ),
    check(
      "grade_weights_total_check",
      sql`${table.attendanceWeight} + ${table.attitudeWeight} + ${table.assignmentWeight} = 100`,
    ),
    uniqueIndex("grade_weights_subject_term_unique").on(table.subjectId, table.term),
  ],
);

/** The source of truth for whether a teacher may edit a subject's term. */
export const subjectTermStatuses = sqliteTable(
  "subject_term_statuses",
  {
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    term: integer("term").notNull(),
    isFinalized: integer("is_finalized", { mode: "boolean" }).notNull().default(false),
    finalizedByUserId: text("finalized_by_user_id").references(() => user.id),
    finalizedAt: integer("finalized_at", { mode: "timestamp" }),
    reopenedByUserId: text("reopened_by_user_id").references(() => user.id),
    reopenedAt: integer("reopened_at", { mode: "timestamp" }),
    reopenedReason: text("reopened_reason"),
    /** Identifies the CAS winner so exactly that transition can append its audit record. */
    lastTransitionId: text("last_transition_id").unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    primaryKey({ columns: [table.subjectId, table.term] }),
    check("subject_term_statuses_term_check", sql`${table.term} IN (1, 2)`),
    check("subject_term_statuses_finalized_check", sql`${table.isFinalized} IN (0, 1)`),
    check(
      "subject_term_statuses_finalized_metadata_check",
      sql`${table.isFinalized} = 0 OR (${table.finalizedByUserId} IS NOT NULL AND ${table.finalizedAt} IS NOT NULL)`,
    ),
    check(
      "subject_term_statuses_reopened_metadata_check",
      sql`(${table.reopenedByUserId} IS NULL AND ${table.reopenedAt} IS NULL)
          OR (${table.reopenedByUserId} IS NOT NULL AND ${table.reopenedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Draft inputs may be incomplete. Final score is retained as an exact numerator over the
 * explicit denominator rather than a rounded decimal until product policy defines rounding.
 */
export const grades = sqliteTable(
  "grades",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    subjectId: text("subject_id").notNull(),
    academicYear: integer("academic_year")
      .notNull()
      .references(() => academicYears.year),
    term: integer("term").notNull(),
    attempt: integer("attempt").notNull().default(1),
    attendanceRate: integer("attendance_rate"),
    attitude: integer("attitude"),
    assignment: integer("assignment"),
    finalScoreNumerator: integer("final_score_numerator"),
    finalScoreDenominator: integer("final_score_denominator"),
    letterGrade: text("letter_grade", { enum: ["S", "A", "B", "C", "F"] }),
    enteredByUserId: text("entered_by_user_id").references(() => user.id),
    lastUpdatedByUserId: text("last_updated_by_user_id").references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    check("grades_term_check", sql`${table.term} IN (1, 2)`),
    check("grades_attempt_check", sql`${table.attempt} >= 1`),
    check("grades_letter_grade_check", sql`${table.letterGrade} IN ('S', 'A', 'B', 'C', 'F') OR ${table.letterGrade} IS NULL`),
    check(
      "grades_input_range_check",
      sql`(${table.attendanceRate} IS NULL OR ${table.attendanceRate} BETWEEN 0 AND 100)
          AND (${table.attitude} IS NULL OR ${table.attitude} BETWEEN 0 AND 10)
          AND (${table.assignment} IS NULL OR ${table.assignment} BETWEEN 0 AND 10)`,
    ),
    check(
      "grades_final_score_representation_check",
      sql`(${table.finalScoreNumerator} IS NULL AND ${table.finalScoreDenominator} IS NULL)
          OR (${table.finalScoreNumerator} IS NOT NULL
            AND ${table.finalScoreDenominator} IS NOT NULL
            AND ${table.finalScoreNumerator} BETWEEN 0 AND 10000
            AND ${table.finalScoreDenominator} = 100)`,
    ),
    check(
      "grades_letter_grade_score_check",
      sql`${table.letterGrade} IS NULL OR (
          ${table.finalScoreNumerator} IS NOT NULL
          AND ${table.finalScoreDenominator} IS NOT NULL
          AND ${table.finalScoreDenominator} = 100
          AND (
            (${table.letterGrade} = 'S' AND ${table.finalScoreNumerator} >= 9000)
            OR (${table.letterGrade} = 'A' AND ${table.finalScoreNumerator} BETWEEN 8000 AND 8999)
            OR (${table.letterGrade} = 'B' AND ${table.finalScoreNumerator} BETWEEN 7000 AND 7999)
            OR (${table.letterGrade} = 'C' AND ${table.finalScoreNumerator} BETWEEN 6000 AND 6999)
            OR (${table.letterGrade} = 'F' AND ${table.finalScoreNumerator} < 6000)
          )
      )`,
    ),
    foreignKey({
      columns: [table.subjectId, table.academicYear],
      foreignColumns: [subjects.id, subjects.academicYear],
      name: "grades_subject_academic_year_fk",
    }),
    uniqueIndex("grades_student_subject_term_attempt_unique").on(
      table.studentId,
      table.subjectId,
      table.term,
      table.attempt,
    ),
    index("grades_subject_year_term_idx").on(table.subjectId, table.academicYear, table.term),
    index("grades_student_year_idx").on(table.studentId, table.academicYear),
  ],
);

/** Append-only audit records; API mutations must only insert, never update or delete these rows. */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Explicit historical year for filtering. Null means the operation is not year-scoped. */
    academicYear: integer("academic_year").references(() => academicYears.year),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    index("audit_logs_entity_created_idx").on(table.entityType, table.entityId, table.createdAt),
    index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("audit_logs_year_created_id_idx").on(table.academicYear, table.createdAt, table.id),
  ],
);

/** Short-lived, owner-bound immutable result sets used for grade CSV preview/download. */
export const gradeExportSnapshots = sqliteTable(
  "grade_export_snapshots",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id),
    academicYear: integer("academic_year").notNull().references(() => academicYears.year),
    /** Display-only export scope retained with immutable output rows for PDF headings. */
    scope: text("scope").notNull().default("year_all_students"),
    /** The one permitted output format is fixed when the immutable preview is created. */
    format: text("format").notNull().default("csv"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    /** Atomic download claim: once set, this short-lived snapshot cannot be consumed again. */
    claimId: text("claim_id").unique(),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [index("grade_export_snapshots_owner_expiry_idx").on(table.ownerUserId, table.expiresAt)],
);

export const gradeExportSnapshotRows = sqliteTable(
  "grade_export_snapshot_rows",
  {
    snapshotId: text("snapshot_id").notNull().references(() => gradeExportSnapshots.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    studentNumber: text("student_number").notNull(), studentName: text("student_name").notNull(), academicYear: integer("academic_year").notNull(), term: integer("term").notNull(), courseName: text("course_name").notNull(), gradeLevel: integer("grade_level").notNull(), subjectName: text("subject_name").notNull(), attendanceRate: integer("attendance_rate").notNull(), letterGrade: text("letter_grade").notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.position] })],
);

/** Short-lived, owner-bound confirmation payload for one individual normal CSV import. */
export const importSnapshots = sqliteTable(
  "import_snapshots",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id),
    academicYear: integer("academic_year").notNull().references(() => academicYears.year),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    claimId: text("claim_id").unique(),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [index("import_snapshots_owner_expiry_idx").on(table.ownerUserId, table.expiresAt)],
);

/**
 * A scheduled export first records a stable object-key intent and a short-lived claim.
 * Never store raw bookmarks, signed URLs, tokens, or export contents.
 */
export const backupRuns = sqliteTable(
  "backup_runs",
  {
    id: text("id").primaryKey(),
    scheduledFor: integer("scheduled_for").notNull().unique(),
    status: text("status", { enum: ["pending", "completed", "failed"] }).notNull().default("pending"),
    claimId: text("claim_id").unique(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    objectKey: text("object_key").notNull().unique(),
    bookmarkHash: text("bookmark_hash"),
    etag: text("etag"),
    size: integer("size"),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    failedAt: integer("failed_at", { mode: "timestamp" }),
  },
  (table) => [
    check("backup_runs_status_check", sql`${table.status} IN ('pending', 'completed', 'failed')`),
    check("backup_runs_completed_metadata_check", sql`${table.status} != 'completed' OR (${table.objectKey} IS NOT NULL AND ${table.bookmarkHash} IS NOT NULL AND ${table.etag} IS NOT NULL AND ${table.size} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`),
    index("backup_runs_completed_at_idx").on(table.completedAt),
    index("backup_runs_status_started_idx").on(table.status, table.startedAt),
  ],
);

/** Idempotency records are intentionally separate for normal CSV imports and annual rollover. */
export const idempotencyOperations = sqliteTable(
  "idempotency_operations",
  {
    id: text("id").primaryKey(),
    operationType: text("operation_type", { enum: ["csv_import", "annual_rollover"] }).notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("pending"),
    academicYear: integer("academic_year").references(() => academicYears.year),
    payloadHash: text("payload_hash").notNull(),
    resultJson: text("result_json"),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(unixNow),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(unixNow),
  },
  (table) => [
    check(
      "idempotency_operations_type_check",
      sql`${table.operationType} IN ('csv_import', 'annual_rollover')`,
    ),
    check(
      "idempotency_operations_status_check",
      sql`${table.status} IN ('pending', 'succeeded', 'failed')`,
    ),
    index("idempotency_operations_type_status_idx").on(table.operationType, table.status),
    index("idempotency_operations_year_idx").on(table.academicYear),
    uniqueIndex("idempotency_operations_rollover_success_year_unique")
      .on(table.academicYear)
      .where(sql`${table.operationType} = 'annual_rollover' AND ${table.status} = 'succeeded'`),
  ],
);
