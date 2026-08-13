"use client";

import { BookOpenCheck, ClipboardPenLine, ShieldCheck, Users, UserRoundPlus, CalendarCog, BookMarked, History, RotateCcw, Download, Upload, UserCog, Menu as MenuIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type NavigationGuard = () => boolean;
const guardNavigation = (event: React.MouseEvent, guard?: NavigationGuard, close?: () => void) => {
  if (guard && !guard()) event.preventDefault();
  else close?.();
};

function TeacherNavigation({ onNavigate, navigationGuard }: Readonly<{ onNavigate?: () => void; navigationGuard?: NavigationGuard }>) {
  return (
    <>
      <p className="navLabel">講師メニュー</p>
      <Link to="/teacher/subjects" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><BookOpenCheck aria-hidden="true" />担当科目</Link>
      <span className="navItemMuted"><ClipboardPenLine aria-hidden="true" />成績入力は科目から選択</span>
      <div className="supportBox">
        <strong>お困りのときは</strong>
        <p>ログインや担当科目については、教務担当へお問い合わせください。</p>
      </div>
    </>
  );
}

function AdminNavigation({ onNavigate, navigationGuard }: Readonly<{ onNavigate?: () => void; navigationGuard?: NavigationGuard }>) {
  return <><p className="navLabel">専任職員メニュー</p><Link to="/admin" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><ShieldCheck aria-hidden="true" />成績確定</Link><Link to="/admin/grades" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><BookOpenCheck aria-hidden="true" />成績検索・修正</Link><Link to="/admin/years" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><CalendarCog aria-hidden="true" />年度管理</Link><Link to="/admin/rollover" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><RotateCcw aria-hidden="true" />年度更新</Link><Link to="/admin/imports" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><Upload aria-hidden="true" />通常CSV取込</Link><Link to="/admin/exports" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><Download aria-hidden="true" />成績CSV出力</Link><Link to="/admin/students" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><Users aria-hidden="true" />学生管理</Link><Link to="/admin/teachers" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><UserRoundPlus aria-hidden="true" />講師管理</Link><Link to="/admin/staff" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><UserCog aria-hidden="true" />専任職員管理</Link><Link to="/admin/subjects" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><BookMarked aria-hidden="true" />科目管理</Link><Link to="/admin/audit" onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}><History aria-hidden="true" />監査履歴</Link><div className="supportBox"><strong>お困りのときは</strong><p>学生・成績データについては、管理者へお問い合わせください。</p></div></>;
}

export function TeacherShell({ children, variant = "teacher", navigationGuard }: Readonly<{ children: React.ReactNode; variant?: "teacher" | "admin"; navigationGuard?: NavigationGuard }>) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <div className="teacherShell">
      <header className="appHeader">
        <Link className="brand" to={variant === "admin" ? "/admin" : "/teacher/subjects"} onClick={(event) => guardNavigation(event, navigationGuard)}>
          <span className="brandMark" aria-hidden="true">S</span>
          <span>
            <strong>SANSUN学園</strong>
            <small>成績管理</small>
          </span>
        </Link>
        <button
          className="menuButton"
          type="button"
          aria-controls="mobile-teacher-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? "メニューを閉じる" : "メニューを開く"}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          {isMenuOpen ? <X aria-hidden="true" /> : <MenuIcon aria-hidden="true" />}
        </button>
      </header>
      {isMenuOpen ? <button className="mobileNavOverlay" type="button" aria-label="メニューを閉じる" onClick={() => setIsMenuOpen(false)} /> : null}
      <nav className={isMenuOpen ? "mobileNav mobileNavOpen" : "mobileNav"} id="mobile-teacher-navigation" aria-label={variant === "admin" ? "専任職員メニュー" : "講師メニュー"}>
        {variant === "admin" ? <AdminNavigation navigationGuard={navigationGuard} onNavigate={() => setIsMenuOpen(false)} /> : <TeacherNavigation navigationGuard={navigationGuard} onNavigate={() => setIsMenuOpen(false)} />}
      </nav>
      <div className="appBody">
        <nav className="sideNav" aria-label={variant === "admin" ? "専任職員メニュー" : "講師メニュー"}>
          {variant === "admin" ? <AdminNavigation navigationGuard={navigationGuard} /> : <TeacherNavigation navigationGuard={navigationGuard} />}
        </nav>
        <main className="teacherMain">{children}</main>
      </div>
    </div>
  );
}
