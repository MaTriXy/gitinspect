import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { AuthCallbackPage } from "@/components/auth-callback-page";

describe("auth callback page", () => {
  let originalOpener: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalOpener = Object.getOwnPropertyDescriptor(window, "opener");
  });

  afterEach(() => {
    if (originalOpener) {
      Object.defineProperty(window, "opener", originalOpener);
    } else {
      delete (window as { opener?: Window }).opener;
    }

    vi.restoreAllMocks();
    cleanup();
  });

  it("posts the callback url to the opener and closes the popup", async () => {
    const postMessage = vi.fn();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});

    Object.defineProperty(window, "opener", {
      configurable: true,
      value: {
        postMessage,
      },
    });

    render(React.createElement(AuthCallbackPage));

    expect(screen.getByText("Completing login...")).toBeTruthy();

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "oauth-callback",
          url: window.location.href,
        },
        window.location.origin,
      );
    });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
