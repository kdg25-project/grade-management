import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

type Credentials = {
  admin: { email: string; password: string; changedPassword: string };
  teacher: { email: string; password: string; changedPassword: string };
};

const importedStudent = {
  studentNumber: "E2E-CSV-2027-001",
  name: "E2E CSV取込学生",
  nameKana: "イーツーイー シーエスブイトリコミガクセイ",
  birthDate: "2008年4月1日",
  email: "e2e-csv-import-student@example.test",
  phone: "090-1234-5678",
  postalCode: "150-0001",
  address: "東京都渋谷区E2E 1-2-3",
  course: "Webデザイナー",
} as const;

const studentImportCsv = [
  "学籍番号,氏名,氏名（ひらがな）,年齢,生年月日,性別,メールアドレス,電話番号,郵便番号,住所,専攻",
  [importedStudent.studentNumber, importedStudent.name, importedStudent.nameKana, "18", importedStudent.birthDate, "女", importedStudent.email, importedStudent.phone, importedStudent.postalCode, importedStudent.address, importedStudent.course].join(","),
].join("\r\n");

const gradeExportHeaders = ["学籍番号", "氏名", "年度", "学期", "専攻", "学年", "科目名", "出席率", "最終評価"];

async function readCredentials() {
  return JSON.parse(await readFile(new URL("./.credentials.json", import.meta.url), "utf8")) as Credentials;
}

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(account.email);
  await page.getByRole("textbox", { name: "パスワード", exact: true }).fill(account.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

async function changeInitialPassword(page: Page, currentPassword: string, nextPassword: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("現在のパスワード").fill(currentPassword);
  await page.getByLabel("新しいパスワード", { exact: true }).fill(nextPassword);
  await page.getByLabel("新しいパスワード（確認）").fill(nextPassword);
  await page.getByRole("button", { name: "パスワードを変更" }).click();
}

test.describe("grade-management local smoke", () => {
  test.describe.configure({ mode: "serial" });

  test("protects routes and persists grades through finalization and reopen", async ({ page }) => {
    const credentials = await readCredentials();
    const protectedStart = performance.now();
    await page.goto("/teacher/subjects");
    await expect(page).toHaveURL(/\/login$/);
    expect(performance.now() - protectedStart).toBeLessThan(3_000);

    await signIn(page, credentials.teacher);
    await changeInitialPassword(page, credentials.teacher.password, credentials.teacher.changedPassword);
    await expect(page).toHaveURL(/\/teacher\/subjects$/);
    await expect(page.getByRole("heading", { name: "成績を入力する科目を選ぶ" })).toBeVisible();

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/teacher\/subjects$/);

    const subjectsLoaded = performance.now();
    await page.getByRole("link", { name: "成績表を開く" }).click();
    await expect(page.getByRole("heading", { name: "成績表" })).toBeVisible();
    expect(performance.now() - subjectsLoaded).toBeLessThan(3_000);

    await page.getByRole("button", { name: "初期比重を保存" }).click();
    await expect(page.getByText("評価比重を保存しました。成績を再計算しました。")).toBeVisible();
    await page.getByLabel("開発用 学生の出席率").fill("95");
    await page.getByLabel("開発用 学生の平常点").fill("9");
    await page.getByLabel("開発用 学生の課題点").fill("8");
    const saveStarted = performance.now();
    await page.getByRole("button", { name: "変更を保存" }).click();
    await expect(page.getByText("成績を保存しました。")).toBeVisible();
    await page.reload();
    const persistedAttendance = page.getByLabel("開発用 学生の出席率");
    await expect(persistedAttendance).toHaveValue("95");
    expect(performance.now() - saveStarted).toBeLessThan(10_000);
    await expect(page.getByLabel("開発用 学生の平常点")).toHaveValue("9");
    await expect(page.getByLabel("開発用 学生の課題点")).toHaveValue("8");

    await signIn(page, credentials.admin);
    await changeInitialPassword(page, credentials.admin.password, credentials.admin.changedPassword);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "成績管理ダッシュボード" })).toBeVisible();

    await page.goto("/admin/imports");
    await expect(page.getByRole("heading", { name: "通常CSV取込" })).toBeVisible();
    await page.getByLabel("CSVファイル").setInputFiles({
      name: "students.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(studentImportCsv, "utf8"),
    });
    await expect(page.getByText("CSVを読み込みました。", { exact: true })).toBeVisible();
    const importStarted = performance.now();
    const importPreviewResponse = page.waitForResponse((response) => response.url().includes("/api/admin/imports/preview") && response.request().method() === "POST");
    await page.getByRole("button", { name: "内容を確認する" }).click();
    await expect(page.getByText("問題ありません。反映できます。", { exact: true })).toBeVisible();
    const importPreview = await (await importPreviewResponse).json() as { token: string };
    expect(importPreview.token).toBeTruthy();
    page.once("dialog", (dialog) => dialog.accept());
    const importApplyResponse = page.waitForResponse((response) => response.url().includes("/api/admin/imports/apply") && response.request().method() === "POST");
    await page.getByRole("button", { name: "反映する" }).click();
    expect((await importApplyResponse).ok()).toBeTruthy();
    expect(performance.now() - importStarted).toBeLessThan(60_000);

    await page.goto("/admin/students");
    await expect(page.getByRole("heading", { name: "学生を登録・確認する" })).toBeVisible();
    await page.getByLabel("検索").fill(importedStudent.studentNumber);
    await page.getByRole("button", { name: "更新" }).click();
    await expect(page.getByText(importedStudent.name, { exact: true })).toBeVisible();
    await expect(page.getByText(importedStudent.studentNumber, { exact: true })).toBeVisible();
    const persistedImport = await page.evaluate(async (studentNumber) => {
      const response = await fetch(`/api/admin/students?page=1&pageSize=20&search=${encodeURIComponent(studentNumber)}`);
      return { status: response.status, body: await response.json() };
    }, importedStudent.studentNumber);
    expect(persistedImport.status).toBe(200);
    expect(persistedImport.body).toMatchObject({
      items: [expect.objectContaining({ studentNumber: importedStudent.studentNumber, name: importedStudent.name })],
    });

    await page.goto("/admin");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "開発用データベースの前期を確定する" }).click();
    await expect(page.getByText("開発用データベースの前期を確定しました。")).toBeVisible();

    await page.goto("/admin/grades");
    await expect(page.getByRole("heading", { name: "成績と再試験履歴を確認する" })).toBeVisible();
    const initialGradeRow = page.getByRole("row", { name: /開発用 学生.*開発用データベース・前期.*S.*詳細・修正/u });
    await initialGradeRow.getByRole("button", { name: "詳細・修正" }).click();
    await expect(page.getByRole("heading", { name: "開発用 学生さん・開発用データベース" })).toBeVisible();
    await page.getByLabel("出席率").fill("0");
    await page.getByLabel("平常点").fill("0");
    await page.getByLabel("課題点").fill("0");
    await page.getByLabel("理由").fill("E2E: 確定済み評価を再試験対象へ修正");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "最新成績を修正" }).click();
    await expect(page.getByText(/1回目: F/u)).toBeVisible();
    await page.getByLabel("出席率").fill("95");
    await page.getByLabel("平常点").fill("9");
    await page.getByLabel("課題点").fill("8");
    await page.getByLabel("理由").fill("E2E: 確定済みFの再試験合格");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "再試験を登録" }).click();
    await expect(page.getByText(/2回目: S/u)).toBeVisible();
    await expect(page.getByText(/1回目: F/u)).toBeVisible();

    await page.goto("/admin/exports");
    await expect(page.getByRole("heading", { name: "成績CSV出力" })).toBeVisible();
    await page.getByRole("combobox", { name: "出力パターン", exact: true }).selectOption({ label: "年度・学期別" });
    await expect(page.getByRole("combobox", { name: "出力パターン", exact: true })).toHaveValue("term");
    await page.getByRole("combobox", { name: "学期", exact: true }).selectOption("1");
    await expect(page.getByRole("combobox", { name: "学期", exact: true })).toHaveValue("1");
    const exportPreviewResponse = page.waitForResponse((response) => response.url().includes("/api/admin/grade-export/preview") && response.request().method() === "POST");
    await page.getByRole("button", { name: "件数を確認する" }).click();
    await expect(page.getByText("2027年度：1件の確定済み成績を出力します。", { exact: true })).toBeVisible();
    const exportPreview = await (await exportPreviewResponse).json() as { token: string };
    expect(exportPreview.token).toBeTruthy();
    const downloadResponse = page.waitForResponse((response) => response.url().includes("/api/admin/grade-export/download") && response.request().method() === "GET");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSVをダウンロード" }).click();
    const [gradeCsvResponse, gradeCsvDownload] = await Promise.all([downloadResponse, download]);
    expect(gradeCsvResponse.ok()).toBeTruthy();
    expect(gradeCsvResponse.headers()["content-disposition"]).toContain("filename*=UTF-8''");
    expect(gradeCsvResponse.headers()["content-disposition"]).toContain("%E6%88%90%E7%B8%BE%E4%B8%80%E8%A6%A7_2027%E5%B9%B4%E5%BA%A6.csv");
    const gradeCsvPath = await gradeCsvDownload.path();
    expect(gradeCsvPath).toBeTruthy();
    const gradeCsv = await readFile(gradeCsvPath!, "utf8");
    const gradeCsvLines = gradeCsv.split("\r\n");
    expect(gradeCsv.startsWith("\uFEFF")).toBeTruthy();
    expect(gradeCsvLines[0]).toBe(`\uFEFF${gradeExportHeaders.join(",")}`);
    const gradeCsvRows = gradeCsvLines.slice(1).filter(Boolean).map((line) => line.split(","));
    const retakeRows = gradeCsvRows.filter((row) => row[0] === "D27-001" && row[6] === "開発用データベース");
    expect(retakeRows).toEqual([["D27-001", "開発用 学生", "2027", "1", "システムエンジニア", "1", "開発用データベース", "95", "S"]]);
    expect(gradeCsvRows.some((row) => row[0] === "D27-001" && row[6] === "開発用データベース" && row[8] === "F")).toBeFalsy();

    await signIn(page, { email: credentials.teacher.email, password: credentials.teacher.changedPassword });
    await expect(page).toHaveURL(/\/teacher\/subjects$/);
    await expect(page.getByText("いま入力する学期：後期")).toBeVisible();
    await page.goto("/teacher/subjects/dev-subject/grades?term=1&year=2027");
    await expect(page).toHaveURL(/term=2/);
    await expect(page.getByText("2027年度 後期")).toBeVisible();
    await page.getByRole("button", { name: "初期比重を保存" }).click();
    await expect(page.getByText("評価比重を保存しました。成績を再計算しました。")).toBeVisible();
    await page.getByLabel("開発用 学生の出席率").fill("90");
    await page.getByLabel("開発用 学生の平常点").fill("8");
    await page.getByLabel("開発用 学生の課題点").fill("9");
    await page.getByRole("button", { name: "変更を保存" }).click();
    await expect(page.getByText("成績を保存しました。")).toBeVisible();

    await signIn(page, { email: credentials.admin.email, password: credentials.admin.changedPassword });
    await expect(page).toHaveURL(/\/admin$/);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "開発用データベースの後期を確定する" }).click();
    await expect(page.getByText("開発用データベースの後期を確定しました。")).toBeVisible();

    await signIn(page, { email: credentials.teacher.email, password: credentials.teacher.changedPassword });
    await expect(page).toHaveURL(/\/teacher\/subjects$/);
    const finalizedSubject = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "開発用データベース" }) });
    await expect(finalizedSubject.getByText("すべて確定済み", { exact: true })).toHaveCount(2);

    await signIn(page, { email: credentials.admin.email, password: credentials.admin.changedPassword });
    await expect(page).toHaveURL(/\/admin$/);
    page.once("dialog", (dialog) => dialog.accept("E2E: entry correction requested"));
    await page.getByRole("button", { name: "開発用データベースの後期を再開する" }).click();
    await expect(page.getByText("開発用データベースの後期を再開しました。")).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "監査履歴" })).toBeVisible();
    const auditLog = page.getByRole("region", { name: "操作履歴" });
    await expect(auditLog.getByRole("article").filter({ hasText: "通常CSV取込" })).toHaveCount(1);
    await expect(auditLog.getByRole("article").filter({ hasText: "成績CSV出力" })).toHaveCount(1);
    await expect(auditLog.getByRole("article").filter({ hasText: "成績確定" })).toHaveCount(2);
    await expect(auditLog.getByRole("article").filter({ hasText: "成績再開" })).toHaveCount(1);
    const auditText = await page.locator("main").innerText();
    for (const sensitiveValue of [importedStudent.studentNumber, importedStudent.name, importedStudent.birthDate, importedStudent.email, importedStudent.phone, importedStudent.address, credentials.admin.changedPassword, credentials.teacher.changedPassword, importPreview.token, exportPreview.token]) {
      expect(auditText).not.toContain(sensitiveValue);
    }
    await page.getByLabel("操作種別").selectOption({ label: "成績CSV出力" });
    await expect(auditLog.getByRole("article").filter({ hasText: "成績CSVを出力" })).toBeVisible();
    await expect(auditLog.getByRole("article").filter({ hasText: "通常CSVを一括取込" })).toHaveCount(0);

    await signIn(page, { email: credentials.teacher.email, password: credentials.teacher.changedPassword });
    await expect(page).toHaveURL(/\/teacher\/subjects$/);
    await expect(page.getByText("いま入力する学期：後期")).toBeVisible();
    await page.getByRole("link", { name: "成績表を開く" }).click();
    await expect(page.getByLabel("開発用 学生の出席率")).toBeEditable();
  });
});
