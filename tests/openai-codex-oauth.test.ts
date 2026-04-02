import { beforeEach, describe, expect, it, vi } from "vitest";

const generatePKCE = vi.fn();
const generateState = vi.fn();
const postTokenRequest = vi.fn();
const runPopupOAuthFlow = vi.fn();

vi.mock("@/auth/oauth-utils", () => ({
  generatePKCE,
  generateState,
  postTokenRequest,
}));

vi.mock("@/auth/popup-flow", () => ({
  runPopupOAuthFlow,
}));

function createAccessToken(accountId: string): string {
  const payload = btoa(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  );

  return `header.${payload}.signature`;
}

function createAccessTokenWithoutAccountId(): string {
  const payload = btoa(
    JSON.stringify({
      "https://api.openai.com/auth": {},
    }),
  );

  return `header.${payload}.signature`;
}

describe("openai codex oauth", () => {
  beforeEach(() => {
    generatePKCE.mockReset();
    generateState.mockReset();
    postTokenRequest.mockReset();
    runPopupOAuthFlow.mockReset();
  });

  it("exchanges the callback code for credentials", async () => {
    generatePKCE.mockResolvedValue({
      challenge: "challenge-1",
      verifier: "verifier-1",
    });
    generateState.mockReturnValue("state-1");
    runPopupOAuthFlow.mockResolvedValue(
      new URL("http://localhost/auth/callback?code=code-1&state=state-1"),
    );
    postTokenRequest.mockResolvedValue({
      access_token: createAccessToken("acct-1"),
      expires_in: 3600,
      refresh_token: "refresh-1",
    });

    const { loginOpenAICodex } = await import("@/auth/providers/openai-codex");
    const credentials = await loginOpenAICodex("http://localhost/auth/callback");

    expect(credentials).toMatchObject({
      access: expect.stringContaining("."),
      accountId: "acct-1",
      providerId: "openai-codex",
      refresh: "refresh-1",
    });
  });

  it("refreshes existing credentials", async () => {
    postTokenRequest.mockResolvedValue({
      access_token: createAccessToken("acct-2"),
      expires_in: 7200,
      refresh_token: "refresh-2",
    });

    const { refreshOpenAICodex } = await import("@/auth/providers/openai-codex");
    const credentials = await refreshOpenAICodex({
      access: "old-access",
      expires: Date.now() + 1_000,
      providerId: "openai-codex",
      refresh: "old-refresh",
    });

    expect(credentials).toMatchObject({
      accountId: "acct-2",
      providerId: "openai-codex",
      refresh: "refresh-2",
    });
  });

  it("rejects login tokens without an account id", async () => {
    generatePKCE.mockResolvedValue({
      challenge: "challenge-1",
      verifier: "verifier-1",
    });
    generateState.mockReturnValue("state-1");
    runPopupOAuthFlow.mockResolvedValue(
      new URL("http://localhost/auth/callback?code=code-1&state=state-1"),
    );
    postTokenRequest.mockResolvedValue({
      access_token: createAccessTokenWithoutAccountId(),
      expires_in: 3600,
      refresh_token: "refresh-1",
    });

    const { loginOpenAICodex } = await import("@/auth/providers/openai-codex");

    await expect(loginOpenAICodex("http://localhost/auth/callback")).rejects.toThrow(
      "Failed to extract accountId from token",
    );
  });

  it("rejects refreshed tokens without an account id", async () => {
    postTokenRequest.mockResolvedValue({
      access_token: createAccessTokenWithoutAccountId(),
      expires_in: 7200,
      refresh_token: "refresh-2",
    });

    const { refreshOpenAICodex } = await import("@/auth/providers/openai-codex");

    await expect(
      refreshOpenAICodex({
        access: "old-access",
        expires: Date.now() + 1_000,
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
    ).rejects.toThrow("Failed to extract accountId from refreshed token");
  });
});
