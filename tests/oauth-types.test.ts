import { describe, expect, it } from "vitest";
import {
  isOAuthCredentials,
  parseOAuthCredentials,
  serializeOAuthCredentials,
} from "@/auth/oauth-types";

describe("oauth type helpers", () => {
  it("serializes and parses OAuth credentials", () => {
    const serialized = serializeOAuthCredentials({
      access: "access-1",
      expires: 123,
      providerId: "openai-codex",
      refresh: "refresh-1",
    });

    expect(isOAuthCredentials(serialized)).toBe(true);
    expect(parseOAuthCredentials(serialized)).toEqual({
      access: "access-1",
      expires: 123,
      providerId: "openai-codex",
      refresh: "refresh-1",
    });
  });
});
