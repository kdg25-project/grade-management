import { describe, expect, it } from "bun:test";
import { auditActionLabels, auditActions, auditEntityTypeLabels, auditEntityTypes } from "@grade-management/api/audit-taxonomy";

import { auditActionOptions, auditTargetOptions, formatAuditTime, operationStatusOptions, pageCount } from "./audit-display";

describe("audit display helpers", () => {
  it("provides Japanese, contract-backed filter choices", () => {
    expect(auditActionOptions.find((option) => option.value === "student_status_changed")?.label).toBe("学生状態変更");
    expect(auditTargetOptions.find((option) => option.value === "subject_term")?.label).toBe("科目・学期");
    expect(operationStatusOptions.find((option) => option.value === "succeeded")?.label).toBe("完了");
  });

  it("covers every API action and target exactly once with the API-owned labels", () => {
    expect(auditActionOptions.map((option) => option.value)).toEqual([...auditActions]);
    expect(auditActionOptions.map((option) => option.label)).toEqual(auditActions.map((action) => auditActionLabels[action]));
    expect(auditTargetOptions.map((option) => option.value)).toEqual([...auditEntityTypes]);
    expect(auditTargetOptions.map((option) => option.label)).toEqual(auditEntityTypes.map((target) => auditEntityTypeLabels[target]));
  });

  it("formats timestamps and page totals without an unbounded page count", () => {
    expect(formatAuditTime(0)).toContain("1970");
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
  });
});
