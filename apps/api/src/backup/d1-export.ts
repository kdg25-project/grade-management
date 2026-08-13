export class D1ExportError extends Error {
  constructor(readonly code: "D1_EXPORT_START_FAILED" | "D1_EXPORT_POLL_FAILED" | "D1_EXPORT_RESPONSE_INVALID", message: string) { super(message); }
}

export type D1ExportReady = { filename: string; signedUrl: string };
export type D1ExportPoll = { ready: false } | { ready: true; export: D1ExportReady };
/** Minimal structural fetch contract; Workers' fetch additionally exposes preconnect(). */
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ApiResponse = { success?: unknown; result?: unknown };

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const validBookmark = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4_096;
const validUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 8_192) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

/** Cloudflare D1 export REST client. It never logs or persists the API response. */
export class D1ExportClient {
  constructor(private readonly accountId: string, private readonly databaseId: string, private readonly token: string, private readonly fetcher: Fetcher = fetch) {}
  private endpoint() { return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/export`; }
  private async post(body: Record<string, string>, failureCode: D1ExportError["code"], failureMessage: string) {
    let response: Response;
    try { response = await this.fetcher(this.endpoint(), { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new D1ExportError(failureCode, failureMessage); }
    if (!response.ok) throw new D1ExportError(failureCode, failureMessage);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new D1ExportError("D1_EXPORT_RESPONSE_INVALID", "D1エクスポート応答を確認できません。"); }
    const api = record(payload) as ApiResponse | null;
    if (!api || api.success !== true) throw new D1ExportError(failureCode, failureMessage);
    const result = record(api.result);
    if (!result) throw new D1ExportError("D1_EXPORT_RESPONSE_INVALID", "D1エクスポート応答を確認できません。");
    return result;
  }
  async start() {
    const result = await this.post({ output_format: "polling" }, "D1_EXPORT_START_FAILED", "D1エクスポートを開始できません。" );
    if (!validBookmark(result.at_bookmark)) throw new D1ExportError("D1_EXPORT_RESPONSE_INVALID", "D1エクスポート応答を確認できません。");
    return { bookmark: result.at_bookmark };
  }
  async poll(bookmark: string): Promise<D1ExportPoll> {
    const result = await this.post({ current_bookmark: bookmark }, "D1_EXPORT_POLL_FAILED", "D1エクスポートの完了を確認できません。" );
    const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
    if (["complete", "completed", "success", "successful"].includes(status)) {
      // The D1 polling API wraps the finished export payload once more in result.result.
      const completed = record(result.result);
      if (!completed || typeof completed.filename !== "string" || !completed.filename || completed.filename.length > 256 || !validUrl(completed.signed_url)) throw new D1ExportError("D1_EXPORT_RESPONSE_INVALID", "D1エクスポート応答を確認できません。");
      return { ready: true, export: { filename: completed.filename, signedUrl: completed.signed_url } };
    }
    if (["pending", "running", "queued", "in_progress", "processing"].includes(status)) return { ready: false };
    throw new D1ExportError("D1_EXPORT_RESPONSE_INVALID", "D1エクスポート応答を確認できません。");
  }
}
