import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRepoRuntime } from "@/repo/repo-runtime"
import { createBashTool } from "@/tools/bash"
import { installMockRepoFetch } from "./repo-test-utils"

describe("bash tool", () => {
  beforeEach(() => {
    installMockRepoFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("executes commands against the virtual repository shell", async () => {
    const runtime = createRepoRuntime({
      owner: "test-owner",
      ref: "main",
      repo: "test-repo",
    })
    const tool = createBashTool(runtime)

    await tool.execute("call-1", { command: "cd src" })
    const result = await tool.execute("call-2", { command: "pwd" })
    const firstPart = result.content[0]

    expect(firstPart?.type).toBe("text")
    expect(firstPart?.type === "text" ? firstPart.text.trim() : "").toBe("/src")
  })

  it("fails on writes to the read-only repository fs", async () => {
    const runtime = createRepoRuntime({
      owner: "test-owner",
      ref: "main",
      repo: "test-repo",
    })
    const tool = createBashTool(runtime)

    await expect(
      tool.execute("call-3", { command: "echo hi > note.txt" })
    ).rejects.toThrow("Read-only filesystem")
  })
})
