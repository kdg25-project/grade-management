import { type ReactNode, useEffect, useId, useRef } from "react";

type ModalDialogProps = Readonly<{
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  onRequestClose: () => void;
  open: boolean;
  title: string;
}>;

/** A controlled native dialog that keeps keyboard focus within the operation. */
export function ModalDialog({ children, className, dismissible = true, onRequestClose, open, title }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const backdropPointerDown = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!dialog.open) dialog.showModal();
      const frame = requestAnimationFrame(() => {
        const target = dialog.querySelector<HTMLElement>("[autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)");
        target?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (dialog.open) dialog.close();
    triggerRef.current?.focus();
  }, [open]);

  return <dialog
    ref={dialogRef}
    className={["appDialog", className].filter(Boolean).join(" ")}
    aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (dismissible) onRequestClose(); }}
    onPointerDown={(event) => { backdropPointerDown.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      if (dismissible && backdropPointerDown.current && event.target === event.currentTarget) onRequestClose();
      backdropPointerDown.current = false;
    }}
  >
    <section className="appDialogContent">
      <div className="appDialogHeader">
        <h2 id={titleId}>{title}</h2>
        <button className="dialogClose" type="button" aria-label={`${title}を閉じる`} disabled={!dismissible} onClick={onRequestClose}>×</button>
      </div>
      {children}
    </section>
  </dialog>;
}
