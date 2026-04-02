import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepoRuntime, execInRepoShell } from "@/repo/repo-runtime";
import { installMockRepoFetch, TEST_REPO_SOURCE } from "./repo-test-utils";

describe("repo runtime", () => {
  beforeEach(() => {
    installMockRepoFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves cwd across shell calls", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);

    await execInRepoShell(runtime, "cd src");

    expect(runtime.getCwd()).toBe("/src");

    const result = await execInRepoShell(runtime, "pwd");

    expect(result.stdout.trim()).toBe("/src");
  });
});
