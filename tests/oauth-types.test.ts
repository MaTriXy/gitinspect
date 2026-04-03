import { describe, expect, it } from "vitest";
import {
  isOAuthCredentials,
  parseImportedOAuthCredentials,
  parseOAuthCredentials,
  serializeOAuthCredentials,
} from "@/auth/oauth-types";

describe("oauth type helpers", () => {
  it("serializes and parses OAuth credentials", () => {
    const serialized = serializeOAuthCredentials({
      access: "access-1",
      accountId: "acct-1",
      expires: 123,
      providerId: "openai-codex",
      refresh: "refresh-1",
    });

    expect(isOAuthCredentials(serialized)).toBe(true);
    expect(parseOAuthCredentials(serialized)).toEqual({
      access: "access-1",
      accountId: "acct-1",
      expires: 123,
      providerId: "openai-codex",
      refresh: "refresh-1",
    });
  });

  it("parses base64url login codes", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        access: "access-2",
        expires: 456,
        projectId: "project-1",
        providerId: "google-gemini-cli",
        refresh: "refresh-2",
      }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    expect(parseImportedOAuthCredentials(encoded)).toEqual({
      access: "access-2",
      expires: 456,
      projectId: "project-1",
      providerId: "google-gemini-cli",
      refresh: "refresh-2",
    });
  });
});
