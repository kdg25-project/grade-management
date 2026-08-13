import { LoaderCircle } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { destinationForUser } from "@/lib/session-routing";

export function PasswordChangeForm() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmation) {
      setError("新しいパスワードが確認用の入力と一致しません。");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) {
        setError("現在のパスワードを確認して、もう一度お試しください。");
        return;
      }

      const session = await authClient.getSession();
      if (!session.data) {
        setError("パスワードは変更されました。もう一度ログインしてください。");
        return;
      }
      navigate(destinationForUser(session.data.user), { replace: true });
    } catch {
      setError("パスワードを変更できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <form className="loginForm" onSubmit={submit} noValidate>
    <div className="fieldGroup"><label htmlFor="current-password">現在のパスワード</label><input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
    <div className="fieldGroup"><label htmlFor="changed-password">新しいパスワード</label><input id="changed-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} required /></div>
    <div className="fieldGroup"><label htmlFor="changed-password-confirmation">新しいパスワード（確認）</label><input id="changed-password-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required /></div>
    {error ? <p className="formError" role="alert">{error}</p> : null}
    <Button className="primaryAction" type="submit" disabled={isSubmitting}>{isSubmitting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{isSubmitting ? "変更中…" : "パスワードを変更"}</Button>
  </form>;
}
