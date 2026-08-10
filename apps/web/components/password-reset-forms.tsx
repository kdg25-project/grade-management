import { LoaderCircle } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

const genericMessage = "登録情報を確認し、該当する場合はパスワード再設定のご案内をメールでお送りします。";

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    } finally {
      setMessage(genericMessage);
      setIsSubmitting(false);
    }
  }

  return <form className="loginForm" onSubmit={submit}><div className="fieldGroup"><label htmlFor="reset-email">メールアドレス</label><input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>{message ? <p className="formSuccess" role="status">{message}</p> : null}<Button className="primaryAction" type="submit" disabled={isSubmitting}>{isSubmitting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{isSubmitting ? "送信中…" : "再設定メールを送信"}</Button></form>;
}

export function ResetPasswordForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const token = searchParams.get("token");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("再設定リンクが無効です。もう一度、再設定メールを申請してください。");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const { error: resetError } = await authClient.resetPassword({ newPassword: password, token });
      if (resetError) {
        setError("再設定リンクが無効または期限切れです。もう一度、再設定メールを申請してください。");
        return;
      }
      navigate("/login", { replace: true });
    } catch {
      setError("パスワードを再設定できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <form className="loginForm" onSubmit={submit}><div className="fieldGroup"><label htmlFor="new-password">新しいパスワード</label><input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></div>{error ? <p className="formError" role="alert">{error}</p> : null}<Button className="primaryAction" type="submit" disabled={isSubmitting}>{isSubmitting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{isSubmitting ? "再設定中…" : "パスワードを再設定"}</Button></form>;
}
