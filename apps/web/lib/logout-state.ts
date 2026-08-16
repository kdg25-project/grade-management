export const logoutFailureMessage = "ログアウトに失敗しました。時間をおいて再度お試しください。";

export function shouldStartLogout(isPending: boolean, navigationGuard: () => boolean) {
  return !isPending && navigationGuard();
}

export function logoutErrorMessage(result: { error?: unknown } | null | undefined) {
  return result?.error ? logoutFailureMessage : null;
}
