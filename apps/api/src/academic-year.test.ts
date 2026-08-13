import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { ensureCurrentAcademicYear, schoolYearAt } from "./academic-year";

type Bound = { bind(...values: unknown[]): Bound; first<T>(): Promise<T | null>; run(): Promise<{ meta: { changes: number } }> };
const d1For = (database: Database) => ({
  prepare(query: string) {
    const create = (values: unknown[]): Bound => {
      const statement = database.query(query) as unknown as { get(...items: unknown[]): unknown; run(...items: unknown[]): { changes: number } };
      return { bind: (...next) => create(next), first: async <T>() => statement.get(...values) as T | null, run: async () => ({ meta: { changes: statement.run(...values).changes } }) };
    };
    return create([]);
  },
}) as unknown as D1Database;

const setup = () => {
  const database = new Database(":memory:");
  database.exec("CREATE TABLE academic_years (year integer primary key, is_current integer not null); CREATE UNIQUE INDEX current_year ON academic_years(is_current) WHERE is_current=1;");
  return { database, d1: d1For(database) };
};

describe("academic year initialization", () => {
  it("uses the April 1 boundary in Asia/Tokyo", () => {
    expect(schoolYearAt(new Date("2026-03-31T14:59:59.999Z"))).toBe(2025);
    expect(schoolYearAt(new Date("2026-03-31T15:00:00.000Z"))).toBe(2026);
  });

  it("initializes once and preserves a dedicated-staff selection", async () => {
    const { database, d1 } = setup();
    const clock = () => new Date("2026-04-01T00:00:00+09:00");
    expect(await ensureCurrentAcademicYear(d1, clock)).toBe(2026);
    expect(await ensureCurrentAcademicYear(d1, () => new Date("2027-04-01T00:00:00+09:00"))).toBe(2026);
    database.exec("UPDATE academic_years SET is_current=0; INSERT INTO academic_years VALUES(2030,1)");
    expect(await ensureCurrentAcademicYear(d1, clock)).toBe(2030);
    expect(database.query("SELECT year FROM academic_years WHERE is_current=1").get()).toEqual({ year: 2030 });
  });

  it("is idempotent under concurrent empty-database initializers", async () => {
    const { database, d1 } = setup();
    const clock = () => new Date("2026-04-01T00:00:00+09:00");
    const results = await Promise.all(Array.from({ length: 8 }, () => ensureCurrentAcademicYear(d1, clock)));
    expect(results).toEqual(Array(8).fill(2026));
    expect(database.query("SELECT count(*) AS count FROM academic_years WHERE is_current=1").get()).toEqual({ count: 1 });
  });
});
