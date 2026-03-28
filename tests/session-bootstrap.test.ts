import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RepoTarget, SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"
import { BootstrapFailedRuntimeError } from "@/agent/runtime-command-errors"

const createSessionForChat = vi.fn()
const createSessionForRepo = vi.fn()
const persistSessionSnapshot = vi.fn(async () => {})
const appendSessionNotice = vi.fn(async () => {})
const resolveRepoSource = vi.fn()
const send = vi.fn(async () => {})

vi.mock("@/sessions/session-actions", () => ({
  createSessionForChat,
  createSessionForRepo,
}))

vi.mock("@/sessions/session-service", () => ({
  persistSessionSnapshot,
}))

vi.mock("@/sessions/session-notices", () => ({
  appendSessionNotice,
}))

vi.mock("@/repo/settings", () => ({
  resolveRepoSource,
}))

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    send,
  },
}))

function buildSession(overrides: Partial<SessionData> = {}): SessionData {
  const session = {
    bootstrapStatus: "ready" as const,
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex" as const,
    providerGroup: "openai-codex" as const,
    repoSource: undefined,
    thinkingLevel: "medium" as const,
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
    ...overrides,
  }

  return session
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("bootstrapSessionAndSend", () => {
  beforeEach(() => {
    appendSessionNotice.mockReset()
    createSessionForChat.mockReset()
    createSessionForRepo.mockReset()
    persistSessionSnapshot.mockReset()
    resolveRepoSource.mockReset()
    send.mockReset()
  })

  it("boots a repo-backed session and marks it as bootstrap until prompt persistence", async () => {
    const repoTarget: RepoTarget = {
      owner: "acme",
      repo: "demo",
    }
    const session = buildSession({
      id: "session-repo",
      repoSource: {
        owner: "acme",
        ref: "main",
        repo: "demo",
      },
    })

    resolveRepoSource.mockResolvedValue(session.repoSource)
    createSessionForRepo.mockResolvedValue(session)

    const { bootstrapSessionAndSend } = await import(
      "@/sessions/session-bootstrap"
    )

    const result = await bootstrapSessionAndSend({
      content: "hello",
      draft: {
        model: session.model,
        provider: session.provider,
        providerGroup: session.providerGroup,
        thinkingLevel: session.thinkingLevel,
      },
      repoTarget,
    })

    expect(resolveRepoSource).toHaveBeenCalledWith(repoTarget)
    expect(createSessionForRepo).toHaveBeenCalledWith({
      base: {
        model: session.model,
        provider: session.provider,
        providerGroup: session.providerGroup,
        thinkingLevel: session.thinkingLevel,
      },
      owner: "acme",
      ref: "main",
      repo: "demo",
    })
    expect(persistSessionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapStatus: "bootstrap",
        id: "session-repo",
      })
    )
    expect(send).toHaveBeenCalledWith("session-repo", "hello")
    expect(result.bootstrapStatus).toBe("bootstrap")
  })

  it("persists bootstrap failures as chat-visible notices", async () => {
    const session = buildSession()
    createSessionForChat.mockResolvedValue(session)
    send.mockRejectedValue(new Error("bootstrap failed"))

    const { bootstrapSessionAndSend } = await import(
      "@/sessions/session-bootstrap"
    )

    await bootstrapSessionAndSend({
      content: "hello",
      draft: {
        model: session.model,
        provider: session.provider,
        providerGroup: session.providerGroup,
        thinkingLevel: session.thinkingLevel,
      },
    })

    await flushMicrotasks()

    expect(appendSessionNotice).toHaveBeenCalledWith(
      "session-1",
      expect.any(BootstrapFailedRuntimeError),
      expect.objectContaining({
        bootstrapStatus: "failed",
        clearStreaming: true,
        rewriteStreamingAssistant: true,
      })
    )
  })
})
