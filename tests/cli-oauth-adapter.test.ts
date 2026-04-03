import { beforeEach, describe, expect, it, vi } from "vitest";

const loginAnthropicMock = vi.fn();
const loginGeminiCliMock = vi.fn();
const loginGitHubCopilotMock = vi.fn();
const loginOpenAICodexMock = vi.fn();

vi.mock("@mariozechner/pi-ai/oauth", () => ({
  loginAnthropic: loginAnthropicMock,
  loginGeminiCli: loginGeminiCliMock,
  loginGitHubCopilot: loginGitHubCopilotMock,
  loginOpenAICodex: loginOpenAICodexMock,
}));

describe("oauth adapter", () => {
  beforeEach(() => {
    loginAnthropicMock.mockReset();
    loginGeminiCliMock.mockReset();
    loginGitHubCopilotMock.mockReset();
    loginOpenAICodexMock.mockReset();
  });

  it("routes openai codex and preserves accountId", async () => {
    loginOpenAICodexMock.mockResolvedValue({
      access: "access",
      accountId: "acct-1",
      expires: 123,
      refresh: "refresh",
    });

    const { loginWithProvider } = await import("../apps/cli/src/lib/oauth-adapter");
    const credentials = await loginWithProvider("openai-codex", {
      onAuth: vi.fn(),
      onPrompt: vi.fn().mockResolvedValue("code"),
    });

    expect(loginOpenAICodexMock).toHaveBeenCalledOnce();
    expect(credentials).toEqual({
      access: "access",
      accountId: "acct-1",
      expires: 123,
      providerId: "openai-codex",
      refresh: "refresh",
    });
  });

  it("routes gemini and preserves projectId", async () => {
    loginGeminiCliMock.mockResolvedValue({
      access: "access",
      expires: 456,
      projectId: "project-1",
      refresh: "refresh",
    });

    const { loginWithProvider } = await import("../apps/cli/src/lib/oauth-adapter");
    const credentials = await loginWithProvider("google-gemini-cli", {
      onAuth: vi.fn(),
      onManualCodeInput: vi.fn().mockResolvedValue("url"),
      onPrompt: vi.fn().mockResolvedValue("ignored"),
    });

    expect(loginGeminiCliMock).toHaveBeenCalledOnce();
    expect(credentials).toEqual({
      access: "access",
      expires: 456,
      projectId: "project-1",
      providerId: "google-gemini-cli",
      refresh: "refresh",
    });
  });

  it("routes copilot through the object callback signature", async () => {
    loginGitHubCopilotMock.mockResolvedValue({
      access: "access",
      expires: 789,
      refresh: "refresh",
    });

    const callbacks = {
      onAuth: vi.fn(),
      onProgress: vi.fn(),
      onPrompt: vi.fn().mockResolvedValue("enterprise.example.com"),
      signal: new AbortController().signal,
    };

    const { loginWithProvider } = await import("../apps/cli/src/lib/oauth-adapter");
    const credentials = await loginWithProvider("github-copilot", callbacks);

    expect(loginGitHubCopilotMock).toHaveBeenCalledOnce();
    expect(credentials).toEqual({
      access: "access",
      expires: 789,
      providerId: "github-copilot",
      refresh: "refresh",
    });
  });
});
