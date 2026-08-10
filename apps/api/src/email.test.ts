import { describe, expect, it } from "bun:test";

import { createPasswordResetEmail, createPasswordResetEmailSender } from "./email";

describe("password reset email", () => {
  it("builds both text and HTML alternatives", () => {
    const email = createPasswordResetEmail({
      to: "teacher@example.test",
      from: "no-reply@example.test",
      resetUrl: "https://school.example.test/reset-password?token=abc",
    });

    expect(email).toMatchObject({
      to: "teacher@example.test",
      from: "no-reply@example.test",
      subject: "SANSUN学園 成績管理システムのパスワード再設定",
    });
    expect(email.text).toContain("30分");
    expect(email.html).toContain('href="https://school.example.test/reset-password?token=abc"');
  });

  it("sends the composed payload through the Email Sending binding", async () => {
    const sent: unknown[] = [];
    const sender = createPasswordResetEmailSender({ send: async (message) => { sent.push(message); return { success: true } as never; } }, "no-reply@example.test");

    await sender.send({ to: "teacher@example.test", resetUrl: "https://school.example.test/reset-password?token=abc" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "teacher@example.test", from: "no-reply@example.test" });
  });
});
