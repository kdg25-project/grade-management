"use client";

import { useEffect, useRef, useState } from "react";
import { CsvUploadCard } from "@/components/csv-upload-card";
import { TeacherShell } from "@/components/teacher-shell";
import { useToast } from "@/components/toast-provider";
import { applyRollover, previewRollover, type RolloverPreviewResponse } from "@/lib/admin-api";
import { GradeApiError } from "@/lib/grade-api";
import { shouldAllowNavigation } from "@/lib/navigation-guard";
import { canProceedRollover, createConfirmedRollover, createIdempotencyKey, createRolloverSnapshot, createRolloverStepItems, emptyRolloverFiles, emptySkippedRolloverSubjects, isConfirmedSnapshotCurrent, isCurrentGeneration, isSubjectRolloverStep, rolloverSteps, subjectRolloverSteps, type ConfirmedRollover, type RolloverFiles, type RolloverSubjectStep, type SkippedRolloverSubjects } from "@/lib/rollover-state";

const fileKey = (step: number) => ({ 2: "teachersCsv", 3: "grade1SubjectsCsv", 4: "grade2SubjectsCsv", 5: "grade3SubjectsCsv", 6: "newStudentsCsv" } as const)[step];
type Draft = { year: string; files: RolloverFiles; skippedSubjects: SkippedRolloverSubjects };
type FileSlot = keyof RolloverFiles;
const newDraft = (): Draft => ({ year: "", files: emptyRolloverFiles(), skippedSubjects: emptySkippedRolloverSubjects() });
const emptyFileNames = (): Record<FileSlot, string | null> => ({ "2": null, "3": null, "4": null, "5": null, "6": null });
const rolloverStepDescriptions = [
  "新年度を入力して、次の工程へ進みます。",
  "年度更新に含める講師CSVを選択します。",
  "1年科目CSVを選択します。",
  "2年科目CSVを選択します。",
  "3年科目CSVを選択します。",
  "新入生CSVを選択して、全体確認へ進みます。",
  "確認結果を読み、問題がなければ一括反映します。",
] as const;

export function AdminRolloverPage() {
  const { showSuccess } = useToast();
  const [mobile, setMobile] = useState(true); const [step, setStep] = useState(1); const [draft, setDraft] = useState<Draft>(newDraft); const [fileNames, setFileNames] = useState<Record<FileSlot, string | null>>(emptyFileNames); const [confirmed, setConfirmedState] = useState<ConfirmedRollover<RolloverPreviewResponse> | null>(null); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [fileLoading, setFileLoading] = useState<Record<FileSlot, boolean>>({ "2": false, "3": false, "4": false, "5": false, "6": false });
  const draftRef = useRef(draft); const confirmedRef = useRef<ConfirmedRollover<RolloverPreviewResponse> | null>(null); const savingRef = useRef(false); const fileLoadingRef = useRef(fileLoading); const fileReadGeneration = useRef<Record<FileSlot, number>>({ "2": 0, "3": 0, "4": 0, "5": 0, "6": 0 }); const previewGeneration = useRef(0); const controller = useRef<AbortController | null>(null); const stepHeadingRef = useRef<HTMLHeadingElement | null>(null); const previousStepRef = useRef(step);
  const loadingFiles = Object.values(fileLoading).some(Boolean); const busy = saving || loadingFiles;
  const setConfirmed = (value: ConfirmedRollover<RolloverPreviewResponse> | null) => { confirmedRef.current = value; setConfirmedState(value); };
  const invalidateConfirmation = () => { previewGeneration.current += 1; controller.current?.abort(); setConfirmed(null); setError(null); };
  const replaceDraft = (next: Draft) => { draftRef.current = next; setDraft(next); invalidateConfirmation(); };
  const setSlotLoading = (slot: FileSlot, value: boolean) => { fileLoadingRef.current = { ...fileLoadingRef.current, [slot]: value }; setFileLoading(fileLoadingRef.current); };
  const navigationGuard = () => shouldAllowNavigation(Boolean(draft.year || Object.values(draft.files).some(Boolean)), () => window.confirm("入力内容が失われます。移動しますか？"), busy);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { const query = window.matchMedia("(max-width: 640px)"); const update = () => setMobile(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (draft.year || Object.values(draft.files).some(Boolean) || busy) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload); }, [draft, busy]);
  useEffect(() => {
    if (previousStepRef.current === step || typeof window === "undefined") return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  async function loadFile(currentStep: number, file: File | undefined) {
    const slot = String(currentStep) as FileSlot;
    if (!file || savingRef.current || Object.values(fileLoadingRef.current).some(Boolean)) return;
    const generation = fileReadGeneration.current[slot] + 1; fileReadGeneration.current[slot] = generation; invalidateConfirmation(); setSlotLoading(slot, true);
    try {
      const value = await file.text();
      if (!isCurrentGeneration(generation, fileReadGeneration.current[slot])) return;
      if (value.includes("\uFFFD")) throw new Error("UTF-8形式のCSVを選択してください。");
      const current = draftRef.current; replaceDraft({ ...current, files: { ...current.files, [slot]: value }, skippedSubjects: isSubjectRolloverStep(currentStep) ? { ...current.skippedSubjects, [currentStep]: false } : current.skippedSubjects }); setFileNames((currentNames) => ({ ...currentNames, [slot]: file.name }));
    } catch (cause) {
      if (isCurrentGeneration(generation, fileReadGeneration.current[slot])) setError(cause instanceof Error ? cause.message : "CSVを読み込めませんでした。");
    } finally {
      if (isCurrentGeneration(generation, fileReadGeneration.current[slot])) setSlotLoading(slot, false);
    }
  }
  function skipSubjects(currentStep: RolloverSubjectStep) {
    if (mobile || savingRef.current || Object.values(fileLoadingRef.current).some(Boolean)) return;
    const slot = String(currentStep) as FileSlot;
    fileReadGeneration.current[slot] += 1; setSlotLoading(slot, false);
    const current = draftRef.current; replaceDraft({ ...current, files: { ...current.files, [slot]: "" }, skippedSubjects: { ...current.skippedSubjects, [currentStep]: true } }); setFileNames((currentNames) => ({ ...currentNames, [slot]: null })); setStep(currentStep + 1);
  }
  async function validate() {
    if (mobile || savingRef.current || Object.values(fileLoadingRef.current).some(Boolean)) return;
    const current = draftRef.current; if (!canProceedRollover(6, current.year, current.files, current.skippedSubjects)) return;
    const snapshot = createRolloverSnapshot(current.year, current.files, current.skippedSubjects); const generation = previewGeneration.current + 1; previewGeneration.current = generation; controller.current?.abort(); const next = new AbortController(); controller.current = next; savingRef.current = true; setSaving(true); setError(null);
    try {
      const result = await previewRollover(snapshot, next.signal);
      const latest = createRolloverSnapshot(draftRef.current.year, draftRef.current.files, draftRef.current.skippedSubjects);
      if (isCurrentGeneration(generation, previewGeneration.current) && isConfirmedSnapshotCurrent(createConfirmedRollover(snapshot, result), latest)) { setConfirmed(createConfirmedRollover(snapshot, result)); setStep(7); }
    } catch (cause) {
      if (isCurrentGeneration(generation, previewGeneration.current) && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof GradeApiError ? cause.message : "確認に失敗しました。");
    } finally {
      if (isCurrentGeneration(generation, previewGeneration.current)) { savingRef.current = false; setSaving(false); }
    }
  }
  async function apply() {
    if (mobile || savingRef.current || Object.values(fileLoadingRef.current).some(Boolean)) return;
    const current = confirmedRef.current; const latest = createRolloverSnapshot(draftRef.current.year, draftRef.current.files, draftRef.current.skippedSubjects);
    if (!current || !isConfirmedSnapshotCurrent(current, latest)) { setError("入力内容が変わりました。全体を確認し直してください。"); return; }
    if (current.preview.errors.length || !window.confirm("年度更新を一括反映します。続けますか？")) return;
    const idempotencyKey = current.idempotencyKey ?? createIdempotencyKey(); const request = { ...current.snapshot, idempotencyKey }; const retryable = { ...current, idempotencyKey }; setConfirmed(retryable); savingRef.current = true; setSaving(true); setError(null);
    try {
      await applyRollover(request); const reset = newDraft(); draftRef.current = reset; setDraft(reset); setFileNames(emptyFileNames()); setConfirmed(null); setStep(1); showSuccess("年度更新を反映しました。");
    } catch (cause) { setError(cause instanceof GradeApiError ? cause.message : "反映に失敗しました。入力内容は保持されています。");
    } finally { savingRef.current = false; setSaving(false); }
  }

  const keyForFile = fileKey(step); const preview = confirmed?.preview; const stepItems = createRolloverStepItems(step); const currentStep = stepItems[step - 1]; const subjectStep = isSubjectRolloverStep(step) ? step : null; const skippedSubjectGrades = subjectRolloverSteps.filter((subjectStep) => draft.skippedSubjects[subjectStep]).map((subjectStep) => subjectStep - 2);
  return <TeacherShell variant="admin" navigationGuard={navigationGuard}>
    <header className="pageHeader"><p className="sectionEyebrow">専任職員</p><h1>年度更新ウィザード</h1><p>CSVを順番に確認してから、一度だけまとめて反映します。</p></header>
    {mobile ? <p className="readOnlyNotice">スマートフォンでは閲覧のみです。年度更新はパソコンで行ってください。</p> : null}
    <ol className="rolloverStepper" aria-label="年度更新の工程">
      {stepItems.map((item) => <li className={`rolloverStep rolloverStep-${item.status}`} aria-current={item.status === "current" ? "step" : undefined} key={item.label}>
        <span className="rolloverStepNumber" aria-hidden="true">{item.number}</span>
        <span className="rolloverStepCopy"><span className="rolloverStepLabel">{item.label}</span><span className="rolloverStepStatus">{item.statusLabel}</span></span>
      </li>)}
    </ol>
    <section className="rolloverCard" aria-label="現在の工程の入力">
      <header className="rolloverCardHeader"><p className="sectionEyebrow">工程 {currentStep.number} / {rolloverSteps.length}</p><h2 id="rollover-step-heading" ref={stepHeadingRef} tabIndex={-1}>{currentStep.label}</h2><p>{rolloverStepDescriptions[step - 1]}</p></header>
      <div className="rolloverCardBody">
        {error ? <p className="formError" role="alert">{error}</p> : null}
        {step === 1 ? <label className="rolloverField">新年度<input value={draft.year} inputMode="numeric" disabled={mobile || busy} onChange={(event) => { if (!savingRef.current && !Object.values(fileLoadingRef.current).some(Boolean)) replaceDraft({ ...draftRef.current, year: event.target.value.replace(/\D/g, "").slice(0, 4) }); }} placeholder="例: 2027" /></label> : null}
        {keyForFile ? <div className="rolloverField"><span>{rolloverSteps[step - 1]}</span><CsvUploadCard label={rolloverSteps[step - 1]} disabled={mobile || busy} loaded={Boolean(draft.files[String(step) as FileSlot])} loading={fileLoading[String(step) as FileSlot]} selectedFileName={fileNames[String(step) as FileSlot]} onInvalidSelection={() => setError("CSVファイルは1件のみ選択してください。")} onSelectFile={(file) => void loadFile(step, file)} />{subjectStep ? <><p className="rolloverInputHint">科目を後から登録する場合はスキップできます。</p>{draft.skippedSubjects[subjectStep] ? <p className="rolloverInputHint">{subjectStep - 2}年の科目登録をスキップしています。</p> : null}<button className="secondaryAction compactAction" type="button" disabled={mobile || busy} onClick={() => skipSubjects(subjectStep)}>スキップ</button></> : null}</div> : null}
        {saving ? <p className="rolloverBusy" role="status">{step === 6 ? "入力内容を確認しています。" : "年度更新を反映しています。"}</p> : null}
        {step === 7 ? <>{preview ? <div className="auditList"><p>卒業候補: {preview.graduationCandidates}名 / 講師: {preview.teacherCount}名 / 新入生: {preview.studentCount}名</p><p>科目: 1年 {preview.subjectCounts[1]}件、2年 {preview.subjectCounts[2]}件、3年 {preview.subjectCounts[3]}件</p>{skippedSubjectGrades.length ? <p>スキップ: {skippedSubjectGrades.map((grade) => `${grade}年`).join("、")}の科目は登録しません。</p> : null}{preview.errors.length ? <ul>{preview.errors.map((item, index) => <li key={`${item.file}-${index}`}>{item.file} {item.row ? `${item.row}行目` : ""}：{item.reason}</li>)}</ul> : <p className="formSuccess">問題ありません。反映できます。</p>}</div> : <p className="rolloverBusy" role="status">内容を確認しています。</p>}</> : null}
      </div>
      <div className="rolloverActions">
        {step > 1 ? <button className="secondaryAction compactAction" type="button" disabled={mobile || busy} onClick={() => { if (!busy) setStep((value) => value - 1); }}>戻る</button> : null}
        {step < 6 ? <button className="primaryAction compactAction" type="button" disabled={mobile || busy || !canProceedRollover(step, draft.year, draft.files, draft.skippedSubjects)} onClick={() => { if (!busy) setStep((value) => value + 1); }}>次へ</button> : null}
        {step === 6 ? <button className="primaryAction compactAction" type="button" disabled={mobile || busy || !canProceedRollover(step, draft.year, draft.files, draft.skippedSubjects)} onClick={() => void validate()}>全体を確認する</button> : null}
        {step === 7 ? <button className="primaryAction compactAction" type="button" disabled={mobile || busy || !preview || Boolean(preview.errors.length) || !isConfirmedSnapshotCurrent(confirmed, createRolloverSnapshot(draft.year, draft.files, draft.skippedSubjects))} onClick={() => void apply()}>{saving ? "反映中…" : "一括反映する"}</button> : null}
      </div>
    </section>
  </TeacherShell>;
}
