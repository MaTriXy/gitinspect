import { describe, expect, it } from "vitest";
import { encodeCredentialsBase64, formatCredentialsJson } from "../apps/cli/src/lib/output";

describe("cli output", () => {
  const credentials = {
    access: "access-token",
    accountId: "acct-1",
    expires: 123456789,
    providerId: "openai-codex" as const,
    refresh: "refresh-token",
  };

  it("round-trips base64 credentials", () => {
    const encoded = encodeCredentialsBase64(credentials);
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

    expect(decoded).toEqual(credentials);
  });

  it("prints raw json", () => {
    expect(formatCredentialsJson(credentials)).toBe(JSON.stringify(credentials, null, 2));
  });
});
