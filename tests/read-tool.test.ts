import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepoRuntime } from "@/repo/repo-runtime";
import { createReadTool } from "@/tools/read";
import { installMockRepoFetch, TEST_REPO_SOURCE } from "./repo-test-utils";

describe("read tool", () => {
  beforeEach(() => {
    installMockRepoFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads repository files and pages long content", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);
    const tool = createReadTool(runtime);

    const result = await tool.execute("call-1", {
      limit: 2,
      offset: 2,
      path: "src/long.txt",
    });
    const firstPart = result.content[0];

    expect(firstPart?.type).toBe("text");
    expect(firstPart?.type === "text" ? firstPart.text : "").toContain("line-2");
    expect(firstPart?.type === "text" ? firstPart.text : "").toContain("Use offset=4 to continue.");
    expect(result.details.resolvedPath).toBe("/src/long.txt");
  });

  it("surfaces missing file errors", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);
    const tool = createReadTool(runtime);

    await expect(
      tool.execute("call-2", {
        path: "missing.ts",
      }),
    ).rejects.toThrow("No such file or directory");
  });
});
