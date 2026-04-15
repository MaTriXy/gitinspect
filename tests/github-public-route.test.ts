import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: {
    GITHUB_PROXY_TOKEN: "proxy-token",
  },
}));

vi.mock("@gitinspect/env/server", () => ({
  env: state.env,
}));

describe("/api/github/$ route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.env.GITHUB_PROXY_TOKEN = "proxy-token";
  });

  it("proxies allowlisted public GitHub paths", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ default_branch: "main", stargazers_count: 1234 }), {
          headers: {
            "Content-Type": "application/json",
            etag: 'W/"repo"',
          },
          status: 200,
          statusText: "OK",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { Route } = await import("@/routes/api/github/$");

    const response = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/repos/acme/demo"),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.github.com/repos/acme/demo"),
      expect.objectContaining({
        headers: expect.any(Headers),
        method: "GET",
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer proxy-token");
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    await expect(response.json()).resolves.toEqual({
      default_branch: "main",
      stargazers_count: 1234,
    });
  });

  it("rejects disallowed paths", async () => {
    const { Route } = await import("@/routes/api/github/$");

    const response = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/repos/acme/demo/contents/README.md"),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub proxy path is not allowed.",
    });
  });

  it("rejects non-GET and non-HEAD methods", async () => {
    const { Route } = await import("@/routes/api/github/$");

    const response = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/repos/acme/demo", {
        method: "POST",
      }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    await expect(response.json()).resolves.toEqual({ error: "Method not allowed" });
  });

  it("returns a clear error when the proxy token is missing", async () => {
    state.env.GITHUB_PROXY_TOKEN = undefined;
    const { Route } = await import("@/routes/api/github/$");

    const response = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/repos/acme/demo"),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub proxy is not configured. Set GITHUB_PROXY_TOKEN.",
    });
  });

  it("proxies org and user list paths used by the org landing page", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL) =>
        new Response(JSON.stringify([{ name: "demo" }]), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { Route } = await import("@/routes/api/github/$");

    const orgRes = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/orgs/acme/repos?per_page=10"),
    });
    expect(orgRes.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.github.com/orgs/acme/repos?per_page=10"),
      expect.any(Object),
    );

    const userReposRes = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/users/acme/repos"),
    });
    expect(userReposRes.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.github.com/users/acme/repos"),
      expect.any(Object),
    );

    const userProfileRes = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/users/acme"),
    });
    expect(userProfileRes.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.github.com/users/acme"),
      expect.any(Object),
    );
  });

  it("sets cache headers on successful proxy responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ language: "TypeScript" }), {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          }),
      ),
    );

    const { Route } = await import("@/routes/api/github/$");

    const response = await Route.options.server.handlers.ANY({
      request: new Request("https://gitinspect.com/api/github/repos/acme/demo/languages"),
    });

    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate=3600");
  });
});
