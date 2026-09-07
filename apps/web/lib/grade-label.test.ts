import { describe, expect, it } from "bun:test";

import { displayGrade, gradeLabels } from "./grade-label";

describe("grade display labels", () => {
  it("keeps internal letter codes while presenting the approved Japanese labels", () => {
    expect(gradeLabels).toEqual({ S: "秀", A: "優", B: "良", C: "可", F: "不可" });
    expect(displayGrade("S")).toBe("秀");
    expect(displayGrade("F")).toBe("不可");
    expect(displayGrade(null)).toBe("未算出");
  });
});
