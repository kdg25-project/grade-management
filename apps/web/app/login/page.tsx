import Link from "next/link";

import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginPanel" aria-labelledby="login-title">
        <Link className="loginBrand" href="/login">SANSUN学園<span>成績管理システム</span></Link>
        <p className="sectionEyebrow">講師ログイン</p>
        <h1 id="login-title">成績入力をはじめる</h1>
        <p className="pageLead">登録されているメールアドレスとパスワードを入力してください。</p>
        <LoginForm />
        <aside className="loginHelp">
          <strong>ログインできないときは</strong>
          <p>パスワードの再設定やアカウントの確認は、教務担当へお問い合わせください。</p>
        </aside>
      </section>
      <p className="prototypeFooter">これは画面確認用の開発プロトタイプです。認証ガードおよび成績データの保存先は、まだ接続していません。</p>
    </main>
  );
}
