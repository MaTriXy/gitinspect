import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("popup oauth flow", () => {
  let originalClosed: PropertyDescriptor | undefined;
  let originalOpen: typeof window.open;

  beforeEach(() => {
    originalClosed = Object.getOwnPropertyDescriptor(window, "closed");
    originalOpen = window.open;
  });

  afterEach(() => {
    if (originalClosed) {
      Object.defineProperty(window, "closed", originalClosed);
    } else {
      delete (window as { closed?: boolean }).closed;
    }

    window.open = originalOpen;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves when the callback message arrives from the same origin", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    Object.defineProperty(window, "closed", {
      configurable: true,
      get: () => false,
    });
    window.open = vi.fn(() => window);

    const { runPopupOAuthFlow } = await import("@/auth/popup-flow");
    const promise = runPopupOAuthFlow("https://example.com/oauth");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "oauth-callback",
          url: "http://localhost/auth/callback?code=code-1&state=state-1",
        },
        origin: window.location.origin,
      }),
    );

    await expect(promise).resolves.toEqual(
      new URL("http://localhost/auth/callback?code=code-1&state=state-1"),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects when the popup closes before the callback arrives", async () => {
    vi.useFakeTimers();
    let closed = false;
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    Object.defineProperty(window, "closed", {
      configurable: true,
      get: () => closed,
    });
    window.open = vi.fn(() => window);

    const { runPopupOAuthFlow } = await import("@/auth/popup-flow");
    const promise = runPopupOAuthFlow("https://example.com/oauth");
    const assertion = expect(promise).rejects.toThrow(
      "OAuth popup was closed before completing login",
    );
    closed = true;

    await vi.advanceTimersByTimeAsync(250);

    await assertion;
    expect(close).toHaveBeenCalledTimes(1);
  });
});
