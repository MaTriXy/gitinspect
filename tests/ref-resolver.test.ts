import { beforeEach, describe, expect, it, vi } from "vitest";

const githubApiFetchMock = vi.fn<(path: string) => Promise<Response>>();

vi.mock("@/repo/github-fetch", () => ({
  githubApiFetch: (path: string) => githubApiFetchMock(path),
}));

function createJsonResponse(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}

function createNotFoundResponse(): Response {
  return createJsonResponse({ message: "Not Found" }, 404);
}

function createCommitResponse(sha: string): Response {
  return createJsonResponse({ sha });
}

describe("resolveRepoTarget", () => {
  beforeEach(() => {
    githubApiFetchMock.mockReset();
  });

  it("resolves bare owner/repo input to the default branch", async () => {
    githubApiFetchMock.mockImplementation(async (path) => {
      if (path === "/repos/acme/demo") {
        return createJsonResponse({ default_branch: "main" });
      }

      if (path === "/repos/acme/demo/commits/heads%2Fmain") {
        return createCommitResponse("commit-main");
      }

      return createNotFoundResponse();
    });

    const { resolveRepoTarget } = await import("@/repo/ref-resolver");

    await expect(
      resolveRepoTarget({
        owner: "acme",
        repo: "demo",
      }),
    ).resolves.toEqual({
      owner: "acme",
      ref: "main",
      refOrigin: "default",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/main",
        fullRef: "refs/heads/main",
        kind: "branch",
        name: "main",
      },
      token: undefined,
    });
  });

  it("resolves explicit branches", async () => {
    githubApiFetchMock.mockImplementation(async (path) => {
      if (path === "/repos/acme/demo/commits/heads%2Fcanary") {
        return createCommitResponse("commit-canary");
      }

      if (path === "/repos/acme/demo/commits/tags%2Fcanary") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/canary") {
        return createNotFoundResponse();
      }

      return createNotFoundResponse();
    });

    const { resolveRepoTarget } = await import("@/repo/ref-resolver");

    await expect(
      resolveRepoTarget({
        owner: "acme",
        ref: "canary",
        repo: "demo",
      }),
    ).resolves.toMatchObject({
      ref: "canary",
      refOrigin: "explicit",
      resolvedRef: {
        apiRef: "heads/canary",
        fullRef: "refs/heads/canary",
        kind: "branch",
        name: "canary",
      },
    });
  });

  it("resolves explicit tags", async () => {
    githubApiFetchMock.mockImplementation(async (path) => {
      if (path === "/repos/acme/demo/commits/heads%2Fv1.2.3") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/tags%2Fv1.2.3") {
        return createCommitResponse("commit-tag");
      }

      if (path === "/repos/acme/demo/commits/v1.2.3") {
        return createNotFoundResponse();
      }

      return createNotFoundResponse();
    });

    const { resolveRepoTarget } = await import("@/repo/ref-resolver");

    await expect(
      resolveRepoTarget({
        owner: "acme",
        ref: "v1.2.3",
        repo: "demo",
      }),
    ).resolves.toMatchObject({
      ref: "v1.2.3",
      refOrigin: "explicit",
      resolvedRef: {
        apiRef: "tags/v1.2.3",
        fullRef: "refs/tags/v1.2.3",
        kind: "tag",
        name: "v1.2.3",
      },
    });
  });

  it("resolves commit shas", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";

    githubApiFetchMock.mockImplementation(async (path) => {
      if (path === `/repos/acme/demo/commits/${sha}`) {
        return createCommitResponse(sha);
      }

      return createNotFoundResponse();
    });

    const { resolveRepoTarget } = await import("@/repo/ref-resolver");

    await expect(
      resolveRepoTarget({
        owner: "acme",
        ref: sha,
        repo: "demo",
      }),
    ).resolves.toMatchObject({
      ref: sha,
      refOrigin: "explicit",
      resolvedRef: {
        kind: "commit",
        sha,
      },
    });
  });

  it("resolves deep tree URLs with slash refs", async () => {
    githubApiFetchMock.mockImplementation(async (path) => {
      if (path === "/repos/acme/demo/commits/heads%2Ffeature%2Ffoo%2Fsrc%2Flib") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/tags%2Ffeature%2Ffoo%2Fsrc%2Flib") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/heads%2Ffeature%2Ffoo%2Fsrc") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/tags%2Ffeature%2Ffoo%2Fsrc") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/heads%2Ffeature%2Ffoo") {
        return createCommitResponse("commit-feature-foo");
      }

      return createNotFoundResponse();
    });

    const { resolveRepoTarget } = await import("@/repo/ref-resolver");

    await expect(
      resolveRepoTarget({
        owner: "acme",
        refPathTail: "feature/foo/src/lib",
        repo: "demo",
      }),
    ).resolves.toMatchObject({
      ref: "feature/foo",
      refOrigin: "explicit",
      resolvedRef: {
        apiRef: "heads/feature/foo",
        fullRef: "refs/heads/feature/foo",
        kind: "branch",
        name: "feature/foo",
      },
    });
  });

  it("resolves deep blob URLs with slash refs", async () => {
    githubApiFetchMock.mockImplementation(async (path) => {
      if (path === "/repos/acme/demo/commits/heads%2Frelease%2Fcandidate%2FREADME.md") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/tags%2Frelease%2Fcandidate%2FREADME.md") {
        return createNotFoundResponse();
      }

      if (path === "/repos/acme/demo/commits/heads%2Frelease%2Fcandidate") {
        return createCommitResponse("commit-release-candidate");
      }

      return createNotFoundResponse();
    });

    const { resolveRepoTarget } = await import("@/repo/ref-resolver");

    await expect(
      resolveRepoTarget({
        owner: "acme",
        refPathTail: "release/candidate/README.md",
        repo: "demo",
      }),
    ).resolves.toMatchObject({
      ref: "release/candidate",
      refOrigin: "explicit",
      resolvedRef: {
        apiRef: "heads/release/candidate",
        fullRef: "refs/heads/release/candidate",
        kind: "branch",
        name: "release/candidate",
      },
    });
  });
});
