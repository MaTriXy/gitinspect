import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionWorkerApi } from "@/agent/runtime-worker-types"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"

type WorkerApiStub = SessionWorkerApi & {
  abort: ReturnType<typeof vi.fn<() => Promise<void>>>
  dispose: ReturnType<typeof vi.fn<() => Promise<void>>>
  initFromSession: ReturnType<typeof vi.fn<(session: SessionData) => Promise<void>>>
  initFromStorage: ReturnType<typeof vi.fn<(sessionId: string) => Promise<boolean>>>
  refreshGithubToken: ReturnType<typeof vi.fn<() => Promise<void>>>
  setModelSelection: ReturnType<
    typeof vi.fn<(providerGroup: ProviderGroupId, modelId: string) => Promise<void>>
  >
  setThinkingLevel: ReturnType<
    typeof vi.fn<(thinkingLevel: ThinkingLevel) => Promise<void>>
  >
  startTurn: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>
}

const wrapMock = vi.fn<() => SessionWorkerApi>()

vi.mock("comlink", () => ({
  wrap: wrapMock,
}))

const sharedWorkerConstructors: Array<{ name: string }> = []
const workerConstructors: Array<{ name: string }> = []

function createApiStub(): WorkerApiStub {
  return {
    abort: vi.fn((): Promise<void> => Promise.resolve()),
    dispose: vi.fn((): Promise<void> => Promise.resolve()),
    initFromSession: vi.fn((_session: SessionData) => Promise.resolve()),
    initFromStorage: vi.fn((_sessionId: string) => Promise.resolve(true)),
    refreshGithubToken: vi.fn((): Promise<void> => Promise.resolve()),
    setModelSelection: vi.fn(
      (
        _providerGroup: ProviderGroupId,
        _modelId: string
      ): Promise<void> => Promise.resolve()
    ),
    setThinkingLevel: vi.fn(
      (_thinkingLevel: ThinkingLevel): Promise<void> => Promise.resolve()
    ),
    startTurn: vi.fn((_content: string) => Promise.resolve()),
  }
}

function buildSession(id = "sess-a"): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id,
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
  }
}

function installWindow(sharedWorkerAvailable: boolean) {
  class WorkerStub {
    terminate = vi.fn()

    constructor(_url: URL, options: { name: string; type: string }) {
      workerConstructors.push({ name: options.name })
    }
  }

  if (sharedWorkerAvailable) {
    class SharedWorkerStub {
      port = { close: vi.fn(), stub: "shared-port" }

      constructor(_url: URL, options: { name: string; type: string }) {
        sharedWorkerConstructors.push({ name: options.name })
      }
    }

    Object.defineProperty(globalThis, "SharedWorker", {
      configurable: true,
      value: SharedWorkerStub,
    })
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        SharedWorker: SharedWorkerStub,
        Worker: WorkerStub,
      },
    })
  } else {
    Object.defineProperty(globalThis, "SharedWorker", {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { Worker: WorkerStub },
    })
  }

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: WorkerStub,
  })
}

describe("RuntimeClient", () => {
  beforeEach(() => {
    vi.resetModules()
    wrapMock.mockReset()
    sharedWorkerConstructors.length = 0
    workerConstructors.length = 0
  })

  it("creates SharedWorker with per-session name and initializes from storage before starting a turn", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.startTurn("sess-a", "hello")

    expect(sharedWorkerConstructors).toEqual([
      { name: "gitinspect-session-sess-a" },
    ])
    expect(wrapMock).toHaveBeenCalledTimes(1)
    expect(api.initFromStorage).toHaveBeenCalledWith("sess-a")
    expect(api.startTurn).toHaveBeenCalledWith("hello")
  })

  it("reuses the same worker for the same session", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.startTurn("sess-a", "one")
    await client.startTurn("sess-a", "two")

    expect(sharedWorkerConstructors).toHaveLength(1)
    expect(api.initFromStorage).toHaveBeenCalledTimes(1)
    expect(api.startTurn).toHaveBeenNthCalledWith(1, "one")
    expect(api.startTurn).toHaveBeenNthCalledWith(2, "two")
  })

  it("creates distinct SharedWorkers per session id", async () => {
    wrapMock.mockImplementation(() => createApiStub())
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.startTurn("sess-a", "a")
    await client.startTurn("sess-b", "b")

    expect(sharedWorkerConstructors).toEqual([
      { name: "gitinspect-session-sess-a" },
      { name: "gitinspect-session-sess-b" },
    ])
    expect(wrapMock).toHaveBeenCalledTimes(2)
  })

  it("falls back to Worker when SharedWorker is unavailable", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(false)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.startTurn("sess-x", "hi")

    expect(workerConstructors).toEqual([{ name: "gitinspect-session-sess-x" }])
    expect(sharedWorkerConstructors).toHaveLength(0)
    expect(api.initFromStorage).toHaveBeenCalledWith("sess-x")
  })

  it("throws MissingSessionRuntimeError when storage init returns false", async () => {
    const api = createApiStub()
    api.initFromStorage.mockResolvedValue(false)
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await expect(client.startTurn("missing", "hello")).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    expect(api.startTurn).not.toHaveBeenCalled()
  })

  it("uses the same missing-session fallback across session mutations", async () => {
    const api = createApiStub()
    api.initFromStorage.mockResolvedValue(false)
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await expect(
      client.setModelSelection(
        "missing",
        "openai-codex",
        "gpt-5.1-codex-mini"
      )
    ).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    await expect(client.refreshGithubToken("missing")).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    await expect(
      client.setThinkingLevel("missing", "medium")
    ).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
  })

  it("initializes from an in-memory session before the first turn", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()
    const session = buildSession("sess-initial")

    await client.startInitialTurn(session, "hello")

    expect(api.initFromSession).toHaveBeenCalledWith(session)
    expect(api.startTurn).toHaveBeenCalledWith("hello")
  })

  it("releaseSession disposes and removes the worker handle", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.startTurn("sess-r", "x")
    await client.releaseSession("sess-r")

    expect(api.dispose).toHaveBeenCalledTimes(1)

    const api2 = createApiStub()
    wrapMock.mockReturnValue(api2)

    await client.startTurn("sess-r", "after-release")

    expect(api2.initFromStorage).toHaveBeenCalledWith("sess-r")
    expect(sharedWorkerConstructors).toHaveLength(2)
  })

  it("drops a broken worker handle after a transport failure", async () => {
    const api1 = createApiStub()
    api1.startTurn.mockRejectedValue(new Error("Worker port closed"))
    const api2 = createApiStub()
    wrapMock
      .mockImplementationOnce(() => api1)
      .mockImplementationOnce(() => api2)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await expect(client.startTurn("sess-t", "one")).rejects.toMatchObject({
      message: "Worker port closed",
    })

    await client.startTurn("sess-t", "two")

    expect(api1.initFromStorage).toHaveBeenCalledWith("sess-t")
    expect(api1.startTurn).toHaveBeenCalledWith("one")
    expect(api2.initFromStorage).toHaveBeenCalledWith("sess-t")
    expect(api2.startTurn).toHaveBeenCalledWith("two")
    expect(sharedWorkerConstructors).toHaveLength(2)
  })
})
