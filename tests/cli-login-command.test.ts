import { beforeEach, describe, expect, it, vi } from "vitest";

const loginWithProviderMock = vi.fn();

vi.mock("../apps/cli/src/lib/oauth-adapter", async () => {
  const actual = await vi.importActual<typeof import("../apps/cli/src/lib/oauth-adapter")>(
    "../apps/cli/src/lib/oauth-adapter",
  );

  return {
    ...actual,
    loginWithProvider: loginWithProviderMock,
  };
});

describe("login command", () => {
  beforeEach(() => {
    loginWithProviderMock.mockReset();
  });

  it("writes base64 credentials by default", async () => {
    loginWithProviderMock.mockResolvedValue({
      access: "access",
      expires: 123,
      providerId: "openai-codex",
      refresh: "refresh",
      accountId: "acct-1",
    });

    const copyToClipboard = vi.fn().mockResolvedValue(true);
    const write = vi.fn();
    const stopProgress = vi.fn();
    const clearProgress = vi.fn();
    const cancelPendingManualCodeInput = vi.fn();
    const { runLoginCommand } = await import("../apps/cli/src/commands/login");

    await runLoginCommand(
      { printJson: false, providerAlias: "codex" },
      {
        copyToClipboard,
        createCallbacks: () => ({
          callbacks: {
            onAuth: vi.fn(),
            onPrompt: vi.fn().mockResolvedValue("code"),
          },
          cancelPendingManualCodeInput,
          clearProgress,
          stopProgress,
        }),
        write,
      },
    );

    expect(cancelPendingManualCodeInput).toHaveBeenCalledOnce();
    expect(stopProgress).toHaveBeenCalledWith("Login complete");
    expect(clearProgress).not.toHaveBeenCalled();
    expect(copyToClipboard).toHaveBeenCalledWith(
      "eyJhY2Nlc3MiOiJhY2Nlc3MiLCJleHBpcmVzIjoxMjMsInByb3ZpZGVySWQiOiJvcGVuYWktY29kZXgiLCJyZWZyZXNoIjoicmVmcmVzaCIsImFjY291bnRJZCI6ImFjY3QtMSJ9",
    );
    expect(write).toHaveBeenCalledWith(
      "eyJhY2Nlc3MiOiJhY2Nlc3MiLCJleHBpcmVzIjoxMjMsInByb3ZpZGVySWQiOiJvcGVuYWktY29kZXgiLCJyZWZyZXNoIjoicmVmcmVzaCIsImFjY291bnRJZCI6ImFjY3QtMSJ9\n",
    );
  });

  it("writes raw json in print-json mode", async () => {
    loginWithProviderMock.mockResolvedValue({
      access: "access",
      expires: 456,
      providerId: "github-copilot",
      refresh: "refresh",
    });

    const copyToClipboard = vi.fn().mockResolvedValue(true);
    const write = vi.fn();
    const cancelPendingManualCodeInput = vi.fn();
    const { runLoginCommand } = await import("../apps/cli/src/commands/login");

    await runLoginCommand(
      { printJson: true, providerAlias: "copilot" },
      {
        copyToClipboard,
        createCallbacks: () => ({
          callbacks: {
            onAuth: vi.fn(),
            onPrompt: vi.fn().mockResolvedValue("github.com"),
          },
          cancelPendingManualCodeInput,
          clearProgress: vi.fn(),
          stopProgress: vi.fn(),
        }),
        write,
      },
    );

    expect(cancelPendingManualCodeInput).toHaveBeenCalledOnce();

    expect(copyToClipboard).toHaveBeenCalledWith(
      '{\n  "access": "access",\n  "expires": 456,\n  "providerId": "github-copilot",\n  "refresh": "refresh"\n}',
    );
    expect(write).toHaveBeenCalledWith(
      '{\n  "access": "access",\n  "expires": 456,\n  "providerId": "github-copilot",\n  "refresh": "refresh"\n}\n',
    );
  });
});
