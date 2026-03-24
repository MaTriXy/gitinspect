import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

function createSession(id: string): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    id,
    messages: [],
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: `Session ${id}`,
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

type FakeHost = {
  abort: ReturnType<typeof vi.fn>
  emit: (snapshot: {
    error?: string
    isStreaming: boolean
    session: SessionData
  }) => void
}

const { hostInstances } = vi.hoisted(() => ({
  hostInstances: new Map<string, any>(),
}))

vi.mock("@/agent/agent-host", () => ({
  AgentHost: class FakeAgentHost {
    readonly abort = vi.fn()
    readonly isBusy = vi.fn(() => this.snapshot.isStreaming)
    readonly prompt = vi.fn()
    readonly setModelSelection = vi.fn(async () => {})
    readonly setRepoSource = vi.fn(async () => {})
    private snapshot: {
      error?: string
      isStreaming: boolean
      session: SessionData
    }
    private listeners = new Set<
      (snapshot: { error?: string; isStreaming: boolean; session: SessionData }) => void
    >()

    constructor(session: SessionData) {
      this.snapshot = {
        isStreaming: false,
        session,
      }
      hostInstances.set(session.id, this)
    }

    subscribe(
      listener: (snapshot: {
        error?: string
        isStreaming: boolean
        session: SessionData
      }) => void
    ) {
      this.listeners.add(listener)
      listener(this.snapshot)

      return () => {
        this.listeners.delete(listener)
      }
    }

    getSnapshot() {
      return this.snapshot
    }

    emit(snapshot: {
      error?: string
      isStreaming: boolean
      session: SessionData
    }) {
      this.snapshot = snapshot

      for (const listener of this.listeners) {
        listener(snapshot)
      }
    }
  },
}))

describe("SessionRuntimeRegistry", () => {
  beforeEach(() => {
    hostInstances.clear()
  })

  it("hydrates sessions, tracks multiple running sessions, and rejects busy mutations", async () => {
    const { SessionRuntimeRegistry } = await import("@/agent/session-runtime-registry")
    const registry = new SessionRuntimeRegistry()
    const sinkA = {
      onRuntimeState: vi.fn(),
      onSessionSnapshot: vi.fn(),
    }
    const sinkB = {
      onRuntimeState: vi.fn(),
      onSessionSnapshot: vi.fn(),
    }

    await registry.connectClient("client-a", sinkA)
    await registry.connectClient("client-b", sinkB)
    await registry.hydrateSession("client-a", "session-1", createSession("session-1"))
    await registry.hydrateSession("client-b", "session-2", createSession("session-2"))

    ;(hostInstances.get("session-1") as FakeHost | undefined)?.emit({
      isStreaming: true,
      session: createSession("session-1"),
    })
    ;(hostInstances.get("session-2") as FakeHost | undefined)?.emit({
      isStreaming: true,
      session: createSession("session-2"),
    })

    const runtimeState = await registry.getRuntimeState()

    expect(runtimeState.runningSessionIds).toEqual(["session-1", "session-2"])

    await expect(registry.send("session-1", "hello")).resolves.toEqual({
      error: "busy",
      ok: false,
    })
    await expect(
      registry.setModelSelection("session-2", "anthropic", "claude-sonnet-4-6")
    ).resolves.toEqual({
      error: "busy",
      ok: false,
    })
  })

  it("allows abort from another client observing the same session", async () => {
    const { SessionRuntimeRegistry } = await import("@/agent/session-runtime-registry")
    const registry = new SessionRuntimeRegistry()

    await registry.connectClient("client-a", {
      onRuntimeState: vi.fn(),
      onSessionSnapshot: vi.fn(),
    })
    await registry.connectClient("client-b", {
      onRuntimeState: vi.fn(),
      onSessionSnapshot: vi.fn(),
    })

    await registry.hydrateSession("client-a", "session-1", createSession("session-1"))
    await registry.observeSession("client-b", "session-1")
    await registry.abort("session-1")

    expect((hostInstances.get("session-1") as FakeHost | undefined)?.abort).toHaveBeenCalledTimes(1)
  })
})
