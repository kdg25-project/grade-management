import { LoaderCircle } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

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
