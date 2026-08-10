import { ArrowRight, ChevronLeft, ClipboardPenLine, Monitor } from "lucide-react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";

import { GradeEntryTable } from "@/components/grade-entry-table";
import { LoginForm } from "@/components/login-form";
import { PasswordResetRequestForm, ResetPasswordForm } from "@/components/password-reset-forms";
import { TeacherShell } from "@/components/teacher-shell";
import { prototypeSubjects } from "@/lib/prototype-grade-data";

function LoginPage() {
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="login-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">講師ログイン</p><h1 id="login-title">成績入力をはじめる</h1><p className="pageLead">登録されているメールアドレスとパスワードを入力してください。</p><LoginForm /><p className="resetLink"><Link to="/forgot-password">パスワードをお忘れですか？</Link></p><aside className="loginHelp"><strong>ログインできないときは</strong><p>パスワードの再設定やアカウントの確認は、教務担当へお問い合わせください。</p></aside></section></main>;
}

function ForgotPasswordPage() {
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="forgot-password-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">パスワード再設定</p><h1 id="forgot-password-title">再設定メールを送信</h1><p className="pageLead">登録済みのメールアドレスを入力してください。</p><PasswordResetRequestForm /><p className="resetLink"><Link to="/login">ログインに戻る</Link></p></section></main>;
}

function ResetPasswordPage() {
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="reset-password-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">パスワード再設定</p><h1 id="reset-password-title">新しいパスワードを設定</h1><p className="pageLead">新しいパスワードを入力してください。</p><ResetPasswordForm /></section></main>;
}

function SubjectsPage() {
  return <TeacherShell><header className="pageHeader"><p className="sectionEyebrow">担当科目</p><h1>成績を入力する科目を選ぶ</h1><p>今年度と入力する学期を確認して、科目を選択してください。</p></header><section className="prototypeNotice" aria-label="画面確認用の案内"><ClipboardPenLine aria-hidden="true" /><div><strong>画面確認用データを表示しています</strong><p>担当科目・入力状況は仮の内容です。業務APIと認証ガードは未接続です。</p></div></section><section aria-labelledby="subjects-heading"><div className="sectionTitle"><div><p className="sectionEyebrow">2026年度 前期</p><h2 id="subjects-heading">担当科目</h2></div><p>前期の成績が教務で確定した後、後期の入力へ切り替わります。</p></div><div className="subjectList">{prototypeSubjects.map((subject) => <article className={subject.isCurrentEntry ? "subjectCard currentSubject" : "subjectCard"} key={subject.id}><div className="subjectStatus"><span className={subject.isCurrentEntry ? "statusIcon current" : "statusIcon"} aria-hidden="true" />{subject.isCurrentEntry ? "いま入力する科目" : subject.entryStatus}</div><div className="subjectInfo"><h3>{subject.name}</h3><p>{subject.className}</p><dl><div><dt>年度</dt><dd>{subject.year}</dd></div><div><dt>学期</dt><dd>{subject.term}</dd></div><div><dt>入力状況</dt><dd>{subject.entryStatus}</dd></div></dl><p className="subjectDescription">{subject.description}</p></div><Link className="subjectLink" to={`/teacher/subjects/${subject.id}/grades`}><span>成績表を開く</span><ArrowRight aria-hidden="true" /></Link></article>)}</div></section></TeacherShell>;
}

function GradesPage() {
  const { subjectId } = useParams();
  const subject = prototypeSubjects.find((item) => item.id === subjectId) ?? prototypeSubjects[0];
  return <TeacherShell><Link className="backLink" to="/teacher/subjects"><ChevronLeft aria-hidden="true" />担当科目に戻る</Link><header className="pageHeader gradeHeader"><p className="sectionEyebrow">{subject.year} {subject.term} / {subject.className}</p><h1>{subject.name}の成績表</h1><p>入力できるのは現在の学期です。確定の操作は、この画面にはありません。</p></header><section className="prototypeNotice compactNotice" aria-label="画面確認用の案内"><Monitor aria-hidden="true" /><div><strong>画面確認用の編集体験です</strong><p>入力内容はこの画面内だけで変わります。Hono RPC・保存・確定処理には接続していません。</p></div></section><GradeEntryTable /></TeacherShell>;
}

export function AppRoutes() {
  return <Routes><Route path="/" element={<Navigate to="/login" replace />} /><Route path="/login" element={<LoginPage />} /><Route path="/forgot-password" element={<ForgotPasswordPage />} /><Route path="/reset-password" element={<ResetPasswordPage />} /><Route path="/teacher/subjects" element={<SubjectsPage />} /><Route path="/teacher/subjects/:subjectId/grades" element={<GradesPage />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
}
