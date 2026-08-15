import { FolderPlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";

import { destinationForApiError, GradeApiError, finalizeSubject, getAdminSubjects, reopenSubject, type AdminSubject, type Term } from "@/lib/grade-api";
import { isCurrentRequest } from "@/lib/request-generation";
import { canPerformDesktopAction, mobileReadOnlyMessage, useMobileReadOnly } from "@/lib/mobile-read-only";
import { TeacherShell } from "@/components/teacher-shell";
import { emptyDashboardActions } from "@/lib/admin-dashboard-model";

const termLabel = (term: Term) => term === 1 ? "前期" : "後期";
const yearOptions = (current: number) => Array.from({ length: 4 }, (_, index) => current - index);

export function AdminDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedYear = Number(params.get("year"));
  const year = Number.isInteger(requestedYear) && requestedYear > 2000 ? requestedYear : undefined;
  const [data, setData] = useState<{ currentAcademicYear: number; subjects: AdminSubject[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { mobile, mobileRef } = useMobileReadOnly();
  const requestGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => { const generation = ++requestGeneration.current; controller.current?.abort(); const nextController = new AbortController(); controller.current = nextController; setLoading(true); setError(null); try { const next = await getAdminSubjects(year, nextController.signal); if (!isCurrentRequest(generation, requestGeneration.current)) return; setData(next); } catch (nextError) { if (nextController.signal.aborted || !isCurrentRequest(generation, requestGeneration.current)) return; setError(nextError); const destination = destinationForApiError(nextError); if (destination) navigate(destination, { replace: true }); } finally { if (isCurrentRequest(generation, requestGeneration.current)) setLoading(false); } }, [navigate, year]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  const selectedYear = data ? year ?? data.currentAcademicYear : year ?? new Date().getFullYear();

  async function finalize(subject: AdminSubject, term: Term) {
    if (!canPerformDesktopAction(mobileRef.current, pending !== null)) { setNotice(mobileRef.current ? mobileReadOnlyMessage : "処理が完了するまでお待ちください。"); return; }
    const completion = subject.completion[term];
    if (completion.complete < completion.eligible) { setNotice(`${termLabel(term)}は${completion.eligible - completion.complete}名が未入力のため確定できません。`); return; }
    if (!window.confirm(`${subject.name}の${termLabel(term)}を確定します。\n確定後、講師は編集できません。続けますか？`)) return;
    setPending(`${subject.id}-${term}`); setNotice(null);
    try { await finalizeSubject(subject.id, term); setNotice(`${subject.name}の${termLabel(term)}を確定しました。`); await load(); } catch (nextError) { setNotice(nextError instanceof GradeApiError ? nextError.message : "確定処理に失敗しました。"); } finally { setPending(null); }
  }
  async function reopen(subject: AdminSubject, term: Term) {
    if (!canPerformDesktopAction(mobileRef.current, pending !== null)) { setNotice(mobileRef.current ? mobileReadOnlyMessage : "処理が完了するまでお待ちください。"); return; }
    const reason = window.prompt(`${subject.name}の${termLabel(term)}を再開する理由を入力してください。`);
    if (!reason?.trim()) { setNotice("再開理由を入力してください。"); return; }
    setPending(`${subject.id}-${term}`); setNotice(null);
    try { await reopenSubject(subject.id, term, reason.trim()); setNotice(`${subject.name}の${termLabel(term)}を再開しました。`); await load(); } catch (nextError) { setNotice(nextError instanceof GradeApiError ? nextError.message : "再開処理に失敗しました。"); } finally { setPending(null); }
  }

  return <TeacherShell variant="admin"><header className="pageHeader dashboardHeader"><div><p className="sectionEyebrow">専任職員</p><h1>成績管理ダッシュボード</h1><p>年度と科目を確認して、学期ごとの成績確定を進めます。</p></div><Link className="secondaryAction compactAction headerAction" to="/admin/grades">成績を検索・修正</Link></header>
    {mobile ? <p className="readOnlyNotice">{mobileReadOnlyMessage} 成績の確定・再開はできません。</p> : null}
    <section className="yearToolbar" aria-labelledby="admin-year-heading"><div className="yearToolbarIntro"><p className="sectionEyebrow">対象年度</p><h2 id="admin-year-heading">表示する年度を選択</h2><p>成績の確定・再開は現在年度のみで行えます。</p></div><div className="yearSelector"><label htmlFor="admin-year">表示年度</label><select id="admin-year" value={selectedYear} onChange={(event) => navigate(`/admin?year=${event.target.value}`)} disabled={loading && !data}>{yearOptions(data?.currentAcademicYear ?? selectedYear).map((option) => <option key={option} value={option}>{option}年度</option>)}</select></div></section>
    <section className="termGuide" aria-labelledby="term-guide-heading"><div><p className="sectionEyebrow">確定の流れ</p><h2 id="term-guide-heading">前期から順に確認します</h2></div><ol><li><span>1</span><div><strong>入力状況を確認</strong><p>未入力の学生がいないか確認します。</p></div></li><li><span>2</span><div><strong>前期を確定</strong><p>確定後は講師が編集できません。</p></div></li><li><span>3</span><div><strong>後期を確認・確定</strong><p>前期確定後に後期の入力が始まります。</p></div></li></ol></section>
    {notice ? <p className="formSuccess" role="status">{notice}</p> : null}
    {loading ? <p className="loadingMessage" role="status">科目の確定状況を読み込んでいます…</p> : null}
    {error ? <section className="errorPanel" role="alert"><strong>ダッシュボードを読み込めませんでした</strong><p>{error instanceof GradeApiError ? error.message : "通信状況を確認してください。"}</p><button className="secondaryAction compactAction" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />再読み込み</button></section> : null}
    {!loading && !error && data?.subjects.length === 0 ? <section className="emptyPanel dashboardEmptyPanel"><FolderPlus aria-hidden="true" /><div><h2>この年度には科目がまだ登録されていません</h2><p>科目を登録すると、担当講師の成績入力と学期ごとの確定を開始できます。</p><div className="emptyActions">{emptyDashboardActions.map((action) => <Link className={`${action.tone}Action compactAction`} key={action.to} to={action.to}>{action.label}</Link>)}</div></div></section> : null}
    {!loading && !error && data?.subjects.length ? <section className="adminSubjectList" aria-label="科目別の確定状況">{data.subjects.map((subject) => <article className="adminSubjectCard" key={subject.id}><div><p className="sectionEyebrow">{subject.gradeLevel}年生</p><h2>{subject.name}</h2></div><div className="adminTerms">{([1, 2] as Term[]).map((term) => { const status = subject.termStatuses.find((item) => item.term === term)?.isFinalized ?? false; const completion = subject.completion[term]; const actionKey = `${subject.id}-${term}`; const actionLabel = `${subject.name}の${termLabel(term)}を${status ? "再開" : "確定"}する`; return <div className="adminTerm" key={term}><div><strong>{termLabel(term)}</strong><span>{status ? "確定済み" : `${completion.complete} / ${completion.eligible}名入力済み`}</span></div>{subject.academicYear === data.currentAcademicYear ? <div className="adminActions">{status ? <button className="secondaryAction compactAction" aria-label={actionLabel} disabled={mobile || pending === actionKey} type="button" onClick={() => void reopen(subject, term)}>再開する</button> : <button className="primaryAction compactAction" aria-label={actionLabel} disabled={mobile || pending === actionKey} type="button" onClick={() => void finalize(subject, term)}>{pending === actionKey ? "処理中…" : "確定する"}</button>}</div> : null}</div>; })}</div></article>)}</section> : null}
  </TeacherShell>;
}
