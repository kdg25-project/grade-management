import { describe, expect, it } from "bun:test";
import { canProceedRollover, createConfirmedRollover, createRolloverSnapshot, emptyRolloverFiles, isConfirmedSnapshotCurrent, isCurrentGeneration, rolloverSteps } from "./rollover-state";

describe("rollover wizard state", () => {
  it("requires a year then the corresponding CSV at each input step", () => {
    expect(rolloverSteps).toHaveLength(7); expect(canProceedRollover(1, "2027", {})).toBeTrue(); expect(canProceedRollover(2, "2027", {})).toBeFalse(); expect(canProceedRollover(2, "2027", { 2: "csv" })).toBeTrue();
  });
  it("binds confirmation and retry identity to an immutable complete snapshot", () => {
    const files = { ...emptyRolloverFiles(), "2": "teachers", "3": "one", "4": "two", "5": "three", "6": "students" };
    const confirmed = createConfirmedRollover(createRolloverSnapshot("2027", files), { errors: [] });
    expect(isConfirmedSnapshotCurrent(confirmed, createRolloverSnapshot("2027", files))).toBeTrue();
    expect(isConfirmedSnapshotCurrent(confirmed, createRolloverSnapshot("2027", { ...files, "6": "new students" }))).toBeFalse();
    expect(isConfirmedSnapshotCurrent(confirmed, createRolloverSnapshot("2028", files))).toBeFalse();
  });
  it("does not permit stale file or preview generations to update the current draft", () => {
    expect(isCurrentGeneration(3, 3)).toBeTrue(); expect(isCurrentGeneration(2, 3)).toBeFalse();
  });
});
