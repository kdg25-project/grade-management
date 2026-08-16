"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { destinationForSignedInUser } from "@/lib/login-routing";

export function LoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingSession, setIsConfirmingSession] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const submissionInFlight = useRef(false);
  const sessionConfirmationInFlight = useRef(false);
  const hasNavigated = useRef(false);
  const { data: session, error: sessionError, isPending: isSessionPending, isRefetching, refetch } = authClient.useSession();

  useEffect(() => {
    if (!isConfirmingSession || !sessionConfirmationInFlight.current || hasNavigated.current) return;
    if (isSessionPending || isRefetching) return;

    if (sessionError || !session) {
      sessionConfirmationInFlight.current = false;
      submissionInFlight.current = false;
      setIsConfirmingSession(false);
      setIsSubmitting(false);
      setErrorMessage("ログイン情報を確認できませんでした。もう一度お試しください。");
      return;
    }

    const destination = destinationForSignedInUser(session.user);
    if (!destination) {
      sessionConfirmationInFlight.current = false;
      submissionInFlight.current = false;
      setIsConfirmingSession(false);
      setIsSubmitting(false);
      setErrorMessage("ログイン情報を確認できませんでした。もう一度お試しください。");
      return;
    }

    hasNavigated.current = true;
    sessionConfirmationInFlight.current = false;
    navigate(destination, { replace: true });
  }, [isConfirmingSession, isRefetching, isSessionPending, navigate, session, sessionError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;

    submissionInFlight.current = true;
    hasNavigated.current = false;
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { data, error } = await authClient.signIn.email({ email, password });

      if (error) {
        setErrorMessage("メールアドレスまたはパスワードを確認してください。");
        submissionInFlight.current = false;
        setIsSubmitting(false);
        return;
      }

      if (!destinationForSignedInUser(data?.user)) {
        setErrorMessage("ログイン情報を確認できませんでした。もう一度お試しください。");
        submissionInFlight.current = false;
        setIsSubmitting(false);
        return;
      }

      // Refetch while this hook remains mounted. Better Auth aborts the
      // pre-login request, so ProtectedRoute cannot consume its stale null.
      sessionConfirmationInFlight.current = true;
      void refetch();
      setIsConfirmingSession(true);
    } catch {
      setErrorMessage("ログインできませんでした。時間をおいてもう一度お試しください。");
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form className="loginForm" onSubmit={handleSubmit} noValidate>
      <div className="fieldGroup">
        <label htmlFor="email">メールアドレス</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          aria-describedby={errorMessage ? "login-error" : undefined}
        />
      </div>
      <div className="fieldGroup">
        <label htmlFor="password">パスワード</label>
        <div className="passwordField">
          <input
            id="password"
            name="password"
            type={isPasswordVisible ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            aria-describedby={errorMessage ? "login-error" : undefined}
          />
          <button
            className="passwordToggle"
            type="button"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            aria-label={isPasswordVisible ? "パスワードを隠す" : "パスワードを表示する"}
            aria-pressed={isPasswordVisible}
          >
            {isPasswordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
      </div>
      {errorMessage ? (
        <p className="formError" id="login-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <Button className="primaryAction" type="submit" disabled={isSubmitting}>
        {isSubmitting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
        {isSubmitting ? "ログイン中…" : "ログイン"}
      </Button>
    </form>
  );
}
