import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionWorkerApi } from "@/agent/runtime-worker-types"

type WorkerApiStub = SessionWorkerApi & {
  abort: ReturnType<typeof vi.fn<() => Promise<void>>>
  dispose: ReturnType<typeof vi.fn<() => Promise<void>>>
  init: ReturnType<typeof vi.fn<(sessionId: string) => Promise<boolean>>>
  refreshGithubToken: ReturnType<typeof vi.fn<() => Promise<void>>>
  send: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>
  setModelSelection: ReturnType<
    typeof vi.fn<
      (
        providerGroup: "openai-codex",
        modelId: string
      ) => Promise<void>
    >
  >
  setThinkingLevel: ReturnType<
    typeof vi.fn<(thinkingLevel: "medium" | "off" | "high") => Promise<void>>
  >
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
    init: vi.fn((_sessionId: string) => Promise.resolve(true)),
    refreshGithubToken: vi.fn((): Promise<void> => Promise.resolve()),
    send: vi.fn((_content: string) => Promise.resolve()),
    setModelSelection: vi.fn(
      (
        _providerGroup: "openai-codex",
        _modelId: string
      ): Promise<void> => Promise.resolve()
    ),
    setThinkingLevel: vi.fn(
      (_thinkingLevel: "medium" | "off" | "high"): Promise<void> =>
        Promise.resolve()
    ),
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

      constructor(
        _url: URL,
        options: { name: string; type: string }
      ) {
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

  it("creates SharedWorker with per-session name and calls init before send", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.send("sess-a", "hello")

    expect(sharedWorkerConstructors).toEqual([
      { name: "gitinspect-session-sess-a" },
    ])
    expect(wrapMock).toHaveBeenCalledTimes(1)
    expect(api.init).toHaveBeenCalledWith("sess-a")
    expect(api.send).toHaveBeenCalledWith("hello")
  })

  it("reuses the same worker for the same session", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.send("sess-a", "one")
    await client.send("sess-a", "two")

    expect(sharedWorkerConstructors).toHaveLength(1)
    expect(api.init).toHaveBeenCalledTimes(1)
    expect(api.send).toHaveBeenNthCalledWith(1, "one")
    expect(api.send).toHaveBeenNthCalledWith(2, "two")
  })

  it("creates distinct SharedWorkers per session id", async () => {
    wrapMock.mockImplementation(() => createApiStub())
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.send("sess-a", "a")
    await client.send("sess-b", "b")

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

    await client.send("sess-x", "hi")

    expect(workerConstructors).toEqual([{ name: "gitinspect-session-sess-x" }])
    expect(sharedWorkerConstructors).toHaveLength(0)
    expect(api.init).toHaveBeenCalledWith("sess-x")
  })

  it("throws MissingSessionRuntimeError when init returns false", async () => {
    const api = createApiStub()
    api.init.mockResolvedValue(false)
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await expect(client.send("missing", "hello")).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    expect(api.send).not.toHaveBeenCalled()
  })

  it("uses the same missing-session fallback across session mutations", async () => {
    const api = createApiStub()
    api.init.mockResolvedValue(false)
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

  it("releaseSession disposes and removes the worker handle", async () => {
    const api = createApiStub()
    wrapMock.mockReturnValue(api)
    installWindow(true)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.send("sess-r", "x")
    await client.releaseSession("sess-r")

    expect(api.dispose).toHaveBeenCalledTimes(1)

    const api2 = createApiStub()
    wrapMock.mockReturnValue(api2)

    await client.send("sess-r", "after-release")

    expect(api2.init).toHaveBeenCalledWith("sess-r")
    expect(sharedWorkerConstructors).toHaveLength(2)
  })
})
