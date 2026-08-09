"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { error } = await authClient.signIn.email({ email, password });

      if (error) {
        setErrorMessage("メールアドレスまたはパスワードを確認してください。");
        return;
      }

      router.push("/teacher/subjects");
    } catch {
      setErrorMessage("ログインできませんでした。時間をおいてもう一度お試しください。");
    } finally {
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
