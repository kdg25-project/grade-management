export const toastDurationMs = 5_000;

export type ToastKind = "success" | "error" | "info";

export type ToastMessage = { id: number; kind: ToastKind; message: string };

export const currentToast = (toast: ToastMessage | null, id: number) => toast?.id === id;
