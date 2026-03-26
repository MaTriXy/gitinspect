import { describe, expect, it } from "vitest"
import { githubOwnerAvatarUrl, parseRepoPathname } from "@/repo/url"

describe("parseRepoPathname", () => {
  it("parses owner/repo", () => {
    expect(parseRepoPathname("/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
    })
  })

  it("parses owner/repo/ref when ref is a single segment", () => {
    expect(parseRepoPathname("/vercel/next.js/canary")).toEqual({
      owner: "vercel",
      ref: "canary",
      repo: "next.js",
    })
  })

  it("parses tree with single ref segment", () => {
    expect(parseRepoPathname("/vercel/next.js/tree/main")).toEqual({
      owner: "vercel",
      ref: "main",
      repo: "next.js",
    })
  })

  it("parses blob with ref", () => {
    expect(parseRepoPathname("/vercel/next.js/blob/main/README.md")).toEqual({
      owner: "vercel",
      ref: "main",
      repo: "next.js",
    })
  })

  it("returns repo root for issues", () => {
    expect(parseRepoPathname("/vercel/next.js/issues/1")).toEqual({
      owner: "vercel",
      repo: "next.js",
    })
  })

  it("returns undefined for owner only", () => {
    expect(parseRepoPathname("/vercel")).toBeUndefined()
  })

  it("returns undefined for reserved root", () => {
    expect(parseRepoPathname("/chat")).toBeUndefined()
  })

  it("omits ref when tree has deep paths (ambiguous branch)", () => {
    expect(
      parseRepoPathname("/vercel/next.js/tree/feature/foo/bar")
    ).toEqual({
      owner: "vercel",
      repo: "next.js",
    })
  })
})

describe("githubOwnerAvatarUrl", () => {
  it("builds github avatar URL for owner", () => {
    expect(githubOwnerAvatarUrl("vercel")).toBe("https://github.com/vercel.png")
  })

  it("encodes special characters in owner", () => {
    expect(githubOwnerAvatarUrl("foo/bar")).toBe("https://github.com/foo%2Fbar.png")
  })
})
