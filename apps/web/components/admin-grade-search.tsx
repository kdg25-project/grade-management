import { useCallback, useEffect, useRef, useState } from "react";

import { ModalDialog } from "@/components/modal-dialog";
import { TeacherShell } from "@/components/teacher-shell";
import { useToast } from "@/components/toast-provider";
import { getAdminCatalog, getAdminMasterSubjects, type AdminCatalogResponse, type AdminSubjectsResponse } from "@/lib/admin-api";
import { adminGradeDraftFromAttempt, adminGradePayload, emptyAdminGradeDraft, isAdminGradeDirty, type AdminGradeDraft } from "@/lib/admin-grade-state";
import { createAdminRetake, correctAdminGrade, GradeApiError, getAdminGradeDetail, getAdminGrades, type AdminGradeDetailResponse, type AdminGradesResponse, type Term } from "@/lib/grade-api";
import { displayGrade, gradeLabels } from "@/lib/grade-label";
import { shouldAllowNavigation, shouldRestoreHistoryOnPopstate } from "@/lib/navigation-guard";
import { isCurrentRequest } from "@/lib/request-generation";

type Letter = "" | "S" | "A" | "B" | "C" | "F";
type GradeLevel = "" | "1" | "2" | "3";
type Filters = { academicYear: string; term: "" | "1" | "2"; courseId: string; gradeLevel: GradeLevel; subjectId: string; studentSearch: string; letterGrade: Letter };
const initialFilters: Filters = { academicYear: "", term: "", courseId: "", gradeLevel: "", subjectId: "", studentSearch: "", letterGrade: "" };
const toNumber = (value: string) => value === "" ? undefined : Number(value);
const toTerm = (value: string): Term | undefined => value === "1" ? 1 : value === "2" ? 2 : undefined;
const toGradeLevel = (value: string): 1 | 2 | 3 | undefined => value === "1" ? 1 : value === "2" ? 2 : value === "3" ? 3 : undefined;
const toLetter = (value: string): Letter => value === "S" || value === "A" || value === "B" || value === "C" || value === "F" ? value : "";
const useMobile = () => { const [mobile, setMobile] = useState(true); useEffect(() => { const query = window.matchMedia("(max-width: 640px)"); const sync = () => setMobile(query.matches); sync(); query.addEventListener("change", sync); return () => query.removeEventListener("change", sync); }, []); return mobile; };

export function AdminGradeSearchPage() {
  const { showError, showSuccess } = useToast();
  const mobile = useMobile();
  const [data, setData] = useState<AdminGradesResponse | null>(null);
  const [catalog, setCatalog] = useState<AdminCatalogResponse | null>(null);
  const [subjects, setSubjects] = useState<AdminSubjectsResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminGradeDetailResponse | null>(null);
  const [draft, setDraft] = useState<AdminGradeDraft>(emptyAdminGradeDraft);
  const [initial, setInitial] = useState<AdminGradeDraft>(emptyAdminGradeDraft);
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState<"correction" | "retake" | null>(null);
  const savingRef = useRef(false);
  const listGeneration = useRef(0); const detailGeneration = useRef(0);
  const listController = useRef<AbortController | null>(null); const detailController = useRef<AbortController | null>(null);
  const dirty = detail !== null && isAdminGradeDirty(draft, initial);
  const guard = useCallback(() => shouldAllowNavigation(dirty, () => window.confirm("未保存の成績があります。移動しますか？"), savingRef.current), [dirty]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  useEffect(() => {
    const onPopstate = () => { if (shouldRestoreHistoryOnPopstate(dirty, () => window.confirm("未保存の成績があります。移動しますか？"), savingRef.current)) window.history.go(1); };
    window.addEventListener("popstate", onPopstate); return () => window.removeEventListener("popstate", onPopstate);
  }, [dirty]);

  const loadCatalog = useCallback(async () => {
    try { const next = await getAdminCatalog(); setCatalog(next); }
    catch (nextError) { setError(nextError instanceof GradeApiError ? nextError.message : "検索条件を読み込めませんでした。"); }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    let live = true;
    void getAdminMasterSubjects(toNumber(filters.academicYear)).then((next) => { if (live) setSubjects(next); }).catch((nextError: unknown) => { if (live) setError(nextError instanceof GradeApiError ? nextError.message : "科目を読み込めませんでした。"); });
    return () => { live = false; };
  }, [filters.academicYear]);
  const load = useCallback(async () => {
    const current = ++listGeneration.current; listController.current?.abort(); const next = new AbortController(); listController.current = next;
    setLoading(true); setError(null);
    try {
      const result = await getAdminGrades({ academicYear: toNumber(filters.academicYear), term: toTerm(filters.term), courseId: filters.courseId || undefined, gradeLevel: toGradeLevel(filters.gradeLevel), subjectId: filters.subjectId || undefined, studentSearch: filters.studentSearch || undefined, letterGrade: filters.letterGrade || undefined, limit: 50 }, next.signal);
      if (isCurrentRequest(current, listGeneration.current)) { setData(result); setFilters((old) => old.academicYear || !result.academicYear ? old : { ...old, academicYear: String(result.academicYear) }); }
    } catch (nextError) { if (!next.signal.aborted && isCurrentRequest(current, listGeneration.current)) setError(nextError instanceof GradeApiError ? nextError.message : "成績を読み込めませんでした。"); }
    finally { if (isCurrentRequest(current, listGeneration.current)) setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); return () => listController.current?.abort(); }, [load]);

  const loadDetail = useCallback(async (id: string, internal = false) => {
    if ((!internal && savingRef.current) || (!internal && dirty && !window.confirm("未保存の成績があります。別の成績を開きますか？"))) return;
    const current = ++detailGeneration.current; detailController.current?.abort(); const next = new AbortController(); detailController.current = next;
    try {
      const result = await getAdminGradeDetail(id, next.signal);
      if (!isCurrentRequest(current, detailGeneration.current)) return;
      const latest = result.attempts[0]; if (!latest) return;
      const nextDraft = adminGradeDraftFromAttempt(latest); setDetail(result); setDraft(nextDraft); setInitial(nextDraft);
    } catch (nextError) { if (!next.signal.aborted && isCurrentRequest(current, detailGeneration.current)) setError(nextError instanceof GradeApiError ? nextError.message : "詳細を読み込めませんでした。"); }
  }, [dirty]);
  useEffect(() => () => detailController.current?.abort(), []);
  const update = (key: keyof AdminGradeDraft, value: string) => { if (!savingRef.current && !mobile) setDraft((current) => ({ ...current, [key]: value })); };
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => { if (!savingRef.current) setFilters((current) => ({ ...current, [key]: value })); };
  async function save(kind: "correction" | "retake") {
    if (!detail || mobile || savingRef.current) return;
    const payload = adminGradePayload(draft); if (!payload) { setError("出席率は0〜100、授業態度・課題は1〜10の整数で、理由を入力してください。"); return; }
    const latest = detail.attempts[0]; if (!latest) return;
    if (kind === "retake" && latest.letterGrade !== "F") { setError("最新評価が不可の場合のみ再試験を登録できます。"); return; }
    savingRef.current = true; setSaving(true); setError(null);
    try {
      if (kind === "retake") await createAdminRetake(latest.id, payload); else await correctAdminGrade(latest.id, payload);
      showSuccess(kind === "retake" ? "再試験の成績を登録しました。" : "最新成績を修正しました。");
      // Internal refresh deliberately bypasses the saving lock: it replaces the
      // draft with the server's new latest attempt before editing is unlocked.
      await loadDetail(latest.id, true); await load();
    } catch (nextError) { showError(nextError instanceof GradeApiError ? nextError.message : "成績を保存できませんでした。"); }
    finally { savingRef.current = false; setSaving(false); }
  }
  const latest = detail?.attempts[0];
  const controlsDisabled = mobile || saving;
  const closeDetail = () => {
    if (saving || (dirty && !window.confirm("未保存の成績があります。閉じますか？"))) return;
    setDetail(null); setPendingSave(null); setError(null);
  };
  return <TeacherShell variant="admin" navigationGuard={guard}>
    <header className="pageHeader"><p className="sectionEyebrow">成績検索・修正</p><h1>成績と再試験履歴を確認する</h1><p>▲はこの科目・学期に確定済みの不可評価履歴がある印です。過去の試行は変更されません。</p></header>
    {mobile ? <p className="readOnlyNotice">スマートフォンでは閲覧のみです。修正・再試験登録はパソコンで行ってください。</p> : null}
    <section className="masterCard"><div className="masterForm"><label>年度<input inputMode="numeric" value={filters.academicYear} disabled={saving} onChange={(event) => setFilter("academicYear", event.target.value)} placeholder="現在年度" /></label><label>学期<select value={filters.term} disabled={saving} onChange={(event) => setFilter("term", event.target.value === "1" || event.target.value === "2" ? event.target.value : "")}><option value="">すべて</option><option value="1">前期</option><option value="2">後期</option></select></label><label>コース<select value={filters.courseId} disabled={saving} onChange={(event) => setFilter("courseId", event.target.value)}><option value="">すべて</option>{catalog?.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label><label>学年<select value={filters.gradeLevel} disabled={saving} onChange={(event) => setFilter("gradeLevel", event.target.value === "1" || event.target.value === "2" || event.target.value === "3" ? event.target.value : "")}><option value="">すべて</option><option value="1">1年</option><option value="2">2年</option><option value="3">3年</option></select></label><label>科目<select value={filters.subjectId} disabled={saving} onChange={(event) => setFilter("subjectId", event.target.value)}><option value="">すべて</option>{subjects?.items.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label>学生検索<input value={filters.studentSearch} disabled={saving} onChange={(event) => setFilter("studentSearch", event.target.value)} placeholder="氏名・学籍番号" /></label><label>評価<select value={filters.letterGrade} disabled={saving} onChange={(event) => setFilter("letterGrade", toLetter(event.target.value))}><option value="">すべて</option>{(["S", "A", "B", "C", "F"] as const).map((value) => <option key={value} value={value}>{gradeLabels[value]}</option>)}</select></label></div><button className="secondaryAction compactAction" type="button" disabled={loading || saving} onClick={() => void load()}>{loading ? "検索中…" : "検索"}</button></section>
    {error ? <p className="formError" role="alert">{error}</p> : null}
    <section className="masterCard"><div className="masterTableWrap"><table className="masterTable"><thead><tr><th>学生</th><th>科目・学期</th><th>最新評価</th><th>操作</th></tr></thead><tbody>{data?.items.map((item) => <tr key={item.id}><td>{item.latest.hasFailedHistory ? <span title="この科目・学期に確定済みの不可評価履歴があります">▲ </span> : null}{item.studentName}<small>{item.studentNumber}</small></td><td>{item.subjectName}・{item.term === 1 ? "前期" : "後期"}</td><td>{item.latest.letterGrade ? displayGrade(item.latest.letterGrade) : "未入力"}</td><td><button className="secondaryAction compactAction" disabled={saving} type="button" onClick={() => void loadDetail(item.latest.id)}>詳細・修正</button></td></tr>)}</tbody></table></div></section>
    <ModalDialog dismissible={!saving} onRequestClose={closeDetail} open={Boolean(detail && latest) && pendingSave === null} title={detail && latest ? `${detail.studentName}さん・${detail.subjectName}の成績を修正` : "成績を修正"}>{detail && latest ? <><p>成績履歴（古い成績は変更できません）</p><ul className="simpleList">{detail.attempts.map((attempt) => <li key={attempt.id}>{attempt.hasFailedHistory ? <span title="この科目・学期に確定済みの不可評価履歴があります">▲ </span> : null}{attempt.attempt}回目: {attempt.letterGrade ? displayGrade(attempt.letterGrade) : "未入力"}</li>)}</ul><div className="masterForm"><label>出席率（0〜100）<input autoFocus inputMode="numeric" disabled={controlsDisabled} value={draft.attendanceRate} onChange={(event) => update("attendanceRate", event.target.value)} /></label><label>授業態度（1〜10）<input inputMode="numeric" disabled={controlsDisabled} value={draft.attitude} onChange={(event) => update("attitude", event.target.value)} /></label><label>課題（1〜10）<input inputMode="numeric" disabled={controlsDisabled} value={draft.assignment} onChange={(event) => update("assignment", event.target.value)} /></label><label>理由<textarea disabled={controlsDisabled} value={draft.reason} onChange={(event) => update("reason", event.target.value)} /></label></div>{error ? <p className="formError" role="alert">{error}</p> : null}<div className="appDialogActions"><button className="secondaryAction compactAction" disabled={saving} type="button" onClick={closeDetail}>閉じる</button><button className="primaryAction compactAction" disabled={controlsDisabled || !dirty} type="button" onClick={() => setPendingSave("correction")}>{saving ? "保存中…" : "最新成績を修正"}</button><button className="secondaryAction compactAction" disabled={controlsDisabled || latest.letterGrade !== "F" || !dirty} type="button" onClick={() => setPendingSave("retake")}>再試験を登録</button></div></> : null}</ModalDialog>
    <ModalDialog dismissible={!saving} onRequestClose={() => { if (!saving) setPendingSave(null); }} open={pendingSave !== null} title={pendingSave === "retake" ? "再試験を登録" : "最新成績を修正"}><p>{pendingSave === "retake" ? "再試験の成績を登録します。" : "最新の成績を修正します。"}理由と入力値を確認して反映してください。</p><div className="appDialogActions"><button className="secondaryAction compactAction" disabled={saving} type="button" onClick={() => setPendingSave(null)}>キャンセル</button><button className="primaryAction compactAction" disabled={saving} type="button" onClick={() => { const kind = pendingSave; setPendingSave(null); if (kind) void save(kind); }}>{saving ? "保存中…" : "反映する"}</button></div></ModalDialog>
  </TeacherShell>;
}
