import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProxiedUrl } from "@/proxy/url";
import { postTokenRequest } from "@/auth/oauth-utils";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

describe("proxy helpers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = Object.assign(fetchMock, {
      preconnect: originalFetch.preconnect,
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalizes proxy bases and preserves target urls", () => {
    expect(
      buildProxiedUrl("https://proxy.example/proxy/", "https://api.example/v1/messages?x=1&y=two"),
    ).toBe(
      "https://proxy.example/proxy/?url=https%3A%2F%2Fapi.example%2Fv1%2Fmessages%3Fx%3D1%26y%3Dtwo",
    );
  });

  it("applies the initial provider policy", () => {
    expect('{"providerId":"anthropic"}'.startsWith("{")).toBe(true);
    expect("sk-ant-oat-1".startsWith("sk-ant-oat")).toBe(true);
    expect("sk-ant-api-1".startsWith("sk-ant-oat")).toBe(false);
  });

  it("rewrites token posts through the proxy when requested", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
        },
        status: 200,
      }),
    );

    await postTokenRequest(
      "https://example.com/token",
      {
        client_id: "client",
      },
      {
        proxyUrl: "https://proxy.example/proxy",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://proxy.example/proxy/?url=https%3A%2F%2Fexample.com%2Ftoken",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        client_id: "client",
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });
});
