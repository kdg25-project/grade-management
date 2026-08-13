/** API-owned audit filter contract. Keep labels here so the Web filter cannot drift. */
export const auditActions = [
  "academic_year_selected", "annual_rollover_applied", "csv_imported", "grades_exported", "grades_pdf_exported",
  "student_created", "student_updated", "student_status_changed", "teacher_created",
  "teacher_status_changed", "staff_created", "staff_status_changed", "password_reset_requested",
  "grade_corrected", "grade_retake_created", "subject_created", "subject_updated",
  "subject_term_finalized", "subject_term_reopened",
] as const;
export type AuditAction = typeof auditActions[number];
export const auditActionLabels: Record<AuditAction, string> = {
  academic_year_selected: "年度を設定", annual_rollover_applied: "年度更新", csv_imported: "通常CSV取込", grades_exported: "成績CSV出力", grades_pdf_exported: "成績PDF出力",
  student_created: "学生登録", student_updated: "学生更新", student_status_changed: "学生状態変更", teacher_created: "講師登録",
  teacher_status_changed: "講師状態変更", staff_created: "専任職員登録", staff_status_changed: "専任職員状態変更", password_reset_requested: "パスワード再設定メール送信",
  grade_corrected: "成績修正", grade_retake_created: "再試験成績登録", subject_created: "科目登録", subject_updated: "科目更新",
  subject_term_finalized: "成績確定", subject_term_reopened: "成績再開",
};

export const auditEntityTypes = ["academic_year", "student", "user", "subject", "subject_term", "grade", "grade_export", "csv_import"] as const;
export type AuditEntityType = typeof auditEntityTypes[number];
export const auditEntityTypeLabels: Record<AuditEntityType, string> = {
  academic_year: "年度", student: "学生", user: "アカウント", subject: "科目", subject_term: "科目・学期", grade: "成績", grade_export: "成績出力", csv_import: "通常CSV",
};
