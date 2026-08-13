import { ArrowRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { destinationForApiError, GradeApiError, getTeacherSubjects, type GradeSubject, type Term } from "@/lib/grade-api";
import { isCurrentRequest } from "@/lib/request-generation";
import { TeacherShell } from "@/components/teacher-shell";

const termLabel = (term: Term) => term === 1 ? "前期" : "後期";
const yearOptions = (current: number) => Array.from({ length: 4 }, (_, index) => current - index);

export function SubjectsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedYear = Number(params.get("year"));
  const [data, setData] = useState<{ currentAcademicYear: number; subjects: GradeSubject[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const requestGeneration = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const year = Number.isInteger(requestedYear) && requestedYear > 2000 ? requestedYear : undefined;

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true); setError(null);
    try { const next = await getTeacherSubjects(year, nextController.signal); if (!isCurrentRequest(generation, requestGeneration.current)) return; setData(next); }
    catch (nextError) { if (nextController.signal.aborted || !isCurrentRequest(generation, requestGeneration.current)) return; setError(nextError); const destination = destinationForApiError(nextError); if (destination) navigate(destination, { replace: true }); }
    finally { if (isCurrentRequest(generation, requestGeneration.current)) setLoading(false); }
  }, [navigate, year]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);

  const selectedYear = data ? year ?? data.currentAcademicYear : year ?? new Date().getFullYear();
  const setYear = (nextYear: number) => navigate(`/teacher/subjects?year=${nextYear}`);

  return <TeacherShell>
    <header className="pageHeader">
      <p className="sectionEyebrow">担当科目</p>
      <h1>成績を入力する科目を選ぶ</h1>
      <p>いま入力すべき学期を確認して、科目を選択してください。</p>
    </header>
    <section className="yearToolbar" aria-label="年度を選択">
      <label htmlFor="teacher-year">表示年度</label>
      <select id="teacher-year" value={selectedYear} onChange={(event) => setYear(Number(event.target.value))} disabled={loading && !data}>
        {yearOptions(data?.currentAcademicYear ?? selectedYear).map((option) => <option key={option} value={option}>{option}年度</option>)}
      </select>
      <span className="toolbarHint">過去3年度まで確認できます。</span>
    </section>
    {loading ? <p className="loadingMessage" role="status">担当科目を読み込んでいます…</p> : null}
    {error ? <section className="errorPanel" role="alert"><strong>担当科目を読み込めませんでした</strong><p>{error instanceof GradeApiError ? error.message : "通信状況を確認してください。"}</p><button className="secondaryAction compactAction" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />再読み込み</button></section> : null}
    {!loading && !error && data?.subjects.length === 0 ? <section className="emptyPanel"><strong>この年度の担当科目はありません</strong><p>年度を切り替えて確認してください。</p></section> : null}
    {!loading && !error && data?.subjects.length ? <section aria-labelledby="subjects-heading"><div className="sectionTitle"><div><p className="sectionEyebrow">{selectedYear}年度</p><h2 id="subjects-heading">担当科目</h2></div><p>前期を確定すると、後期の入力へ切り替わります。</p></div><div className="subjectList">{data.subjects.map((subject) => <SubjectCard key={subject.id} subject={subject} year={selectedYear} />)}</div></section> : null}
  </TeacherShell>;
}

function SubjectCard({ subject, year }: Readonly<{ subject: GradeSubject; year: number }>) {
  const currentTerm = subject.editableTerm;
  const finalizedTerm = subject.termStatuses.filter((status) => status.isFinalized).map((status) => termLabel(status.term)).join("・");
  const status = subject.editable && currentTerm ? `${termLabel(currentTerm)}を入力中` : subject.termStatuses.every((item) => item.isFinalized) ? "すべて確定済み" : "閲覧のみ";
  return <article className={currentTerm ? "subjectCard currentSubject" : "subjectCard"}>
    <div className="subjectStatus"><span className={currentTerm ? "statusIcon current" : "statusIcon"} aria-hidden="true" />{currentTerm ? `いま入力する学期：${termLabel(currentTerm)}` : status}</div>
    <div className="subjectInfo"><h3>{subject.name}</h3><p>{subject.gradeLevel}年生</p><dl><div><dt>年度</dt><dd>{year}年度</dd></div><div><dt>入力学期</dt><dd>{currentTerm ? termLabel(currentTerm) : "なし"}</dd></div><div><dt>確定済み</dt><dd>{finalizedTerm || "なし"}</dd></div></dl><p className="subjectDescription">{status}</p></div>
    <Link className="subjectLink" to={`/teacher/subjects/${subject.id}/grades?year=${year}&term=${currentTerm ?? 1}`}><span>{currentTerm ? "成績表を開く" : "成績を確認する"}</span><ArrowRight aria-hidden="true" /></Link>
  </article>;
}
