import type { Context, MiddlewareHandler } from "hono";

import type { ActiveUserSessionPolicy } from "./session-policy";

export const userRoles = ["admin", "teacher"] as const;
export type UserRole = (typeof userRoles)[number];

export const userStatuses = ["active", "leave", "retired"] as const;
export type UserStatus = (typeof userStatuses)[number];

export type AuthenticatedUser = {
  id: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
};

export type AuthSession = {
  session: { id: string; token: string; expiresAt: Date };
  user: AuthenticatedUser;
};

export type AuthVariables = { authUser: AuthenticatedUser; authSession: AuthSession };
type AuthContext = Context<{ Variables: AuthVariables }>;

export type SessionReader = (headers: Headers) => Promise<AuthSession | null>;

/** Fail closed when a Better Auth session has no current-session marker or the marker store fails. */
export const isCurrentUserSession = async (
  session: AuthSession | null,
  activeUserSessions: ActiveUserSessionPolicy,
) => {
  if (!session) return false;
  try {
    return await activeUserSessions.permits({ userId: session.user.id, token: session.session.token });
  } catch {
    return false;
  }
};

const error = (context: AuthContext, status: 401 | 403, code: string) =>
  context.json({ error: { code } }, status);

/** Validates the authoritative Better Auth session on every business request. */
export const requireAuthenticatedUser = (readSession: SessionReader): MiddlewareHandler<{ Variables: AuthVariables }> =>
  async (context, next) => {
    const session = await readSession(context.req.raw.headers);
    if (!session) return error(context, 401, "UNAUTHENTICATED");

    if (session.user.status !== "active") return error(context, 403, "ACCOUNT_INACTIVE");

    context.set("authUser", session.user);
    context.set("authSession", session);
    await next();
  };

/** Blocks all business routes until a bootstrap password is replaced. */
export const requirePasswordChanged: MiddlewareHandler<{ Variables: AuthVariables }> = async (context, next) => {
  if (context.get("authUser").mustChangePassword) {
    return error(context, 403, "MUST_CHANGE_PASSWORD");
  }
  await next();
};

export const requireRole = (...roles: UserRole[]): MiddlewareHandler<{ Variables: AuthVariables }> =>
  async (context, next) => {
    if (!roles.includes(context.get("authUser").role)) return error(context, 403, "FORBIDDEN");
    await next();
  };

export const toPublicSession = (session: AuthSession) => ({
  user: {
    id: session.user.id,
    role: session.user.role,
    status: session.user.status,
    mustChangePassword: session.user.mustChangePassword,
  },
  session: { expiresAt: session.session.expiresAt.toISOString() },
});
