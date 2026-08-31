import { destinationForUser, isAllowedRoute, type SessionUser } from "./session-routing";

export type RequestedLocation = { pathname: string; search?: string };

export function allowedLoginDestination(user: SessionUser, requested: RequestedLocation | null | undefined) {
  const defaultDestination = destinationForUser(user);
  if (defaultDestination === "/account-inactive" || defaultDestination === "/change-password") return defaultDestination;
  if (!requested || !requested.pathname.startsWith("/") || requested.pathname.startsWith("//") || !isAllowedRoute(requested.pathname, user)) return defaultDestination;
  return `${requested.pathname}${requested.search?.startsWith("?") ? requested.search : ""}`;
}

/**
 * Derives the post-login location from the user returned by Better Auth's
 * successful sign-in response. A newly written session cookie may not be
 * observable by an immediate follow-up getSession() request yet.
 */
export function destinationForSignedInUser(user: SessionUser | null | undefined, requested?: RequestedLocation | null) {
  return user ? allowedLoginDestination(user, requested) : null;
}
