import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

import { currentToast, toastDurationMs, type ToastKind, type ToastMessage } from "@/lib/toast-model";

type ToastContextValue = {
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  showSuccess: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const location = useLocation();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [, setDialogRevision] = useState(0);
  const nextId = useRef(0);
  const previousLocationKey = useRef(location.key);

  const dismiss = useCallback((id?: number) => {
    setToast((current) => id === undefined || currentToast(current, id) ? null : current);
  }, []);
  const show = useCallback((kind: ToastKind, message: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, kind, message });
  }, []);
  const showSuccess = useCallback((message: string) => show("success", message), [show]);
  const showError = useCallback((message: string) => show("error", message), [show]);
  const showInfo = useCallback((message: string) => show("info", message), [show]);

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timer = window.setTimeout(() => dismiss(toast.id), toastDurationMs);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast]);
  useEffect(() => {
    if (previousLocationKey.current !== location.key) dismiss();
    previousLocationKey.current = location.key;
  }, [dismiss, location.key]);
  useEffect(() => {
    const refreshDialogHost = (event: Event) => {
      if (event.target instanceof HTMLDialogElement) setDialogRevision((value) => value + 1);
    };
    document.addEventListener("close", refreshDialogHost, true);
    document.addEventListener("toggle", refreshDialogHost, true);
    return () => {
      document.removeEventListener("close", refreshDialogHost, true);
      document.removeEventListener("toggle", refreshDialogHost, true);
    };
  }, []);

  const toastContent = toast ? <div className="toastViewport" aria-atomic="true" aria-live={toast.kind === "error" ? "assertive" : "polite"}><div className={`${toast.kind}Toast`} role={toast.kind === "error" ? "alert" : "status"}><span>{toast.message}</span><button aria-label="通知を閉じる" type="button" onClick={() => dismiss(toast.id)}>閉じる</button></div></div> : null;
  // Native dialogs occupy the browser top layer. Host every toast in the open
  // dialog so success, info, and error notifications remain visible there.
  // The dialog lifecycle listener re-homes a toast after its host closes.
  const openDialogContent = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("dialog[open] .appDialogContent");

  return <ToastContext.Provider value={{ showError, showInfo, showSuccess }}>
    {children}
    {toastContent ? openDialogContent ? createPortal(toastContent, openDialogContent) : toastContent : null}
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
