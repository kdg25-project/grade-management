export const rolloverSteps = ["新年度と卒業候補", "講師CSV", "1年科目CSV", "2年科目CSV", "3年科目CSV", "新入生CSV", "確認・反映"] as const;
export const subjectRolloverSteps = [3, 4, 5] as const;
export type RolloverSubjectStep = (typeof subjectRolloverSteps)[number];
export type SkippedRolloverSubjects = Record<RolloverSubjectStep, boolean>;
export const emptySubjectRolloverCsv = "専攻,科目名,担当講師\r\n";

export type RolloverStepStatus = "completed" | "current" | "upcoming";
export type RolloverStepItem = { number: number; label: (typeof rolloverSteps)[number]; status: RolloverStepStatus; statusLabel: string };

const rolloverStepStatusLabel: Record<RolloverStepStatus, string> = {
  completed: "完了",
  current: "現在の工程",
  upcoming: "これから",
};

export const getRolloverStepStatus = (currentStep: number, index: number): RolloverStepStatus => {
  const number = index + 1;
  if (number < currentStep) return "completed";
  if (number === currentStep) return "current";
  return "upcoming";
};

export const createRolloverStepItems = (currentStep: number): RolloverStepItem[] => rolloverSteps.map((label, index) => {
  const status = getRolloverStepStatus(currentStep, index);
  return { number: index + 1, label, status, statusLabel: rolloverStepStatusLabel[status] };
});

export type RolloverFiles = Record<"2" | "3" | "4" | "5" | "6", string>;
export type RolloverSnapshot = {
  targetYear: number;
  teachersCsv: string;
  grade1SubjectsCsv: string;
  grade2SubjectsCsv: string;
  grade3SubjectsCsv: string;
  newStudentsCsv: string;
};

export const emptyRolloverFiles = (): RolloverFiles => ({ "2": "", "3": "", "4": "", "5": "", "6": "" });
export const emptySkippedRolloverSubjects = (): SkippedRolloverSubjects => ({ 3: false, 4: false, 5: false });
export const isSubjectRolloverStep = (step: number): step is RolloverSubjectStep => subjectRolloverSteps.some((subjectStep) => subjectStep === step);
export const canProceedRollover = (step: number, targetYear: string, files: Record<string, string>, skippedSubjects: SkippedRolloverSubjects = emptySkippedRolloverSubjects()) => step === 1 ? /^\d{4}$/.test(targetYear) : isSubjectRolloverStep(step) ? Boolean(files[String(step)]) || skippedSubjects[step] : step >= 2 && step <= 6 ? Boolean(files[String(step)]) : true;

/** Keeps exactly the same field order as the API request and is safe to compare. */
export const createRolloverSnapshot = (targetYear: string, files: RolloverFiles, skippedSubjects: SkippedRolloverSubjects = emptySkippedRolloverSubjects()): RolloverSnapshot => ({
  targetYear: Number(targetYear), teachersCsv: files["2"], grade1SubjectsCsv: skippedSubjects[3] ? emptySubjectRolloverCsv : files["3"], grade2SubjectsCsv: skippedSubjects[4] ? emptySubjectRolloverCsv : files["4"], grade3SubjectsCsv: skippedSubjects[5] ? emptySubjectRolloverCsv : files["5"], newStudentsCsv: files["6"],
});
const canonicalSnapshot = (snapshot: RolloverSnapshot) => JSON.stringify(snapshot);

/** Deterministic UI identity only; server-side SHA-256 remains the authority. */
export const rolloverFingerprint = (snapshot: RolloverSnapshot) => {
  let hash = 2_166_136_261;
  for (const char of canonicalSnapshot(snapshot)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16_777_619); }
  return `${snapshot.targetYear}:${(hash >>> 0).toString(16)}`;
};
export const sameRolloverSnapshot = (left: RolloverSnapshot, right: RolloverSnapshot) => canonicalSnapshot(left) === canonicalSnapshot(right);
export type ConfirmedRollover<TPreview> = { snapshot: RolloverSnapshot; fingerprint: string; preview: TPreview; idempotencyKey: string | null };
export const createConfirmedRollover = <TPreview>(snapshot: RolloverSnapshot, preview: TPreview): ConfirmedRollover<TPreview> => ({ snapshot, fingerprint: rolloverFingerprint(snapshot), preview, idempotencyKey: null });
export const isConfirmedSnapshotCurrent = <TPreview>(confirmed: ConfirmedRollover<TPreview> | null, draft: RolloverSnapshot) => Boolean(confirmed && confirmed.fingerprint === rolloverFingerprint(draft) && sameRolloverSnapshot(confirmed.snapshot, draft));

/** Async responses are committed only by the request/read generation that started them. */
export const isCurrentGeneration = (started: number, current: number) => started === current;
export const createIdempotencyKey = () => crypto.randomUUID().replaceAll("-", "");
