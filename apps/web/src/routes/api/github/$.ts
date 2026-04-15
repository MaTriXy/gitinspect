import { env } from "@gitinspect/env/server";
import { createFileRoute } from "@tanstack/react-router";

const GITHUB_API_BASE_URL = "https://api.github.com";
const ROUTE_PREFIX = "/api/github";
const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
const ALLOWLIST = [
  /^\/repos\/[^/]+\/[^/]+$/,
  /^\/repos\/[^/]+\/[^/]+\/languages$/,
  /^\/repos\/[^/]+\/[^/]+\/readme$/,
  /^\/users\/[^/]+$/,
  /^\/users\/[^/]+\/repos$/,
  /^\/orgs\/[^/]+\/repos$/,
];

function buildCacheHeaders(): Headers {
  const headers = new Headers();
  headers.set("cache-control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  return headers;
}

function isAllowedGitHubPath(pathname: string): boolean {
  return ALLOWLIST.some((pattern) => pattern.test(pathname));
}

function resolveGitHubProxyPath(request: Request): string {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname.startsWith(ROUTE_PREFIX)
    ? requestUrl.pathname.slice(ROUTE_PREFIX.length)
    : "";

  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { headers: buildCacheHeaders(), status });
}

export const Route = createFileRoute("/api/github/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        if (!ALLOWED_METHODS.has(request.method)) {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            headers: {
              allow: "GET, HEAD",
              "content-type": "application/json",
            },
            status: 405,
          });
        }

        if (!env.GITHUB_PROXY_TOKEN) {
          return jsonError("GitHub proxy is not configured. Set GITHUB_PROXY_TOKEN.", 503);
        }

        const requestUrl = new URL(request.url);
        const proxyPath = resolveGitHubProxyPath(request);

        if (!isAllowedGitHubPath(proxyPath)) {
          return jsonError("GitHub proxy path is not allowed.", 403);
        }

        const upstreamUrl = new URL(`${GITHUB_API_BASE_URL}${proxyPath}`);
        upstreamUrl.search = requestUrl.search;

        const headers = new Headers();
        headers.set("Accept", request.headers.get("accept") ?? "application/vnd.github+json");
        headers.set("Authorization", `Bearer ${env.GITHUB_PROXY_TOKEN}`);
        headers.set("X-GitHub-Api-Version", "2022-11-28");

        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch) {
          headers.set("If-None-Match", ifNoneMatch);
        }

        const ifModifiedSince = request.headers.get("if-modified-since");
        if (ifModifiedSince) {
          headers.set("If-Modified-Since", ifModifiedSince);
        }

        const response = await fetch(upstreamUrl, {
          headers,
          method: request.method,
        });

        const responseHeaders = new Headers(response.headers);
        for (const [key, value] of buildCacheHeaders().entries()) {
          responseHeaders.set(key, value);
        }

        return new Response(request.method === "HEAD" ? null : response.body, {
          headers: responseHeaders,
          status: response.status,
          statusText: response.statusText,
        });
      },
    },
  },
});
