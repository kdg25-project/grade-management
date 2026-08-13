import { createDb } from "@grade-management/db";
import * as schema from "@grade-management/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";

import {
  createPasswordResetCompletionHandler,
  oldSessionWhere,
  rejectsSignIn,
  shouldClearPasswordChangeRequirement,
} from "./auth-policy";
import { createPasswordResetEmailSender, type EmailBinding } from "./email";

export type AuthEnvironment = {
  DB: D1Database;
  EMAIL?: EmailBinding;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_TRUSTED_ORIGINS: string;
  EMAIL_FROM: string;
  EMAIL_DELIVERY_ENABLED?: string;
};

const PASSWORD_RESET_DELIVERY_TIMEOUT_MS = 10_000;

type ResetDelivery = { to: string; resetUrl: string };
type ResetDeliveryWaiter = { email: string; settle: (error?: unknown) => void };

/**
 * Better Auth intentionally converts reset-email failures to a generic successful response.
 * This request-scoped channel lets the admin-only caller wait for the actual delivery attempt,
 * without changing the public, enumeration-safe reset endpoint behavior.
 */
export const createPasswordResetDeliveryChannel = (
  send: (delivery: ResetDelivery) => Promise<void>,
  executionCtx?: ExecutionContext,
  timeoutMs = PASSWORD_RESET_DELIVERY_TIMEOUT_MS,
) => {
  let waiter: ResetDeliveryWaiter | null = null;
  const sendResetPassword = async ({ user, url }: { user: { email: string }; url: string }) => {
    const delivery = send({ to: user.email, resetUrl: url });
    const current = waiter?.email === user.email ? waiter : null;
    if (current) {
      try { await delivery; current.settle(); } catch (error) { current.settle(error); throw error; }
      return;
    }
    if (executionCtx) {
      executionCtx.waitUntil(delivery.catch((error: unknown) => {
        console.error(JSON.stringify({ event: "password_reset_email_failed", error: String(error) }));
      }));
      return;
    }
    await delivery;
  };
  const requestAndWait = async (email: string, request: () => Promise<unknown>) => {
    if (waiter) throw new Error("A password-reset delivery is already pending for this auth request");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delivery = new Promise<void>((resolve, reject) => {
      waiter = { email, settle: (error) => error ? reject(error) : resolve() };
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Password-reset delivery timed out")), timeoutMs);
    });
    // The timeout races the whole Better Auth request, not only the delivery signal: a hung
    // sender can otherwise keep requestPasswordReset() pending before control reaches delivery.
    const operation = Promise.all([Promise.resolve().then(request), delivery]).then(() => undefined);
    try { await Promise.race([operation, timeout]); } finally { if (timer) clearTimeout(timer); waiter = null; }
  };
  return { sendResetPassword, requestAndWait };
};

const required = (value: string | undefined, name: string) => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
};

const trustedOrigins = (value: string) =>
  value.split(",").map((origin) => origin.trim()).filter(Boolean);

const invalidCredentials = () =>
  APIError.from("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });

/** Creates request-scoped auth to keep Worker bindings out of module scope. */
export const createAuthRuntime = (env: AuthEnvironment, executionCtx?: ExecutionContext) => {
  const emailSender = createPasswordResetEmailSender(
    env.EMAIL,
    env.EMAIL_FROM,
    env.EMAIL_DELIVERY_ENABLED === "true",
  );
  const delivery = createPasswordResetDeliveryChannel((message) => emailSender.send(message), executionCtx);

  const auth = betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite", schema }),
    secret: required(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    baseURL: required(env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    trustedOrigins: trustedOrigins(required(env.BETTER_AUTH_TRUSTED_ORIGINS, "BETTER_AUTH_TRUSTED_ORIGINS")),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      resetPasswordTokenExpiresIn: 1_800,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: createPasswordResetCompletionHandler(async (userId) => {
        // Better Auth resolves the reset token and supplies the authoritative user here.
        await env.DB.prepare(
          "UPDATE user SET must_change_password = 0, updated_at = unixepoch() WHERE id = ?",
        ).bind(userId).run();
      }),
      sendResetPassword: delivery.sendResetPassword,
    },
    user: {
      additionalFields: {
        role: { type: ["admin", "teacher"], required: true, defaultValue: "teacher", input: false },
        status: { type: ["active", "leave", "retired"], required: true, defaultValue: "active", input: false },
        mustChangePassword: { type: "boolean", required: true, defaultValue: true, input: false },
      },
    },
    session: { expiresIn: 600, updateAge: 60, cookieCache: { enabled: false } },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const body = context.body as { email?: string; password?: string } | undefined;
        if (context.path !== "/sign-in/email" || !body?.email) return;
        const found = await context.context.internalAdapter.findUserByEmail(body.email);
        const status = (found?.user as { status?: "active" | "leave" | "retired" } | undefined)?.status;
        if (!rejectsSignIn(context.path, status)) return;

        // Keep the rejection indistinguishable from a normal failed sign-in.
        await context.context.password.hash(body.password ?? "");
        throw invalidCredentials();
      }),
      after: createAuthMiddleware(async (context) => {
        if (shouldClearPasswordChangeRequirement(context.path, context.context.returned) && context.context.session?.user.id) {
          await context.context.internalAdapter.updateUser(context.context.session.user.id, { mustChangePassword: false });
        }

        const newSession = context.context.newSession;
        if (!newSession) return;

        // Keep the session created by this request and revoke its older siblings.
        await context.context.adapter.deleteMany({
          model: "session",
          where: oldSessionWhere(newSession.user.id, newSession.session.token),
        });
      }),
    },
  });
  return {
    auth,
    requestPasswordResetAndWait: (email: string) => delivery.requestAndWait(email, () => auth.api.requestPasswordReset({ body: { email, redirectTo: `${env.BETTER_AUTH_URL}/reset-password` } })),
  };
};

export const createAuth = (env: AuthEnvironment, executionCtx?: ExecutionContext) => createAuthRuntime(env, executionCtx).auth;

export type Auth = ReturnType<typeof createAuth>;
