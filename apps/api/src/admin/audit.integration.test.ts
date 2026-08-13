import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { D1AuditService } from "./audit";

type Bound = { bind(...values: unknown[]): Bound; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> };
const d1For = (database: Database) => ({
  prepare(query: string) { const create = (values: unknown[]): Bound => { const statement = database.query(query) as unknown as { get(...values: unknown[]): unknown; all(...values: unknown[]): unknown; run(...values: unknown[]): { changes: number } }; return { bind: (...next) => create(next), first: async <T>() => statement.get(...values) as T | null, all: async <T>() => ({ results: statement.all(...values) as T[] }), run: async () => ({ meta: { changes: statement.run(...values).changes } }) }; }; return create([]); },
}) as unknown as D1Database;

const setup = () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE user (id text primary key, name text not null);
    CREATE TABLE academic_years (year integer primary key);
    INSERT INTO academic_years VALUES (2025), (2026);
    CREATE TABLE audit_logs (id text primary key, actor_user_id text, action text not null, entity_type text not null, entity_id text not null, academic_year integer, payload_json text, created_at integer not null);
    CREATE TABLE idempotency_operations (id text primary key, operation_type text not null, idempotency_key text not null, status text not null, academic_year integer, payload_hash text not null, result_json text, created_by_user_id text, completed_at integer, created_at integer not null, updated_at integer not null);
    INSERT INTO user VALUES ('admin-1', '山田職員'), ('admin-2', '佐藤職員');
    INSERT INTO audit_logs VALUES
      ('a-older', 'admin-1', 'student_created', 'student', 'student-secret', 2025, '{"studentNumber":"S001","email":"student@example.test"}', 10),
      ('a-newer', 'admin-2', 'student_status_changed', 'student', 'student-secret', 2026, '{"status":"suspended","effectiveAcademicYear":2026,"reason":"健康上の理由"}', 30),
      ('a-year', 'admin-1', 'academic_year_selected', 'academic_year', '2026', 2026, '{"year":2026}', 20),
      ('a-null', 'admin-1', 'teacher_created', 'user', 'teacher-secret', NULL, '{"email":"teacher@example.test"}', 25),
      ('a-staff', 'admin-1', 'staff_status_changed', 'user', 'staff-secret', NULL, '{"status":"leave","role":"admin"}', 26),
      ('a-reset', 'admin-1', 'password_reset_requested', 'user', 'teacher-secret', NULL, '{"role":"teacher"}', 27),
      ('a-grade', 'admin-1', 'grade_retake_created', 'grade', 'grade-secret', 2026, '{"attempt":2,"previousGrade":"F","newGrade":"B"}', 28);
    INSERT INTO idempotency_operations VALUES
      ('op-1', 'csv_import', 'do-not-return-this-key', 'succeeded', 2026, 'secret-hash', '{"processed":12,"email":"secret@example.test"}', 'admin-1', 40, 35, 40),
      ('op-2', 'annual_rollover', 'other-key', 'failed', 2025, 'other-hash', '{"reason":"internal"}', 'admin-2', 50, 45, 50);
  `);
  return { database, service: new D1AuditService(d1For(database)) };
};

describe("D1 audit service", () => {
  it("orders, filters, and keyset-paginates audit logs without returning payload personal data", async () => {
    const { service } = setup();
    const first = await service.logs({ limit: 1, academicYear: 2026 });
    expect(first.nextCursor).toBeString();
    expect(first.items).toEqual([expect.objectContaining({ id: "a-newer", actor: "佐藤職員", summary: "休学に変更（2026年度適用）" })]);
    expect(JSON.stringify(first)).not.toContain("student@example.test");
    expect(JSON.stringify(first)).not.toContain("健康上の理由");
    expect(JSON.stringify(first)).not.toContain("student-secret");
    const second = await service.logs({ limit: 1, academicYear: 2026, cursor: first.nextCursor ?? undefined });
    expect(second.items[0]?.id).toBe("a-grade");
    const byActor = await service.logs({ limit: 20, actorId: "admin-1" });
    expect(byActor.items.map((item) => item.id)).toEqual(["a-grade", "a-reset", "a-staff", "a-null", "a-year", "a-older"]);
    const only2026 = await service.logs({ limit: 20, academicYear: 2026 });
    expect(only2026.items.map((item) => item.id)).toEqual(["a-newer", "a-grade", "a-year"]);
  });

  it("allowlists dedicated-staff audit actions and summarizes them without payload data", async () => {
    const { service } = setup();
    const logs = await service.logs({ limit: 20, action: "staff_status_changed", targetType: "user" });
    expect(logs.items).toEqual([expect.objectContaining({ id: "a-staff", actionLabel: "専任職員状態変更", summary: "専任職員の利用状態を休職に変更", targetLabel: "アカウント" })]);
    expect(JSON.stringify(logs)).not.toContain("staff-secret");
  });

  it("allowlists password-reset requests without returning tokens or email addresses", async () => {
    const { service } = setup();
    const logs = await service.logs({ limit: 20, action: "password_reset_requested" });
    expect(logs.items).toEqual([expect.objectContaining({ id: "a-reset", actionLabel: "パスワード再設定メール送信", summary: "パスワード再設定メールを送信" })]);
    expect(JSON.stringify(logs)).not.toContain("teacher@example.test");
    expect(JSON.stringify(logs)).not.toContain("teacher-secret");
  });

  it("allowlists grade audits with the Japanese grade target label", async () => {
    const { service } = setup();
    const logs = await service.logs({ limit: 20, targetType: "grade" });
    expect(logs.items).toEqual([expect.objectContaining({ id: "a-grade", actionLabel: "再試験成績登録", targetLabel: "成績", summary: "再試験の成績を登録" })]);
    expect(JSON.stringify(logs)).not.toContain("grade-secret");
  });

  it("keeps a stable keyset when a newer audit is inserted between requests", async () => {
    const { database, service } = setup();
    const first = await service.logs({ limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["a-newer", "a-grade"]);
    database.exec("INSERT INTO audit_logs VALUES ('a-latest','admin-1','student_updated','student','new',2026,'{}',99)");
    const second = await service.logs({ limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((item) => item.id)).toEqual(["a-reset", "a-staff"]);
  });

  it("lists only safe idempotency operation summaries with bounded keyset pages", async () => {
    const { service } = setup();
    const result = await service.operations({ limit: 1, academicYear: 2026 });
    expect(result.items).toEqual([expect.objectContaining({ id: "op-1", operationLabel: "CSV取込", statusLabel: "完了", resultSummary: "12件を処理しました" })]);
    expect(JSON.stringify(result)).not.toContain("do-not-return-this-key");
    expect(JSON.stringify(result)).not.toContain("secret@example.test");
    const first = await service.operations({ limit: 1 });
    const second = await service.operations({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect(first.items[0]?.id).toBe("op-2");
    expect(second.items[0]?.id).toBe("op-1");
    await expect(service.logs({ limit: 101 })).rejects.toMatchObject({ code: "INVALID_AUDIT_QUERY" });
    await expect(service.operations({ limit: 20, cursor: "bad!!" })).rejects.toMatchObject({ code: "INVALID_AUDIT_CURSOR" });
  });
});
