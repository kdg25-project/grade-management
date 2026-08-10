import { createWorkerApp } from "./app";
import type { AuthEnvironment } from "./auth";

export default {
  fetch(request, env: AuthEnvironment, ctx) {
    return createWorkerApp(env, ctx).fetch(request);
  },
} satisfies ExportedHandler<AuthEnvironment>;
