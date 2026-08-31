/** The current-session marker is deliberately separate from Better Auth's session lifecycle. */
export type ActiveUserSession = { userId: string; token: string };

export type ActiveUserSessionPolicy = {
  activate: (session: ActiveUserSession) => Promise<void>;
  permits: (session: ActiveUserSession) => Promise<boolean>;
};

const upsertActiveUserSession = `
  INSERT INTO active_user_sessions (user_id, session_token, updated_at)
  VALUES (?, ?, unixepoch())
  ON CONFLICT(user_id) DO UPDATE SET
    session_token = excluded.session_token,
    updated_at = excluded.updated_at
`;

/**
 * A single D1 statement serializes the hand-off between sessions for a user. The marker, not
 * physical deletion of an old Better Auth session, is the authorization source of truth.
 */
export const createActiveUserSessionPolicy = (database: D1Database): ActiveUserSessionPolicy => ({
  activate: async ({ userId, token }) => {
    await database.prepare(upsertActiveUserSession).bind(userId, token).run();
  },
  permits: async ({ userId, token }) => {
    try {
      const marker = await database.prepare(
        "SELECT session_token FROM active_user_sessions WHERE user_id=? LIMIT 1",
      ).bind(userId).first<{ session_token: string }>();
      return marker?.session_token === token;
    } catch {
      // A policy-store failure must never become an authorization bypass.
      return false;
    }
  },
});

/**
 * These endpoints either establish/recover a session or clear it. All other Better Auth
 * endpoints with an existing session must pass the active-session marker check.
 */
const sessionPolicyBypassPaths = new Set([
  "/sign-in/email",
  "/sign-in/social",
  "/sign-up/email",
  "/callback/:provider",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/request-password-reset/callback",
  "/reset-password",
  "/sign-out",
]);

export const bypassesActiveSessionPolicy = (path: string | undefined) =>
  path !== undefined && (
    sessionPolicyBypassPaths.has(path) || path.startsWith("/callback/")
  );

export const sessionIdentity = (session: {
  session?: { token?: string } | null;
  user?: { id?: string } | null;
} | null | undefined): ActiveUserSession | null => {
  const userId = session?.user?.id;
  const token = session?.session?.token;
  return typeof userId === "string" && typeof token === "string" ? { userId, token } : null;
};
