"use client";

import { BookMarked, BookOpenCheck, CalendarCog, ClipboardPenLine, Download, History, Menu as MenuIcon, RotateCcw, ShieldCheck, Upload, UserCog, UserRoundPlus, Users, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { adminNavigationGroups, isNavigationCurrent, teacherNavigationGroups, type NavigationItem } from "@/lib/navigation-model";

type NavigationGuard = () => boolean;
type ShellVariant = "teacher" | "admin";

const navigationIcons: Record<NavigationItem["icon"], LucideIcon> = {
  grades: ShieldCheck,
  search: BookOpenCheck,
  years: CalendarCog,
  rollover: RotateCcw,
  imports: Upload,
  exports: Download,
  students: Users,
  teachers: UserRoundPlus,
  staff: UserCog,
  subjects: BookMarked,
  audit: History,
};

const guardNavigation = (event: React.MouseEvent, guard?: NavigationGuard, close?: () => void) => {
  if (guard && !guard()) event.preventDefault();
  else close?.();
};

function GroupedNavigation({ onNavigate, navigationGuard, variant }: Readonly<{ onNavigate?: () => void; navigationGuard?: NavigationGuard; variant: ShellVariant }>) {
  const { pathname } = useLocation();
  const groups = variant === "admin" ? adminNavigationGroups : teacherNavigationGroups;

  return (
    <>
      {groups.map((group) => (
        <section className="navGroup" key={group.label} aria-label={group.label}>
          <p className="navGroupLabel">{group.label}</p>
          <div className="navGroupItems">
            {group.items.map((item) => {
              const Icon = navigationIcons[item.icon];
              const current = isNavigationCurrent(pathname, item.to, item.match);
              return (
                <NavLink
                  aria-current={current ? "page" : undefined}
                  className={current ? "navLink navLinkCurrent" : "navLink"}
                  end={item.match === "exact"}
                  key={item.to}
                  onClick={(event) => guardNavigation(event, navigationGuard, onNavigate)}
                  to={item.to}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </section>
      ))}
      {variant === "teacher" ? <p className="navItemMuted"><ClipboardPenLine aria-hidden="true" />成績入力は担当科目から選択します。</p> : null}
      <div className="supportBox">
        <strong>お困りのときは</strong>
        <p>{variant === "admin" ? "学生・成績データについては、管理者へお問い合わせください。" : "ログインや担当科目については、教務担当へお問い合わせください。"}</p>
      </div>
    </>
  );
}

export function TeacherShell({ children, variant = "teacher", navigationGuard }: Readonly<{ children: React.ReactNode; variant?: ShellVariant; navigationGuard?: NavigationGuard }>) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const appBodyRef = useRef<HTMLDivElement>(null);
  const wasMenuOpen = useRef(false);
  const menuLabel = variant === "admin" ? "専任職員メニュー" : "講師メニュー";
  const roleContext = variant === "admin" ? "専任職員用" : "講師用";
  const closeMenu = () => setIsMenuOpen(false);

  useEffect(() => {
    if (!isMenuOpen) {
      if (wasMenuOpen.current) {
        wasMenuOpen.current = false;
        menuButtonRef.current?.focus();
      }
      return;
    }

    wasMenuOpen.current = true;
    const body = typeof document === "undefined" ? null : document.body;
    const appBody = appBodyRef.current;
    const previousBodyOverflow = body?.style.overflow;
    const previousAriaHidden = appBody ? appBody.getAttribute("aria-hidden") : null;
    const wasInert = appBody?.hasAttribute("inert") ?? false;
    if (body) body.style.overflow = "hidden";
    if (appBody) {
      appBody.setAttribute("aria-hidden", "true");
      appBody.setAttribute("inert", "");
    }
    const focusDrawer = window.requestAnimationFrame(() => mobileCloseButtonRef.current?.focus());
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(focusDrawer);
      document.removeEventListener("keydown", trapFocus);
      if (body) body.style.overflow = previousBodyOverflow ?? "";
      if (appBody) {
        if (previousAriaHidden === null) appBody.removeAttribute("aria-hidden");
        else appBody.setAttribute("aria-hidden", previousAriaHidden);
        if (!wasInert) appBody.removeAttribute("inert");
      }
    };
  }, [isMenuOpen]);

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
        <p className="appRoleContext">{roleContext}</p>
        <button
          ref={menuButtonRef}
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
      {isMenuOpen ? <button className="mobileNavOverlay" type="button" aria-label="メニューを閉じる" onClick={closeMenu} /> : null}
      {isMenuOpen ? (
        <nav ref={drawerRef} className="mobileNav mobileNavOpen" id="mobile-teacher-navigation" aria-label={menuLabel} aria-modal="true" role="dialog">
          <div className="mobileNavHeader">
            <p id="mobile-navigation-title">{menuLabel}</p>
            <button ref={mobileCloseButtonRef} className="mobileNavClose" type="button" aria-label="メニューを閉じる" onClick={closeMenu}><X aria-hidden="true" /></button>
          </div>
          <GroupedNavigation variant={variant} navigationGuard={navigationGuard} onNavigate={closeMenu} />
        </nav>
      ) : null}
      <div ref={appBodyRef} className="appBody">
        <nav className="sideNav" aria-label={menuLabel}>
          <GroupedNavigation variant={variant} navigationGuard={navigationGuard} />
        </nav>
        <main className="teacherMain">{children}</main>
      </div>
    </div>
  );
}
