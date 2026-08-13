import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

type Credentials = {
  admin: { email: string; password: string; changedPassword: string };
  teacher: { email: string; password: string; changedPassword: string };
};

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
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "確定する" }).first().click();
    await expect(page.getByText("開発用データベースの前期を確定しました。")).toBeVisible();

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
    await page.getByRole("button", { name: "確定する" }).click();
    await expect(page.getByText("開発用データベースの後期を確定しました。")).toBeVisible();

    await signIn(page, { email: credentials.teacher.email, password: credentials.teacher.changedPassword });
    await expect(page).toHaveURL(/\/teacher\/subjects$/);
    await expect(page.getByText("すべて確定済み").first()).toBeVisible();

    await signIn(page, { email: credentials.admin.email, password: credentials.admin.changedPassword });
    await expect(page).toHaveURL(/\/admin$/);
    page.once("dialog", (dialog) => dialog.accept("E2E: entry correction requested"));
    await page.getByRole("button", { name: "再開する" }).last().click();
    await expect(page.getByText("開発用データベースの後期を再開しました。")).toBeVisible();

    await signIn(page, { email: credentials.teacher.email, password: credentials.teacher.changedPassword });
    await expect(page).toHaveURL(/\/teacher\/subjects$/);
    await expect(page.getByText("いま入力する学期：後期")).toBeVisible();
    await page.getByRole("link", { name: "成績表を開く" }).click();
    await expect(page.getByLabel("開発用 学生の出席率")).toBeEditable();
  });
});
