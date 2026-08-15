import { describe, expect, it } from "bun:test";
import { canProceedRollover, createConfirmedRollover, createRolloverSnapshot, createRolloverStepItems, emptyRolloverFiles, getRolloverStepStatus, isConfirmedSnapshotCurrent, isCurrentGeneration, rolloverSteps } from "./rollover-state";

describe("rollover wizard state", () => {
  it("requires a year then the corresponding CSV at each input step", () => {
    expect(rolloverSteps).toHaveLength(7); expect(canProceedRollover(1, "2027", {})).toBeTrue(); expect(canProceedRollover(2, "2027", {})).toBeFalse(); expect(canProceedRollover(2, "2027", { 2: "csv" })).toBeTrue();
  });
  it("marks exactly one current step and distinguishes completed and upcoming work", () => {
    const items = createRolloverStepItems(4);
    expect(items.filter((item) => item.status === "current")).toHaveLength(1);
    expect(items.map((item) => item.status)).toEqual(["completed", "completed", "completed", "current", "upcoming", "upcoming", "upcoming"]);
    expect(items[3]).toMatchObject({ number: 4, label: "2年科目CSV", statusLabel: "現在の工程" });
    expect(getRolloverStepStatus(1, 0)).toBe("current");
    expect(getRolloverStepStatus(7, 6)).toBe("current");
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
