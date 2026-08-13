import { isAPIError } from "better-auth/api";

import type { UserStatus } from "./authorization";

export const isActiveAccount = (status: UserStatus | undefined) => status === "active";

export const rejectsSignIn = (path: string | undefined, status: UserStatus | undefined) =>
  path === "/sign-in/email" && status !== undefined && !isActiveAccount(status);

export const isSuccessfulAuthResponse = (response: unknown) => !isAPIError(response);

export const shouldClearPasswordChangeRequirement = (path: string | undefined, response: unknown) =>
  path === "/change-password" && isSuccessfulAuthResponse(response);

/** Runs only from Better Auth's successful `onPasswordReset` callback. */
export const createPasswordResetCompletionHandler = (clearPasswordRequirement: (userId: string) => Promise<void>) =>
  async ({ user }: { user: { id: string } }) => clearPasswordRequirement(user.id);

export const oldSessionWhere = (userId: string, token: string) => [
  { field: "userId", value: userId },
  { field: "token", operator: "ne" as const, value: token },
];
