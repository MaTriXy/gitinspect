import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageRow, SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"

const loadSessionWithMessages = vi.fn()
const reconcileInterruptedSession = vi.fn(async () => {})
const getGithubPersonalAccessToken = vi.fn(async () => "github-token")
const agentHostDispose = vi.fn()
const agentHostCtor = vi.fn()

vi.mock("@/sessions/session-service", () => ({
  loadSessionWithMessages,
}))

vi.mock("@/sessions/session-notices", () => ({
  reconcileInterruptedSession,
}))

vi.mock("@/repo/github-token", () => ({
  getGithubPersonalAccessToken,
}))

vi.mock("@/agent/agent-host", () => ({
  AgentHost: agentHostCtor.mockImplementation(() => ({
    abort: vi.fn(),
    dispose: agentHostDispose,
    isBusy: () => false,
    prompt: vi.fn(),
    refreshGithubToken: vi.fn(),
    startTurn: vi.fn(),
    setModelSelection: vi.fn(),
    setThinkingLevel: vi.fn(),
  })),
}))

function buildSession(
  overrides: Partial<SessionData> = {}
): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: undefined,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
    ...overrides,
  }
}

function buildMessage(): MessageRow {
  return {
    content: [{ text: "hello", type: "text" }],
    id: "message-1",
    role: "user",
    sessionId: "session-1",
    status: "completed",
    timestamp: 1,
  } as MessageRow
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  }
}

describe("runtime-worker-api", () => {
  beforeEach(async () => {
    await import("@/agent/runtime-worker-api").then(async (api) => {
      await api.dispose()
    })
    loadSessionWithMessages.mockReset()
    reconcileInterruptedSession.mockReset()
    getGithubPersonalAccessToken.mockReset()
    agentHostDispose.mockReset()
    agentHostCtor.mockClear()
  })

  it("reconciles stale streaming sessions before constructing the host", async () => {
    loadSessionWithMessages
      .mockResolvedValueOnce({
        messages: [buildMessage()],
        session: buildSession({ isStreaming: true }),
      })
      .mockResolvedValueOnce({
        messages: [buildMessage()],
        session: buildSession({ isStreaming: false }),
      })

    const { dispose, initFromStorage } = await import("@/agent/runtime-worker-api")

    await expect(initFromStorage("session-1")).resolves.toBe(true)

    expect(reconcileInterruptedSession).toHaveBeenCalledWith("session-1")
    expect(agentHostCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: false,
      }),
      [buildMessage()],
      expect.objectContaining({
        githubRuntimeToken: "github-token",
      })
    )

    await dispose()
  })

  it("initializes from an in-memory session without touching storage", async () => {
    const { dispose, initFromSession } = await import("@/agent/runtime-worker-api")
    const session = buildSession({
      id: "session-initial",
    })

    await initFromSession(session)

    expect(loadSessionWithMessages).not.toHaveBeenCalled()
    expect(agentHostCtor).toHaveBeenCalledWith(
      session,
      [],
      expect.objectContaining({
        githubRuntimeToken: "github-token",
      })
    )

    await dispose()
  })

  it("serializes concurrent storage init for the same session", async () => {
    const deferred = createDeferred<{
      messages: MessageRow[]
      session: SessionData
    }>()
    loadSessionWithMessages.mockReturnValueOnce(deferred.promise)

    const { dispose, initFromStorage } = await import("@/agent/runtime-worker-api")

    const initOne = initFromStorage("session-1")
    const initTwo = initFromStorage("session-1")

    deferred.resolve({
      messages: [buildMessage()],
      session: buildSession(),
    })

    await expect(Promise.all([initOne, initTwo])).resolves.toEqual([true, true])
    expect(loadSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(agentHostCtor).toHaveBeenCalledTimes(1)

    await dispose()
  })

  it("queues dispose behind an in-flight init transition", async () => {
    const deferred = createDeferred<{
      messages: MessageRow[]
      session: SessionData
    }>()
    loadSessionWithMessages.mockReturnValueOnce(deferred.promise)

    const { dispose, initFromStorage, startTurn } = await import(
      "@/agent/runtime-worker-api"
    )

    const initPromise = initFromStorage("session-1")
    const disposePromise = dispose()

    deferred.resolve({
      messages: [buildMessage()],
      session: buildSession(),
    })

    await expect(initPromise).resolves.toBe(true)
    await disposePromise
    await expect(startTurn("hello")).rejects.toThrow("Worker not initialized")
    expect(agentHostCtor).toHaveBeenCalledTimes(1)
    expect(agentHostDispose).toHaveBeenCalledTimes(1)
  })
})
