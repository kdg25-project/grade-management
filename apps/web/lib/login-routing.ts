import { destinationForUser, type SessionUser } from "./session-routing";

/**
 * Derives the post-login location from the user returned by Better Auth's
 * successful sign-in response. A newly written session cookie may not be
 * observable by an immediate follow-up getSession() request yet.
 */
export function destinationForSignedInUser(user: SessionUser | null | undefined) {
  return user ? destinationForUser(user) : null;
}
