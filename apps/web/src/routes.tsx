import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { AdminDashboard } from "@/components/admin-dashboard";
import { LoginForm } from "@/components/login-form";
import { ResetPasswordForm } from "@/components/password-reset-forms";
import { PasswordChangeForm } from "@/components/password-change-form";
import { GradeDetail } from "@/components/grade-detail";
import { SubjectsPage } from "@/components/teacher-subjects";
import { AdminStaffPage, AdminStudentsPage, AdminSubjectsPage, AdminTeachersPage, AdminYearsPage } from "@/components/admin-master-pages";
import { AdminAuditPage } from "@/components/admin-audit-page";
import { AdminRolloverPage } from "@/components/admin-rollover-page";
import { AdminGradeExportPage } from "@/components/admin-grade-export-page";
import { AdminImportPage } from "@/components/admin-import-page";
import { AdminGradeSearchPage } from "@/components/admin-grade-search";
import { SessionIdleLogout } from "@/components/session-idle-logout";
import { authClient } from "@/lib/auth-client";
import { isIdleSessionLocked } from "@/lib/idle-coordinator";
import { destinationForUser, isAllowedRoute } from "@/lib/session-routing";

function SessionPending() {
  return <main className="loginPage"><section className="loginPanel"><p className="sectionEyebrow">確認中</p><h1>ログイン状態を確認しています</h1><p className="pageLead">そのままお待ちください。</p></section></main>;
}

function SessionError() {
  return <main className="loginPage"><section className="loginPanel"><p className="sectionEyebrow">接続を確認してください</p><h1>ログイン状態を確認できません</h1><p className="pageLead">通信状況を確認して、もう一度お試しください。</p><p className="resetLink"><Link to="/login">ログイン画面へ</Link></p></section></main>;
}

function ProtectedRoute({ children }: Readonly<{ children: React.ReactNode }>) {
  const location = useLocation();
  const { data, error, isPending } = authClient.useSession();
  if (isPending) return <SessionPending />;
  if (error) return <SessionError />;
  if (!data) return <Navigate to="/login" replace state={{ from: { pathname: location.pathname, search: location.search } }} />;
  if (data.user.status !== "active") {
    const page = location.pathname === "/account-inactive" ? children : <Navigate to="/account-inactive" replace />;
    return <SessionIdleLogout sessionKey={data.session.id}>{page}</SessionIdleLogout>;
  }
  if (location.pathname === "/account-inactive") return <Navigate to={destinationForUser(data.user)} replace />;
  if (!isAllowedRoute(location.pathname, data.user)) return <Navigate to={destinationForUser(data.user)} replace />;
  return <SessionIdleLogout sessionKey={data.session.id}>{children}</SessionIdleLogout>;
}

function LoginPage() {
  const { data } = authClient.useSession();
  if (data && !isIdleSessionLocked(data.session.id)) {
    return <Navigate to={destinationForUser(data.user)} replace />;
  }
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="login-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">講師ログイン</p><h1 id="login-title">成績入力をはじめる</h1><p className="pageLead">登録されているメールアドレスとパスワードを入力してください。</p><LoginForm /><p className="resetLink"><Link to="/forgot-password">パスワードをお忘れですか？</Link></p><aside className="loginHelp"><strong>ログインできないときは</strong><p>パスワードの再設定やアカウントの確認は、教務担当へお問い合わせください。</p></aside></section></main>;
}

function ForgotPasswordPage() {
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="forgot-password-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">ログインのお困りごと</p><h1 id="forgot-password-title">教務担当へお問い合わせください</h1><p className="pageLead">パスワードの再設定は、専任職員が本人確認後にご案内します。登録メールアドレスと氏名を添えて教務担当へ連絡してください。</p><p className="resetLink"><Link to="/login">ログインに戻る</Link></p></section></main>;
}

function ResetPasswordPage() {
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="reset-password-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">パスワード再設定</p><h1 id="reset-password-title">新しいパスワードを設定</h1><p className="pageLead">新しいパスワードを入力してください。</p><ResetPasswordForm /></section></main>;
}

function ChangePasswordPage() {
  return <main className="loginPage"><section className="loginPanel" aria-labelledby="change-password-title"><Link className="loginBrand" to="/login">SANSUN学園<span>成績管理システム</span></Link><p className="sectionEyebrow">初回パスワード変更</p><h1 id="change-password-title">新しいパスワードを設定</h1><p className="pageLead">安全のため、配布された一時パスワードを変更してください。</p><PasswordChangeForm /></section></main>;
}

function AccountInactivePage() {
  const navigate = useNavigate();
  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return <main className="loginPage"><section className="loginPanel" aria-labelledby="account-inactive-title"><p className="sectionEyebrow">アカウントを利用できません</p><h1 id="account-inactive-title">このアカウントは現在利用できません</h1><p className="pageLead">利用再開や登録内容については、専任職員へお問い合わせください。</p><button className="secondaryAction" type="button" onClick={() => void signOut()}>ログアウト</button></section></main>;
}

export function AppRoutes() {
  return <Routes><Route path="/" element={<Navigate to="/login" replace />} /><Route path="/login" element={<LoginPage />} /><Route path="/forgot-password" element={<ForgotPasswordPage />} /><Route path="/reset-password" element={<ResetPasswordPage />} /><Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} /><Route path="/account-inactive" element={<ProtectedRoute><AccountInactivePage /></ProtectedRoute>} /><Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} /><Route path="/admin/grades" element={<ProtectedRoute><AdminGradeSearchPage /></ProtectedRoute>} /><Route path="/admin/years" element={<ProtectedRoute><AdminYearsPage /></ProtectedRoute>} /><Route path="/admin/rollover" element={<ProtectedRoute><AdminRolloverPage /></ProtectedRoute>} /><Route path="/admin/imports" element={<ProtectedRoute><AdminImportPage /></ProtectedRoute>} /><Route path="/admin/exports" element={<ProtectedRoute><AdminGradeExportPage /></ProtectedRoute>} /><Route path="/admin/students" element={<ProtectedRoute><AdminStudentsPage /></ProtectedRoute>} /><Route path="/admin/teachers" element={<ProtectedRoute><AdminTeachersPage /></ProtectedRoute>} /><Route path="/admin/staff" element={<ProtectedRoute><AdminStaffPage /></ProtectedRoute>} /><Route path="/admin/subjects" element={<ProtectedRoute><AdminSubjectsPage /></ProtectedRoute>} /><Route path="/admin/audit" element={<ProtectedRoute><AdminAuditPage /></ProtectedRoute>} /><Route path="/teacher/subjects" element={<ProtectedRoute><SubjectsPage /></ProtectedRoute>} /><Route path="/teacher/subjects/:subjectId/grades" element={<ProtectedRoute><GradeDetail /></ProtectedRoute>} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
}
