import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginCancelledError } from "../apps/cli/src/lib/errors";

const cancelToken = Symbol("cancel-token");
const spinnerMock = {
  clear: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};
const noteMock = vi.fn();
const logMock = {
  info: vi.fn(),
  step: vi.fn(),
  warn: vi.fn(),
};
const textMock = vi.fn();

vi.mock("@clack/prompts", () => ({
  isCancel: (value: string | symbol) => value === cancelToken,
  log: logMock,
  note: noteMock,
  spinner: () => spinnerMock,
  text: textMock,
}));

describe("clack callback bridge", () => {
  beforeEach(() => {
    vi.useRealTimers();
    spinnerMock.clear.mockReset();
    spinnerMock.error.mockReset();
    spinnerMock.message.mockReset();
    spinnerMock.start.mockReset();
    spinnerMock.stop.mockReset();
    noteMock.mockReset();
    logMock.info.mockReset();
    logMock.step.mockReset();
    logMock.warn.mockReset();
    textMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("bridges auth, clipboard, and progress callbacks", async () => {
    textMock.mockResolvedValueOnce("");
    const copyToClipboard = vi.fn().mockResolvedValue(true);
    const { createClackCallbacks } = await import("../apps/cli/src/lib/clack-callbacks");
    const bridge = createClackCallbacks({
      copyToClipboard,
      openBrowserUrl: vi.fn().mockResolvedValue(true),
    });

    bridge.callbacks.onProgress?.("Waiting");
    bridge.callbacks.onAuth({
      instructions: "Finish login",
      url: "https://example.com",
    });

    expect(spinnerMock.start).toHaveBeenCalledWith("Waiting");
    expect(spinnerMock.stop).toHaveBeenCalled();
    expect(noteMock).toHaveBeenCalledWith(
      [
        "1. Open the sign-in link below.",
        "2. Press ENTER below to open it in your browser.",
        "3. Complete the provider login flow in your browser.",
        "4. If the browser callback does not finish automatically, this CLI will ask for the redirect URL or code after a short wait.",
        "",
        "https://example.com",
        "",
        "Finish login",
      ].join("\n"),
      "Authentication",
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copyToClipboard).toHaveBeenCalledWith("https://example.com");
    expect(logMock.step).toHaveBeenCalledWith("Copied the sign-in link to your clipboard.");
    expect(textMock).toHaveBeenCalledWith({
      message: "Press ENTER to open the browser",
      placeholder: undefined,
      signal: undefined,
      validate: undefined,
    });
    expect(logMock.step).toHaveBeenCalledWith("Opened browser.");
  });

  it("returns prompt values", async () => {
    textMock.mockResolvedValueOnce("pasted-code");
    const { createClackCallbacks } = await import("../apps/cli/src/lib/clack-callbacks");
    const bridge = createClackCallbacks();

    await expect(bridge.callbacks.onPrompt({ message: "Enter code" })).resolves.toBe("pasted-code");
  });

  it("delays the manual redirect prompt until needed", async () => {
    vi.useFakeTimers();
    textMock.mockResolvedValueOnce("pasted-code");
    const { createClackCallbacks } = await import("../apps/cli/src/lib/clack-callbacks");
    const bridge = createClackCallbacks({ manualCodePromptDelayMs: 1000 });

    const promptPromise = bridge.callbacks.onManualCodeInput?.();

    expect(textMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promptPromise).resolves.toBe("pasted-code");
  });

  it("cancels a pending delayed manual redirect prompt", async () => {
    vi.useFakeTimers();
    textMock.mockResolvedValueOnce("pasted-code");
    const { createClackCallbacks } = await import("../apps/cli/src/lib/clack-callbacks");
    const bridge = createClackCallbacks({ manualCodePromptDelayMs: 1000 });

    void bridge.callbacks.onManualCodeInput?.();
    bridge.cancelPendingManualCodeInput();

    await vi.advanceTimersByTimeAsync(1000);

    expect(textMock).not.toHaveBeenCalled();
  });

  it("normalizes prompt cancellation", async () => {
    vi.useFakeTimers();
    textMock.mockResolvedValueOnce(cancelToken);
    const { createClackCallbacks } = await import("../apps/cli/src/lib/clack-callbacks");
    const bridge = createClackCallbacks({ manualCodePromptDelayMs: 0 });

    await expect(bridge.callbacks.onManualCodeInput?.()).rejects.toBeInstanceOf(
      LoginCancelledError,
    );
  });
});
