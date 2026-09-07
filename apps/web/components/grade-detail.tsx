import { ChevronLeft, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { currentTermRedirect, destinationForApiError, GradeApiError, getTeacherGrades, saveTeacherGrades, saveTeacherWeights, type GradeWeights, type Term } from "@/lib/grade-api";
import { canApplyDraftChange, canEditInViewport, canSaveGrades, canSaveWeights, draftHasErrors, draftPayload, fieldLabel, formatScore, hasUnreplacedLegacyValues, needsInitialWeightSave, previewRows, rowsFromStudents, type DraftRow, type GradeField, validateDraftValue, validateWeights } from "@/lib/grade-editor";
import { displayGrade } from "@/lib/grade-label";
import { shouldAllowNavigation } from "@/lib/navigation-guard";
import { isCurrentRequest } from "@/lib/request-generation";
import { TeacherShell } from "@/components/teacher-shell";

const termLabel = (term: Term) => term === 1 ? "前期" : "後期";
const defaultWeights: GradeWeights = { attendanceWeight: 100, attitudeWeight: 0, assignmentWeight: 0 };
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => { const query = window.matchMedia("(max-width: 640px)"); const update = () => setMobile(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  return mobile;
}

export function GradeDetail() {
  const { subjectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const termParam = Number(params.get("term"));
  const term: Term = termParam === 2 ? 2 : 1;
  const yearParam = Number(params.get("year"));
  const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : undefined;
  const mobile = useIsMobile();
  const [data, setData] = useState<Awaited<ReturnType<typeof getTeacherGrades>> | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [weightDraft, setWeightDraft] = useState<GradeWeights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [weightState, setWeightState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [gradesDirty, setGradesDirty] = useState(false);
  const [weightsDirty, setWeightsDirty] = useState(false);
  const savingRef = useRef(false);
  const requestGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const contextKey = `${subjectId ?? ""}:${term}:${year ?? "current"}`;
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const loadedContext = useRef<string | null>(null);

  const load = useCallback(async ({ preserveData = false }: { preserveData?: boolean } = {}) => {
    if (!subjectId) return false;
    const retainCurrentData = preserveData && loadedContext.current === contextKey;
    const generation = ++requestGeneration.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(!retainCurrentData); setError(null); setRefreshError(null);
    try {
      const next = await getTeacherGrades(subjectId, term, year, nextController.signal);
      if (!isCurrentRequest(generation, requestGeneration.current)) return false;
      setData(next); setRows(rowsFromStudents(next.students)); setWeightDraft(next.weights ?? defaultWeights);
      setGradesDirty(false); setWeightsDirty(needsInitialWeightSave(next.weights, next.editable)); loadedContext.current = contextKey;
      return true;
    } catch (nextError) {
      if (nextController.signal.aborted || !isCurrentRequest(generation, requestGeneration.current)) return false;
      const currentTerm = currentTermRedirect(nextError);
      if (currentTerm && subjectId) {
        navigate(`/teacher/subjects/${subjectId}/grades?${new URLSearchParams({ term: String(currentTerm), ...(year ? { year: String(year) } : {}) }).toString()}`, { replace: true });
        return false;
      }
      if (retainCurrentData) setRefreshError(nextError);
      else setError(nextError);
      const destination = destinationForApiError(nextError); if (destination) navigate(destination, { replace: true });
      return false;
    } finally { if (isCurrentRequest(generation, requestGeneration.current)) setLoading(false); }
  }, [contextKey, navigate, subjectId, term, year]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  useEffect(() => {
    if (!gradesDirty && !weightsDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [gradesDirty, weightsDirty]);
  const invalid = draftHasErrors(rows) || hasUnreplacedLegacyValues(rows);
  const editable = canEditInViewport(Boolean(data?.editable), mobile);
  const isSaving = saveState === "saving" || weightState === "saving";
  const weightsNeedSaving = needsInitialWeightSave(data?.weights ?? null, Boolean(data?.editable));
  const gradeEditable = editable && !weightsNeedSaving;
  const displayRows = useMemo(() => weightDraft ? previewRows(rows, weightDraft) : rows, [rows, weightDraft]);
  const dirty = gradesDirty || weightsDirty;
  const updateValue = (studentId: string, field: GradeField, value: string) => { if (weightsNeedSaving || !canApplyDraftChange(isSaving || savingRef.current)) return; setRows((current) => current.map((row) => row.studentId === studentId ? { ...row, values: { ...row.values, [field]: value }, legacyZeroFields: row.legacyZeroFields?.filter((legacyField) => legacyField !== field) } : row)); setGradesDirty(true); setSaveState("idle"); };
  const updateWeight = (field: keyof GradeWeights, value: number) => { if (!canApplyDraftChange(isSaving || savingRef.current) || !weightDraft) return; setWeightDraft({ ...weightDraft, [field]: value }); setWeightsDirty(true); setWeightState("idle"); };
  const confirmDiscard = () => shouldAllowNavigation(dirty, () => window.confirm("未保存の変更があります。移動しますか？"), isSaving || savingRef.current);
  async function save() { if (!subjectId || !data?.editable || mobile || invalid || isSaving || savingRef.current || !canSaveGrades(gradesDirty, weightsDirty, isSaving, !weightsNeedSaving)) return; const savingContext = contextKey; const gradeSnapshot = draftPayload(rows); savingRef.current = true; setSaveState("saving"); setNotice(null); try { await saveTeacherGrades(subjectId, term, gradeSnapshot); if (currentContext.current !== savingContext || loadedContext.current !== savingContext) return; const refreshed = await load({ preserveData: true }); if (currentContext.current !== savingContext) return; if (refreshed) { setSaveState("saved"); setNotice("成績を保存しました。"); } else setSaveState("idle"); } catch (nextError) { if (currentContext.current !== savingContext) return; setSaveState("failed"); setNotice(nextError instanceof GradeApiError ? nextError.message : "保存に失敗しました。入力内容を確認してください。"); } finally { savingRef.current = false; } }
  async function saveWeights() { if (!subjectId || !weightDraft || !data?.editable || mobile || isSaving || savingRef.current || !canSaveWeights(gradesDirty, weightsDirty, isSaving)) return; const validation = validateWeights(weightDraft); if (validation) { setNotice(validation); setWeightState("failed"); return; } const savingContext = contextKey; const weightSnapshot = { ...weightDraft }; savingRef.current = true; setWeightState("saving"); setNotice(null); try { await saveTeacherWeights(subjectId, term, weightSnapshot); if (currentContext.current !== savingContext || loadedContext.current !== savingContext) return; setData((current) => current ? { ...current, weights: weightSnapshot } : current); setWeightState("saved"); setNotice("評価比重を保存しました。成績を再計算しました。"); const refreshed = await load({ preserveData: true }); if (!refreshed && currentContext.current === savingContext) setNotice("評価比重は保存しましたが、最新のデータを読み込めませんでした。同じ内容をもう一度保存するか、再読み込みしてください。"); } catch (nextError) { if (currentContext.current !== savingContext) return; setWeightState("failed"); setNotice(nextError instanceof GradeApiError ? nextError.message : "評価比重の保存に失敗しました。"); } finally { savingRef.current = false; } }

  return <TeacherShell navigationGuard={confirmDiscard}><Link className="backLink" to={year ? `/teacher/subjects?year=${year}` : "/teacher/subjects"} onClick={(event) => { if (!confirmDiscard()) event.preventDefault(); }}><ChevronLeft aria-hidden="true" />担当科目に戻る</Link><header className="pageHeader gradeHeader"><p className="sectionEyebrow">{data?.academicYear ?? year ?? ""}年度 {termLabel(term)}</p><h1>成績表</h1><p>入力対象の学期のみ編集できます。確定済みの成績は閲覧専用です。</p></header>
    {mobile ? <p className="readOnlyNotice" role="note">この画面幅では閲覧専用です。入力・保存はパソコンで行ってください。</p> : null}
    {loading ? <p className="loadingMessage" role="status">成績を読み込んでいます…</p> : null}
    {error ? <section className="errorPanel" role="alert"><strong>成績を読み込めませんでした</strong><p>{error instanceof GradeApiError ? error.message : "通信状況を確認してください。"}</p><button className="secondaryAction compactAction" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />再読み込み</button></section> : null}
    {refreshError && data ? <section className="errorPanel" role="alert"><strong>最新の成績を読み込めませんでした</strong><p>{refreshError instanceof GradeApiError ? refreshError.message : "通信状況を確認して、もう一度お試しください。表示中の内容は保持されています。"}</p><button className="secondaryAction compactAction" type="button" onClick={() => void load({ preserveData: true })}><RefreshCw aria-hidden="true" />再読み込み</button></section> : null}
    {notice ? <p className={saveState === "failed" || weightState === "failed" ? "formError" : "formSuccess"} role={saveState === "failed" || weightState === "failed" ? "alert" : "status"}>{notice}</p> : null}
    {!error && data && loadedContext.current === contextKey ? <><section className="entrySummary" aria-label="入力状況"><div><p className="sectionEyebrow">入力状況</p><p className="summaryNumber"><strong>{displayRows.filter((row) => row.status === "enrolled" && row.values.attendanceRate !== "" && row.values.attitude !== "" && row.values.assignment !== "").length}</strong> / {displayRows.filter((row) => row.status === "enrolled").length} 名の入力がそろっています</p><p className="mutedText">{data.isFinalized ? "確定済みのため、講師は編集できません。" : data.editable ? "変更は保存ボタンで反映されます。" : "過去年度は閲覧専用です。"}</p></div><div className="saveStatus" aria-live="polite"><span className={dirty ? "statusIcon changed" : "statusIcon"} aria-hidden="true" /><div><strong>{dirty ? "未保存の変更があります" : saveState === "saved" ? "保存しました" : "変更はありません"}</strong><p>{saveState === "saving" ? "保存中…" : saveState === "failed" ? "保存できませんでした" : ""}</p></div></div></section>
      <section className="weightPanel" aria-labelledby="weight-heading"><div><p className="sectionEyebrow">評価比重</p><h2 id="weight-heading">成績の計算方法</h2><p>合計100になるように設定します。現在の入力学期のみ変更できます。</p></div>{weightDraft ? <div className="weightControls">{(["attendanceWeight", "attitudeWeight", "assignmentWeight"] as const).map((field) => <label key={field}>{field === "attendanceWeight" ? "出席率" : field === "attitudeWeight" ? "授業態度" : "課題"}<input type="number" min="0" max="100" step="1" value={weightDraft[field]} disabled={!editable || isSaving} onChange={(event) => updateWeight(field, Number(event.target.value))} /><span>%</span></label>)}<button className="secondaryAction compactAction" type="button" disabled={!editable || isSaving || !canSaveWeights(gradesDirty, weightsDirty, isSaving)} onClick={() => void saveWeights()}>{weightState === "saving" ? "保存中…" : weightsNeedSaving ? "初期比重を保存" : "比重を保存"}</button>{weightsNeedSaving ? <p className="inputHint">成績を入力する前に、初期の評価比重を保存してください。</p> : gradesDirty ? <p className="inputHint">先に成績を保存してから、比重を保存してください。</p> : null}</div> : null}</section>
      <div className="desktopGradeEditor"><table className="gradeTable"><caption>学生ごとの成績入力表</caption><thead><tr><th scope="col">学生</th><th scope="col">出席率<br /><span>0〜100</span></th><th scope="col">授業態度<br /><span>1〜10</span></th><th scope="col">課題<br /><span>1〜10</span></th><th scope="col">点数</th><th scope="col">評価</th></tr></thead><tbody>{displayRows.map((row) => <GradeRow key={row.studentId} row={row} editable={gradeEditable} isSaving={isSaving} updateValue={updateValue} />)}</tbody></table></div><div className="mobileGradeViewer" aria-label="成績表の閲覧専用表示">{displayRows.map((row) => <article className={row.status !== "enrolled" ? "gradeCard leaveCard" : "gradeCard"} key={row.studentId}><div><strong>{row.hasFailedHistory ? <span title="この科目・学期には確定済みの不可評価履歴があります">▲ </span> : null}{row.name}</strong><span>{row.studentNumber}</span></div><p>{row.status !== "enrolled" ? "在籍対象外・入力不可" : "閲覧専用"}</p><dl><div><dt>出席率</dt><dd>{row.values.attendanceRate || "未入力"}</dd></div><div><dt>授業態度（1〜10）</dt><dd>{row.values.attitude || "未入力"}</dd></div><div><dt>課題（1〜10）</dt><dd>{row.values.assignment || "未入力"}</dd></div><div><dt>点数・評価</dt><dd>{formatScore(row.score?.finalScoreNumerator, row.score?.finalScoreDenominator)} / {displayGrade(row.score?.letterGrade)}</dd></div></dl></article>)}</div><div className="editorActions"><button className="primaryAction compactAction" type="button" disabled={!gradeEditable || invalid || isSaving || !canSaveGrades(gradesDirty, weightsDirty, isSaving, !weightsNeedSaving)} onClick={() => void save()}><Save aria-hidden="true" />{saveState === "saving" ? "保存中…" : "変更を保存"}</button>{weightsNeedSaving || weightsDirty ? <p className="inputHint">先に評価比重を保存してから、成績を入力・保存してください。</p> : hasUnreplacedLegacyValues(rows) ? <p className="inputHint">過去の0点は表示できますが、保存する前に授業態度・課題を1〜10で入力し直してください。</p> : invalid ? <p className="inputHint">入力エラーを修正してから保存してください。</p> : null}</div></> : null}
  </TeacherShell>;
}

function GradeRow({ row, editable, isSaving, updateValue }: Readonly<{ row: DraftRow; editable: boolean; isSaving: boolean; updateValue: (studentId: string, field: GradeField, value: string) => void }>) {
  return <tr className={row.status !== "enrolled" ? "leaveRow" : undefined}><th scope="row"><strong>{row.hasFailedHistory ? <span title="この科目・学期には確定済みの不可評価履歴があります">▲ </span> : null}{row.name}</strong><span>{row.studentNumber}</span>{row.status !== "enrolled" ? <em>入力対象外</em> : null}</th>{(Object.keys(fieldLabel) as GradeField[]).map((field) => { const value = row.values[field]; const message = row.legacyZeroFields?.includes(field) ? null : validateDraftValue(field, value); const errorId = `grade-${row.studentId}-${field}-error`; return <td key={field}>{editable ? <><input aria-label={`${row.name}の${fieldLabel[field]}`} aria-describedby={message ? errorId : undefined} aria-invalid={Boolean(message)} className={message ? "invalidInput" : undefined} disabled={isSaving || !row.editable || row.status !== "enrolled"} inputMode="numeric" value={value} onChange={(event) => updateValue(row.studentId, field, event.target.value)} />{message ? <span className="inputHint" id={errorId}>{message}</span> : null}</> : <output className="readOnlyCell">{value || "未入力"}</output>}</td>; })}<td><output className="calculationPending">{formatScore(row.score?.finalScoreNumerator, row.score?.finalScoreDenominator)}</output></td><td><output className="calculationPending">{displayGrade(row.score?.letterGrade)}</output></td></tr>;
}
