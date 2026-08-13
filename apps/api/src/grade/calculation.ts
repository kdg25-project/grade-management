export type GradeInputs = {
  attendanceRate: number | null;
  attitude: number | null;
  assignment: number | null;
};

export type GradeWeights = {
  attendanceWeight: number;
  attitudeWeight: number;
  assignmentWeight: number;
};

export type LetterGrade = "S" | "A" | "B" | "C" | "F";

export class GradeValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const integerInRange = (value: number, minimum: number, maximum: number, code: string, label: string) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GradeValidationError(code, `${label}は${minimum}〜${maximum}の整数で入力してください。`);
  }
};

export const validateGradeInputs = (inputs: GradeInputs) => {
  if (inputs.attendanceRate !== null) integerInRange(inputs.attendanceRate, 0, 100, "INVALID_ATTENDANCE_RATE", "出席率");
  if (inputs.attitude !== null) integerInRange(inputs.attitude, 0, 10, "INVALID_ATTITUDE", "平常点");
  if (inputs.assignment !== null) integerInRange(inputs.assignment, 0, 10, "INVALID_ASSIGNMENT", "課題点");
};

export const validateGradeWeights = (weights: GradeWeights) => {
  integerInRange(weights.attendanceWeight, 0, 100, "INVALID_ATTENDANCE_WEIGHT", "出席率の比重");
  integerInRange(weights.attitudeWeight, 0, 100, "INVALID_ATTITUDE_WEIGHT", "平常点の比重");
  integerInRange(weights.assignmentWeight, 0, 100, "INVALID_ASSIGNMENT_WEIGHT", "課題点の比重");
  if (weights.attendanceWeight + weights.attitudeWeight + weights.assignmentWeight !== 100) {
    throw new GradeValidationError("INVALID_WEIGHT_TOTAL", "評価比重の合計を100にしてください。");
  }
};

export const letterGradeForNumerator = (numerator: number): LetterGrade => {
  if (numerator >= 9_000) return "S";
  if (numerator >= 8_000) return "A";
  if (numerator >= 7_000) return "B";
  if (numerator >= 6_000) return "C";
  return "F";
};

export type CalculatedGrade = { finalScoreNumerator: number; finalScoreDenominator: 100; letterGrade: LetterGrade };

/**
 * Scores are persisted as an exact numerator over 100. This deliberately avoids rounding;
 * an incomplete draft has no final score or letter grade.
 */
export const calculateGrade = (inputs: GradeInputs, weights: GradeWeights): CalculatedGrade | null => {
  validateGradeInputs(inputs);
  validateGradeWeights(weights);
  if (inputs.attendanceRate === null || inputs.attitude === null || inputs.assignment === null) return null;

  const finalScoreNumerator =
    inputs.attendanceRate * weights.attendanceWeight +
    inputs.attitude * 10 * weights.attitudeWeight +
    inputs.assignment * 10 * weights.assignmentWeight;

  return { finalScoreNumerator, finalScoreDenominator: 100, letterGrade: letterGradeForNumerator(finalScoreNumerator) };
};
