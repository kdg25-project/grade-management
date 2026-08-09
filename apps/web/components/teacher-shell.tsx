"use client";

import Link from "next/link";
import { BookOpenCheck, ClipboardPenLine, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

function TeacherNavigation({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  return (
    <>
      <p className="navLabel">講師メニュー</p>
      <Link href="/teacher/subjects" onClick={onNavigate}><BookOpenCheck aria-hidden="true" />担当科目</Link>
      <span className="navItemMuted"><ClipboardPenLine aria-hidden="true" />成績入力は科目から選択</span>
      <div className="supportBox">
        <strong>お困りのときは</strong>
        <p>ログインや担当科目については、教務担当へお問い合わせください。</p>
      </div>
    </>
  );
}

export function TeacherShell({ children }: Readonly<{ children: React.ReactNode }>) {
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
        <Link className="brand" href="/teacher/subjects">
          <span className="brandMark" aria-hidden="true">S</span>
          <span>
            <strong>SANSUN学園</strong>
            <small>成績管理</small>
          </span>
        </Link>
        <p className="prototypeHeaderNote">画面確認用・認証ガード未接続</p>
        <button
          className="menuButton"
          type="button"
          aria-controls="mobile-teacher-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? "メニューを閉じる" : "メニューを開く"}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          {isMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </header>
      {isMenuOpen ? <button className="mobileNavOverlay" type="button" aria-label="メニューを閉じる" onClick={() => setIsMenuOpen(false)} /> : null}
      <nav className={isMenuOpen ? "mobileNav mobileNavOpen" : "mobileNav"} id="mobile-teacher-navigation" aria-label="講師メニュー">
        <TeacherNavigation onNavigate={() => setIsMenuOpen(false)} />
      </nav>
      <div className="appBody">
        <nav className="sideNav" aria-label="講師メニュー">
          <TeacherNavigation />
        </nav>
        <main className="teacherMain">{children}</main>
      </div>
    </div>
  );
}
