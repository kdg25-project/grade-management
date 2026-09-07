import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { currentToast, toastDurationMs, type ToastMessage } from "@/lib/toast-model";

type ToastContextValue = { showSuccess: (message: string) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const location = useLocation();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextId = useRef(0);
  const previousLocationKey = useRef(location.key);

  const dismiss = useCallback((id?: number) => {
    setToast((current) => id === undefined || currentToast(current, id) ? null : current);
  }, []);
  const showSuccess = useCallback((message: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismiss(toast.id), toastDurationMs);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast]);
  useEffect(() => {
    if (previousLocationKey.current !== location.key) dismiss();
    previousLocationKey.current = location.key;
  }, [dismiss, location.key]);

  return <ToastContext.Provider value={{ showSuccess }}>
    {children}
    {toast ? <div className="toastViewport" aria-live="polite" aria-atomic="true"><div className="successToast" role="status"><span>{toast.message}</span><button aria-label="通知を閉じる" type="button" onClick={() => dismiss(toast.id)}>閉じる</button></div></div> : null}
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
