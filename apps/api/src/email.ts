export type EmailBinding = Pick<SendEmail, "send">;

export type PasswordResetEmail = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
};

export const createPasswordResetEmail = ({ to, from, resetUrl }: { to: string; from: string; resetUrl: string }): PasswordResetEmail => ({
  to,
  from,
  subject: "SANSUN学園 成績管理システムのパスワード再設定",
  text: `パスワードを再設定するには、30分以内に次のURLを開いてください。\n${resetUrl}\n\nこのメールに心当たりがない場合は、何もせず破棄してください。`,
  html: `<p>パスワードを再設定するには、30分以内に次のリンクを開いてください。</p><p><a href="${escapeHtml(resetUrl)}">パスワードを再設定する</a></p><p>このメールに心当たりがない場合は、何もせず破棄してください。</p>`,
});

export const createPasswordResetEmailSender = (
  email: EmailBinding | undefined,
  from: string,
  deliveryEnabled = true,
) => ({
  async send({ to, resetUrl }: { to: string; resetUrl: string }) {
    const message = createPasswordResetEmail({ to, from, resetUrl });
    if (!email || !deliveryEnabled) {
      console.info(JSON.stringify({ event: "password_reset_email_simulated", recipient: to }));
      return;
    }
    await email.send(message);
  },
});

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
