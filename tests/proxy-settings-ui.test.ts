import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const getProxyConfig = vi.fn();
const setProxyConfig = vi.fn();

vi.mock("@/proxy/settings", () => ({
  DEFAULT_PROXY_URL: "https://proxy.mariozechner.at/proxy",
  getProxyConfig,
  setProxyConfig,
}));

describe("proxy settings ui", () => {
  afterEach(() => {
    cleanup();
    getProxyConfig.mockReset();
    setProxyConfig.mockReset();
  });

  it("renders the Sitegeist proxy copy and saves locally", async () => {
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    });

    const { ProxySettings } = await import("@/components/proxy-settings");

    render(React.createElement(ProxySettings));

    expect(
      screen.getByText(
        /When enabled, OpenAI, OpenAI Codex, OpenCode, and OpenCode Go requests use the proxy/i,
      ),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://proxy.example/proxy")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Proxy base URL"), {
      target: {
        value: "  https://proxy.changed/proxy  ",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save proxy settings" }));

    await waitFor(() => {
      expect(setProxyConfig).toHaveBeenCalledWith({
        enabled: true,
        url: "https://proxy.changed/proxy",
      });
    });
  });
});
