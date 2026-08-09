"use client";

import { useMemo, useState } from "react";

import {
  getEntryProgress,
  isGradeInputFormat,
  isGradeInputInRange,
  prototypeGradeRows,
  type GradeInput,
  type StudentGradeRow,
} from "@/lib/prototype-grade-data";

const fieldLabels: Record<keyof GradeInput, string> = {
  attendanceRate: "出席率（0〜100）",
  attitude: "態度（1〜10）",
  assignment: "課題（1〜10）",
};

export function GradeEntryTable() {
  const [rows, setRows] = useState<StudentGradeRow[]>(prototypeGradeRows);
  const [hasLocalChanges, setHasLocalChanges] = useState(false);
  const progress = useMemo(() => getEntryProgress(rows), [rows]);

  function updateInput(
    studentNumber: string,
    field: keyof GradeInput,
    value: string,
  ) {
    if (!isGradeInputFormat(field, value)) return;

    setRows((currentRows) =>
      currentRows.map((row) =>
        row.studentNumber === studentNumber
          ? { ...row, input: { ...row.input, [field]: value } }
          : row,
      ),
    );
    setHasLocalChanges(true);
  }

  return (
    <>
      <section className="entrySummary" aria-label="入力状況">
        <div>
          <p className="sectionEyebrow">入力状況</p>
          <p className="summaryNumber"><strong>{progress.complete}</strong> / {progress.total} 名の入力がそろっています</p>
          <p className="mutedText">未入力: {progress.pending} 名。休学者は入力対象に含みません。</p>
        </div>
        <div className="saveStatus" aria-live="polite">
          <span className={hasLocalChanges ? "statusIcon changed" : "statusIcon"} aria-hidden="true" />
          <div>
            <strong>{hasLocalChanges ? "変更あり（画面内のみ）" : "画面確認用データ"}</strong>
            <p>保存先は未接続です</p>
          </div>
        </div>
      </section>

      <p className="editorInstruction">出席率は0〜100、態度・課題は1〜10で入力します。評価と点数は、丸めルール確定後に表示します。</p>

      <div className="desktopGradeEditor">
        <table className="gradeTable">
          <caption>学生ごとの成績入力表</caption>
          <thead>
            <tr>
              <th scope="col">学生</th>
              <th scope="col">出席率<br /><span>0〜100</span></th>
              <th scope="col">態度<br /><span>1〜10</span></th>
              <th scope="col">課題<br /><span>1〜10</span></th>
              <th scope="col">点数</th>
              <th scope="col">評価</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className={row.status === "leave" ? "leaveRow" : undefined} key={row.studentNumber}>
                <th scope="row">
                  <strong>{row.name}</strong>
                  <span>{row.studentNumber}</span>
                  {row.status === "leave" ? <em>休学中</em> : null}
                </th>
                {(Object.keys(fieldLabels) as Array<keyof GradeInput>).map((field) => {
                  const value = row.input[field];
                  const isValid = isGradeInputInRange(field, value);
                  const errorId = `grade-${row.studentNumber}-${field}-error`;
                  const hasRangeError = value !== "" && !isValid;
                  return (
                    <td key={field}>
                      <input
                        aria-label={`${row.name}の${fieldLabels[field]}`}
                        aria-describedby={hasRangeError ? errorId : undefined}
                        aria-invalid={hasRangeError || undefined}
                        className={hasRangeError ? "invalidInput" : undefined}
                        disabled={row.status === "leave"}
                        inputMode="decimal"
                        value={value}
                        onChange={(event) => updateInput(row.studentNumber, field, event.target.value)}
                      />
                      {hasRangeError ? <span className="inputHint" id={errorId}>入力できる範囲を確認してください</span> : null}
                    </td>
                  );
                })}
                <td><output className="calculationPending">未算出</output></td>
                <td><output className="calculationPending">未算出</output></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mobileGradeViewer" aria-label="成績表の閲覧専用表示">
        <p><strong>この画面幅では閲覧専用です。</strong>入力はパソコンで行ってください。</p>
        {rows.map((row) => (
          <article className={row.status === "leave" ? "gradeCard leaveCard" : "gradeCard"} key={row.studentNumber}>
            <div>
              <strong>{row.name}</strong><span>{row.studentNumber}</span>
            </div>
            {row.status === "leave" ? <em>休学中・入力不可</em> : null}
            <dl>
              <div><dt>出席率</dt><dd>{row.input.attendanceRate || "未入力"}</dd></div>
              <div><dt>態度</dt><dd>{row.input.attitude || "未入力"}</dd></div>
              <div><dt>課題</dt><dd>{row.input.assignment || "未入力"}</dd></div>
              <div><dt>点数・評価</dt><dd>未算出</dd></div>
            </dl>
          </article>
        ))}
      </section>
    </>
  );
}
