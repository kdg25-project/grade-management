export type Clock = () => Date;

const currentRow = async (database: D1Database) => database.prepare("SELECT year FROM academic_years WHERE is_current=1 LIMIT 1").first<{ year: number }>();

/** Japan's school year begins on April 1, independent of the Worker timezone. */
export const schoolYearAt = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error("Unable to determine the Japan school year");
  return month < 4 ? year - 1 : year;
};

/**
 * Creates the initial automatic academic year only while no administrative
 * current-year selection exists. The partial unique index resolves competing
 * initializers; after a contention error we read the winning row.
 */
export const ensureCurrentAcademicYear = async (database: D1Database, clock: Clock = () => new Date()) => {
  const existing = await currentRow(database);
  if (existing) return Number(existing.year);

  const candidate = schoolYearAt(clock());
  try {
    await database.prepare(`
      INSERT INTO academic_years (year, is_current)
      SELECT ?, 1
      WHERE NOT EXISTS (SELECT 1 FROM academic_years WHERE is_current=1)
      ON CONFLICT(year) DO UPDATE SET is_current = CASE
        WHEN NOT EXISTS (SELECT 1 FROM academic_years WHERE is_current=1) THEN 1
        ELSE academic_years.is_current
      END
    `).bind(candidate).run();
  } catch (error) {
    const winner = await currentRow(database);
    if (winner) return Number(winner.year);
    throw error;
  }

  const winner = await currentRow(database);
  if (winner) return Number(winner.year);
  throw new Error("Unable to initialize the current academic year");
};
