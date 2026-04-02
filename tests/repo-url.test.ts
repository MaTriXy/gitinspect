import { describe, expect, it } from "vitest";
import {
  githubOwnerAvatarUrl,
  parseRepoPathname,
  parsedPathToRepoTarget,
  repoSourceToPath,
} from "@/repo/url";

describe("parseRepoPathname", () => {
  it("parses owner/repo", () => {
    expect(parseRepoPathname("/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("parses owner/repo/ref when ref is a single segment", () => {
    expect(parseRepoPathname("/vercel/next.js/canary")).toEqual({
      owner: "vercel",
      ref: "canary",
      repo: "next.js",
    });
  });

  it("parses tree with single ref segment", () => {
    expect(parseRepoPathname("/vercel/next.js/tree/main")).toEqual({
      owner: "vercel",
      ref: "main",
      repo: "next.js",
    });
  });

  it("parses blob with ref", () => {
    expect(parseRepoPathname("/vercel/next.js/blob/main/README.md")).toEqual({
      owner: "vercel",
      ref: "main",
      repo: "next.js",
    });
  });

  it("returns repo root for issues", () => {
    expect(parseRepoPathname("/vercel/next.js/issues/1")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });

  it("returns undefined for owner only", () => {
    expect(parseRepoPathname("/vercel")).toBeUndefined();
  });

  it("returns undefined for reserved root", () => {
    expect(parseRepoPathname("/chat")).toBeUndefined();
  });

  it("keeps the full tree tail when branch names may include slashes", () => {
    expect(parseRepoPathname("/vercel/next.js/tree/feature/foo/bar")).toEqual({
      owner: "vercel",
      refPathTail: "feature/foo/bar",
      repo: "next.js",
    });
  });
});

describe("githubOwnerAvatarUrl", () => {
  it("builds github avatar URL for owner", () => {
    expect(githubOwnerAvatarUrl("vercel")).toBe("https://github.com/vercel.png");
  });

  it("encodes special characters in owner", () => {
    expect(githubOwnerAvatarUrl("foo/bar")).toBe("https://github.com/foo%2Fbar.png");
  });
});

describe("parsedPathToRepoTarget", () => {
  it("converts parsed path shapes into raw repo targets", () => {
    expect(
      parsedPathToRepoTarget({
        owner: "acme",
        refPathTail: "feature/foo/src/lib",
        repo: "demo",
      }),
    ).toEqual({
      owner: "acme",
      refPathTail: "feature/foo/src/lib",
      repo: "demo",
    });
  });
});

describe("repoSourceToPath", () => {
  it("omits the default branch from canonical paths", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "main",
        refOrigin: "default",
        repo: "demo",
      }),
    ).toBe("/acme/demo");
  });

  it("includes explicit branch refs in canonical paths", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
      }),
    ).toBe("/acme/demo/feature/foo");
  });

  it("includes explicit tag refs in canonical paths", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "v1.2.3",
        refOrigin: "explicit",
        repo: "demo",
      }),
    ).toBe("/acme/demo/v1.2.3");
  });

  it("includes commit refs when they are explicitly selected", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "0123456789abcdef0123456789abcdef01234567",
        refOrigin: "explicit",
        repo: "demo",
      }),
    ).toBe("/acme/demo/0123456789abcdef0123456789abcdef01234567");
  });
});
