import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

type Credentials = { admin: { email: string; password: string; changedPassword: string } };

async function credentials() {
  return JSON.parse(await readFile(new URL("./.credentials.json", import.meta.url), "utf8")) as Credentials;
}

async function signInAttempt(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(account.email);
  await page.getByRole("textbox", { name: "パスワード", exact: true }).fill(account.password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  return Promise.race([
    page.waitForURL(/\/admin$/, { timeout: 5_000 }).then(() => "admin" as const),
    page.waitForURL(/\/change-password$/, { timeout: 5_000 }).then(() => "password" as const),
    page.getByRole("alert").waitFor({ state: "visible", timeout: 5_000 }).then(() => "rejected" as const),
  ]);
}

async function signIn(page: Page, account: Credentials["admin"]) {
  await page.context().clearCookies();
  if (await signInAttempt(page, { email: account.email, password: account.changedPassword }) === "admin") return;
  expect(await signInAttempt(page, { email: account.email, password: account.password })).toBe("password");
  {
    await page.getByLabel("現在のパスワード").fill(account.password);
    await page.getByLabel("新しいパスワード", { exact: true }).fill(account.changedPassword);
    await page.getByLabel("新しいパスワード（確認）").fill(account.changedPassword);
    await page.getByRole("button", { name: "パスワードを変更" }).click();
  }
  await expect(page).toHaveURL(/\/admin$/);
}

test.describe("admin operation modals", () => {
  test.describe.configure({ mode: "serial" });

  test("opens every status dialog as a keyboard-dismissible modal and restores the trigger", async ({ page }) => {
    await signIn(page, (await credentials()).admin);
    await page.setViewportSize({ width: 1280, height: 900 });

    for (const route of ["/admin/students", "/admin/teachers", "/admin/staff"] as const) {
      await page.goto(route);
      const trigger = page.getByRole("button", { name: "状態変更" }).first();
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "状態を更新" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }

    await page.goto("/admin/students");
    const trigger = page.getByRole("button", { name: "状態変更" }).first();
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await dialog.screenshot({ path: "/private/tmp/grade-admin-status-modal.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeDisabled();
  });

  test("keeps an import confirmation open during a failed pending request and requires explicit credential acknowledgement", async ({ page }) => {
    await signIn(page, (await credentials()).admin);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/admin/years", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ years: [{ year: 2027, isCurrent: true, selectedAt: null }] }) });
    });
    await page.goto("/admin/imports");
    await page.route("**/api/admin/imports/preview", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ academicYear: 2027, token: "modal-preview-token", counts: { students: 0, teachers: 1, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, errors: [] }) });
    });
    let releaseFailure: (() => void) | null = null;
    let markApplyStarted: (() => void) | null = null;
    const applyStarted = new Promise<void>((resolve) => { markApplyStarted = resolve; });
    let applyAttempts = 0;
    await page.route("**/api/admin/imports/apply", async (route) => {
      applyAttempts += 1;
      if (applyAttempts === 1) {
        markApplyStarted?.();
        await new Promise<void>((resolve) => { releaseFailure = resolve; });
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "IMPORT_UNAVAILABLE", message: "E2E import write failure" } }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ applied: true, replayed: false, credentialsAlreadyIssued: false, summary: { students: 0, teachers: 1, staff: 0, subjects: { 1: 0, 2: 0, 3: 0 } }, credentials: [{ name: "E2E 一時講師", email: "modal-teacher@example.test", role: "teacher", temporaryPassword: "one-time-modal-password" }] }) });
    });
    await page.getByLabel("CSVの種類").selectOption("teachers");
    await page.getByLabel("CSVファイル").setInputFiles({ name: "modal-teachers.csv", mimeType: "text/csv", buffer: Buffer.from("氏名,ひらがな,年齢,性別,メールアドレス\r\nE2E 一時講師,いーつーいー,30,女,modal-teacher@example.test", "utf8") });
    await expect(page.locator(".csvUploadStatus")).toContainText("modal-teachers.csv");
    const previewButton = page.getByRole("button", { name: "内容を確認する" });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    const preview = page.getByRole("dialog", { name: "CSVの内容を確認" });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "反映する" }).click();
    await applyStarted;
    await expect(preview.getByRole("button", { name: "反映中…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(preview).toBeVisible();
    if (!releaseFailure) throw new Error("The mocked import request did not start.");
    releaseFailure();
    await expect(preview.locator(".errorToast")).toContainText("E2E import write failure");
    await expect(preview.locator(".formError")).toHaveCount(0);
    await expect(preview.getByRole("button", { name: "反映する" })).toBeEnabled();
    await preview.getByRole("button", { name: "反映する" }).click();
    const credentialsDialog = page.getByRole("dialog", { name: "一時パスワードを保存" });
    await expect(credentialsDialog).toBeVisible();
    await expect(credentialsDialog.getByRole("button", { name: "一時パスワードを保存を閉じる" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(credentialsDialog).toBeVisible();
    await credentialsDialog.getByRole("button", { name: "保存済みとして閉じる" }).click();
    await expect(credentialsDialog).toBeHidden();
  });
});
