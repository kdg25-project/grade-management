import { describe, expect, it } from "bun:test";

import { parseJsonc, productionConfigErrors, stripJsoncComments } from "./validate-production-config";

const valid = {
  vars: { BETTER_AUTH_URL: "https://grades.example.jp", BETTER_AUTH_TRUSTED_ORIGINS: "https://grades.example.jp,https://admin.example.jp", EMAIL_FROM: "no-reply@example.jp", EMAIL_DELIVERY_ENABLED: "true" },
  d1_databases: [{ database_id: "80c7cd4a-6501-48c0-92a0-c721aadd8d90" }],
  send_email: [{ allowed_sender_addresses: ["no-reply@example.jp"] }],
};

describe("production deploy configuration", () => {
  it("accepts a complete HTTPS production configuration and preserves URL strings while parsing JSONC", () => {
    expect(productionConfigErrors(valid)).toEqual([]);
    expect(parseJsonc('{ // a comment\n "url": "https://example.jp/a//b" }')).toEqual({ url: "https://example.jp/a//b" });
    expect(stripJsoncComments('/* remove */ {"value":1}')).toBe(' {"value":1}');
  });

  it("rejects each unsafe production setting without echoing its value", () => {
    const invalid = { ...valid, vars: { ...valid.vars, BETTER_AUTH_URL: "http://localhost:5173", BETTER_AUTH_TRUSTED_ORIGINS: "https://grades.example.jp,http://localhost:5173", EMAIL_FROM: "no-reply@example.invalid", EMAIL_DELIVERY_ENABLED: "false" }, d1_databases: [{ database_id: "00000000-0000-0000-0000-000000000000" }], send_email: [{ allowed_sender_addresses: ["another@example.jp"] }] };
    const errors = productionConfigErrors(invalid);
    expect(errors).toContain("BETTER_AUTH_URL must be an HTTPS non-localhost URL");
    expect(errors).toContain("BETTER_AUTH_TRUSTED_ORIGINS must contain only HTTPS non-localhost origins");
    expect(errors).toContain("EMAIL_FROM must be a production sender address");
    expect(errors).toContain("EMAIL_DELIVERY_ENABLED must be true");
    expect(errors).toContain("D1 database_id must be configured and not a placeholder");
    expect(errors).toContain("send_email.allowed_sender_addresses must include EMAIL_FROM");
    expect(errors.join(" ")).not.toContain("localhost:5173");
  });

  it("rejects loopback and unspecified IPv4/IPv6 origins after URL hostname normalization", () => {
    const unsafeOrigins = [
      "https://localhost", "https://console.localhost", "https://127.255.255.255", "https://0.0.0.0",
      "https://[::1]", "https://[0:0:0:0:0:0:0:1]", "https://[::]",
      "https://[::ffff:127.0.0.1]", "https://[0:0:0:0:0:ffff:127.0.0.1]",
    ];
    for (const origin of unsafeOrigins) {
      const errors = productionConfigErrors({ ...valid, vars: { ...valid.vars, BETTER_AUTH_URL: origin, BETTER_AUTH_TRUSTED_ORIGINS: origin } });
      expect(errors).toContain("BETTER_AUTH_URL must be an HTTPS non-localhost URL");
      expect(errors).toContain("BETTER_AUTH_TRUSTED_ORIGINS must contain only HTTPS non-localhost origins");
    }
  });

  it("permits public domain and IPv4 HTTPS origins", () => {
    expect(productionConfigErrors({ ...valid, vars: { ...valid.vars, BETTER_AUTH_URL: "https://198.51.100.25", BETTER_AUTH_TRUSTED_ORIGINS: "https://grades.example.jp,https://198.51.100.25" } })).toEqual([]);
  });
});
