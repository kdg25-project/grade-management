import type { AppType } from "@grade-management/api/app";
import { hc } from "hono/client";
import type { ClientRequestOptions } from "hono/client";

export const createApiClient = (baseUrl = "/", options?: ClientRequestOptions) =>
  hc<AppType>(baseUrl, options);

export const apiClient = createApiClient();
