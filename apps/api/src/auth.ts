import { createDb } from "@grade-management/db";
import * as schema from "@grade-management/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

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

const required = (value: string | undefined, name: string) => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
};

const trustedOrigins = (value: string) =>
  value.split(",").map((origin) => origin.trim()).filter(Boolean);

/** Creates request-scoped auth to keep Worker bindings out of module scope. */
export const createAuth = (env: AuthEnvironment, executionCtx?: ExecutionContext) => {
  const emailSender = createPasswordResetEmailSender(
    env.EMAIL,
    env.EMAIL_FROM,
    env.EMAIL_DELIVERY_ENABLED === "true",
  );

  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite", schema }),
    secret: required(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    baseURL: required(env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    trustedOrigins: trustedOrigins(required(env.BETTER_AUTH_TRUSTED_ORIGINS, "BETTER_AUTH_TRUSTED_ORIGINS")),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      resetPasswordTokenExpiresIn: 1_800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const delivery = emailSender.send({ to: user.email, resetUrl: url });
        if (executionCtx) {
          executionCtx.waitUntil(
            delivery.catch((error: unknown) => {
              console.error(JSON.stringify({ event: "password_reset_email_failed", error: String(error) }));
            }),
          );
          return;
        }
        await delivery;
      },
    },
    user: {
      additionalFields: {
        role: { type: ["admin", "teacher"], required: true, defaultValue: "teacher", input: false },
        status: { type: ["active", "leave", "retired"], required: true, defaultValue: "active", input: false },
        mustChangePassword: { type: "boolean", required: true, defaultValue: true, input: false },
      },
    },
    session: { expiresIn: 600, updateAge: 60 },
  });
};

export type Auth = ReturnType<typeof createAuth>;
