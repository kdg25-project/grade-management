"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { TeacherShell } from "@/components/teacher-shell";
import { getAdminAudit, getAdminAuditActors, getAdminAuditOperations, type AuditAction, type AuditLogResponse, type AuditOperationsResponse, type AuditTargetType, type OperationStatus } from "@/lib/admin-api";
import { auditActionOptions, auditTargetOptions, formatAuditTime, operationStatusOptions } from "@/lib/audit-display";
import { destinationForApiError, GradeApiError } from "@/lib/grade-api";
import { isCurrentRequest } from "@/lib/request-generation";
import { useNavigate } from "react-router-dom";

const auditActionFrom = (value: string): AuditAction | "" => auditActionOptions.find((option) => option.value === value)?.value ?? "";
const targetFrom = (value: string): AuditTargetType | "" => auditTargetOptions.find((option) => option.value === value)?.value ?? "";
const operationStatusFrom = (value: string): OperationStatus | "" => operationStatusOptions.find((option) => option.value === value)?.value ?? "";
const inputYear = (value: string) => /^\d{4}$/.test(value) ? Number(value) : undefined;

export function AdminAuditPage() {
  const navigate = useNavigate();
  const [year, setYear] = useState(""); const [action, setAction] = useState<AuditAction | "">(""); const [actorId, setActorId] = useState(""); const [targetType, setTargetType] = useState<AuditTargetType | "">("");
  const [operationStatus, setOperationStatus] = useState<OperationStatus | "">(""); const [auditCursors, setAuditCursors] = useState<Array<string | undefined>>([undefined]); const [operationCursors, setOperationCursors] = useState<Array<string | undefined>>([undefined]);
  const [logs, setLogs] = useState<AuditLogResponse | null>(null); const [operations, setOperations] = useState<AuditOperationsResponse | null>(null); const [actors, setActors] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<unknown>(null);
  const requestGeneration = useRef(0); const controller = useRef<AbortController | null>(null);
  const selectedYear = inputYear(year);
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current; controller.current?.abort(); const nextController = new AbortController(); controller.current = nextController;
    setLoading(true); setError(null);
    try {
      const [nextLogs, nextActors, nextOperations] = await Promise.all([
        getAdminAudit({ cursor: auditCursors.at(-1), academicYear: selectedYear, action: action || undefined, actorId: actorId || undefined, targetType: targetType || undefined }, nextController.signal),
        getAdminAuditActors(nextController.signal),
        getAdminAuditOperations({ cursor: operationCursors.at(-1), academicYear: selectedYear, status: operationStatus || undefined }, nextController.signal),
      ]);
      if (!isCurrentRequest(generation, requestGeneration.current)) return;
      setLogs(nextLogs); setActors(nextActors.items); setOperations(nextOperations);
    } catch (nextError) {
      if (nextController.signal.aborted || !isCurrentRequest(generation, requestGeneration.current)) return;
      setError(nextError); const destination = destinationForApiError(nextError); if (destination) navigate(destination, { replace: true });
    } finally { if (isCurrentRequest(generation, requestGeneration.current)) setLoading(false); }
  }, [action, actorId, auditCursors, navigate, operationCursors, operationStatus, selectedYear, targetType]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  const resetAudit = () => setAuditCursors([undefined]); const resetOperations = () => setOperationCursors([undefined]);
  const nextAudit = () => { const cursor = logs?.nextCursor; if (cursor) setAuditCursors((cursors) => [...cursors, cursor]); };
  const nextOperation = () => { const cursor = operations?.nextCursor; if (cursor) setOperationCursors((cursors) => [...cursors, cursor]); };

  return <TeacherShell variant="admin"><header className="pageHeader"><p className="sectionEyebrow">専任職員</p><h1>監査履歴</h1><p>登録・変更・確定の記録を確認できます。個人情報や操作内容の詳細は表示しません。</p></header>
    <section className="masterCard auditFilterCard" aria-label="監査履歴の絞り込み"><h2>表示条件</h2><div className="masterForm"><label>年度<input inputMode="numeric" pattern="[0-9]{4}" value={year} onChange={(event) => { setYear(event.target.value.replace(/\D/g, "").slice(0, 4)); resetAudit(); resetOperations(); }} placeholder="例: 2026" /></label><label>操作種別<select value={action} onChange={(event) => { setAction(auditActionFrom(event.target.value)); resetAudit(); }}><option value="">すべて</option>{auditActionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>操作者<select value={actorId} onChange={(event) => { setActorId(event.target.value); resetAudit(); }}><option value="">すべて</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label><label>対象<select value={targetType} onChange={(event) => { setTargetType(targetFrom(event.target.value)); resetAudit(); }}><option value="">すべて</option>{auditTargetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>取込・年度更新の状態<select value={operationStatus} onChange={(event) => { setOperationStatus(operationStatusFrom(event.target.value)); resetOperations(); }}><option value="">すべて</option>{operationStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><p className="toolbarHint">条件を変更すると、表示を自動で更新します。</p></section>
    {loading ? <p className="loadingMessage" role="status">監査履歴を読み込んでいます…</p> : null}
    {error ? <section className="errorPanel" role="alert"><strong>監査履歴を読み込めませんでした</strong><p>{error instanceof GradeApiError ? error.message : "通信状況を確認してください。"}</p><button className="secondaryAction compactAction" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />再読み込み</button></section> : null}
    {!loading && !error ? <><section className="masterCard" aria-labelledby="audit-log-heading"><div className="tableToolbar"><h2 id="audit-log-heading">操作履歴</h2><span className="toolbarHint">1回に最大20件を表示</span></div>{logs?.items.length ? <div className="auditList">{logs.items.map((item) => <article className="auditItem" key={item.id}><div><strong>{item.actionLabel}</strong><p>{item.summary}</p></div><dl><div><dt>日時</dt><dd>{formatAuditTime(item.occurredAt)}</dd></div><div><dt>操作者</dt><dd>{item.actor}</dd></div><div><dt>対象</dt><dd>{item.targetLabel}</dd></div></dl></article>)}</div> : <p className="emptyPanel">条件に一致する操作履歴はありません。</p>}<Pagination page={auditCursors.length} hasNext={Boolean(logs?.nextCursor)} loading={loading} onPrevious={() => setAuditCursors((cursors) => cursors.length > 1 ? cursors.slice(0, -1) : cursors)} onNext={nextAudit} /></section>
      <section className="masterCard" aria-labelledby="audit-operation-heading"><div className="tableToolbar"><h2 id="audit-operation-heading">取込・年度更新の履歴</h2><span className="toolbarHint">1回に最大20件を表示</span></div>{operations?.items.length ? <div className="auditList">{operations.items.map((item) => <article className="auditItem" key={item.id}><div><strong>{item.operationLabel}：{item.statusLabel}</strong><p>{item.resultSummary}</p></div><dl><div><dt>開始日時</dt><dd>{formatAuditTime(item.createdAt)}</dd></div><div><dt>対象年度</dt><dd>{item.academicYear ? `${item.academicYear}年度` : "指定なし"}</dd></div><div><dt>完了日時</dt><dd>{item.completedAt ? formatAuditTime(item.completedAt) : "未完了"}</dd></div></dl></article>)}</div> : <p className="emptyPanel">条件に一致する取込・年度更新の履歴はありません。</p>}<Pagination page={operationCursors.length} hasNext={Boolean(operations?.nextCursor)} loading={loading} onPrevious={() => setOperationCursors((cursors) => cursors.length > 1 ? cursors.slice(0, -1) : cursors)} onNext={nextOperation} /></section></> : null}
  </TeacherShell>;
}

function Pagination({ page, hasNext, loading, onPrevious, onNext }: Readonly<{ page: number; hasNext: boolean; loading: boolean; onPrevious: () => void; onNext: () => void }>) {
  return <div className="auditPagination" aria-label="ページ送り"><span>{page}ページ目</span><button className="secondaryAction compactAction" type="button" disabled={loading || page <= 1} onClick={onPrevious}>前へ</button><button className="secondaryAction compactAction" type="button" disabled={loading || !hasNext} onClick={onNext}>次へ</button></div>;
}
