import { Hono } from "hono";

import { createAuth, createAuthRuntime, type AuthEnvironment } from "./auth";
import {
  requireAuthenticatedUser,
  requirePasswordChanged,
  requireRole,
  toPublicSession,
  type AuthSession,
  type AuthVariables,
  type SessionReader,
} from "./authorization";
import { createGradeRoutes } from "./grade/routes";
import { createGradeService, type GradeService } from "./grade/service";
import { createAdminMasterRoutes } from "./admin/routes";
import { createAdminMasterService, type AdminMasterService, unavailableAdminMasterService } from "./admin/service";
import { createAuditRoutes } from "./admin/audit-routes";
import { createAuditService, type AuditService, unavailableAuditService } from "./admin/audit";
import { createRolloverRoutes } from "./admin/rollover-routes";
import { createRolloverService, type D1RolloverService } from "./admin/rollover";
import { createGradeExportRoutes } from "./admin/grade-export-routes";
import { createGradeExportService, type GradeExportService, unavailableGradeExportService } from "./admin/grade-export";
import { createNormalImportRoutes } from "./admin/import-routes";
import { createNormalImportService, type NormalImportService, unavailableNormalImportService } from "./admin/import-service";

export type AuthHandler = (request: Request) => Response | Promise<Response>;
export type AppDependencies = { authHandler: AuthHandler; readSession: SessionReader; gradeService: GradeService; adminMasterService?: AdminMasterService; auditService?: AuditService; rolloverService?: Pick<D1RolloverService, "preview" | "apply">; gradeExportService?: GradeExportService; normalImportService?: NormalImportService };

export const createApp = ({ authHandler, readSession, gradeService, adminMasterService, auditService, rolloverService, gradeExportService, normalImportService }: AppDependencies) =>
  new Hono<{ Variables: AuthVariables }>()
    .basePath("/api")
    .on(["GET", "POST"], "/auth/*", (c) => authHandler(c.req.raw))
    .get("/health", (c) => c.json({ status: "ok" as const, service: "grade-management-api" as const }))
    .get("/session", requireAuthenticatedUser(readSession), (c) => c.json(toPublicSession(c.get("authSession"))))
    .get("/teacher/session", requireAuthenticatedUser(readSession), requirePasswordChanged, requireRole("teacher"), (c) => c.json({ role: c.get("authUser").role }))
    .get("/admin/session", requireAuthenticatedUser(readSession), requirePasswordChanged, requireRole("admin"), (c) => c.json({ role: c.get("authUser").role }))
    .route("/", createGradeRoutes(gradeService, readSession))
    .route("/", createAdminMasterRoutes(adminMasterService ?? unavailableAdminMasterService, readSession))
    .route("/", createAuditRoutes(auditService ?? unavailableAuditService, readSession))
    .route("/", createRolloverRoutes(rolloverService ?? { preview: async () => { throw new Error("unavailable"); }, apply: async () => { throw new Error("unavailable"); } }, readSession))
    .route("/", createGradeExportRoutes(gradeExportService ?? unavailableGradeExportService, readSession))
    .route("/", createNormalImportRoutes(normalImportService ?? unavailableNormalImportService, readSession));

const toAuthSession = (session: Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>): AuthSession | null => {
  if (!session) return null;
  const user = session.user as typeof session.user & { role: "admin" | "teacher"; status: "active" | "leave" | "retired"; mustChangePassword: boolean };
  return {
    session: { id: session.session.id, token: session.session.token, expiresAt: session.session.expiresAt },
    user: { id: user.id, role: user.role, status: user.status, mustChangePassword: user.mustChangePassword },
  };
};

export const createWorkerApp = (env: AuthEnvironment, executionCtx: ExecutionContext) => {
  const { auth, requestPasswordResetAndWait } = createAuthRuntime(env, executionCtx);
  return createApp({
    authHandler: (request) => auth.handler(request),
    readSession: async (headers) => toAuthSession(await auth.api.getSession({ headers })),
    gradeService: createGradeService(env.DB),
    adminMasterService: createAdminMasterService(env.DB, requestPasswordResetAndWait),
    auditService: createAuditService(env.DB),
    rolloverService: createRolloverService(env.DB),
    gradeExportService: createGradeExportService(env.DB),
    normalImportService: createNormalImportService(env.DB),
  });
};

export type AppType = ReturnType<typeof createApp>;
