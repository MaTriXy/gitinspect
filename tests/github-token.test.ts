import { afterEach, describe, expect, it, vi } from "vitest";
import { validateGithubPersonalAccessToken } from "@/repo/github-token";

describe("validateGithubPersonalAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects empty token", async () => {
    const result = await validateGithubPersonalAccessToken("   ");
    expect(result).toEqual({
      ok: false,
      message: "Token is empty",
    });
  });

  it("returns login on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ login: "octocat" }),
      }),
    );

    const result = await validateGithubPersonalAccessToken("github_pat_x");
    expect(result).toEqual({ ok: true, login: "octocat" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github_pat_x",
        }),
      }),
    );
  });

  it("rejects 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }),
    );

    const result = await validateGithubPersonalAccessToken("bad");
    expect(result).toEqual({
      ok: false,
      message: "Invalid or expired token",
    });
  });

  it("maps network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await validateGithubPersonalAccessToken("tok");
    expect(result).toEqual({
      ok: false,
      message: "Could not reach GitHub — check your connection",
    });
  });
});
