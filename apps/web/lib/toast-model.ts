export const toastDurationMs = 5_000;

export type ToastMessage = { id: number; message: string };

export const currentToast = (toast: ToastMessage | null, id: number) => toast?.id === id;
