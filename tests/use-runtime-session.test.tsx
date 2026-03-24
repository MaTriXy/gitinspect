import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
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
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

const {
  abort,
  emitStore,
  getSessionSnapshot,
  hydrateSession,
  loadSession,
  resetStore,
  send,
  setModelSelection,
  setRepoSource,
  subscribe,
  unobserveSession,
} = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const snapshots = new Map<
    string,
    {
      draftAssistantMessage?: undefined
      error?: string
      isStreaming: boolean
      lastEventAt: number
      sessionId: string
    }
  >()

  return {
    abort: vi.fn(async (_sessionId: string) => {}),
    emitStore: (sessionId: string, snapshot: { error?: string; isStreaming: boolean }) => {
      snapshots.set(sessionId, {
        error: snapshot.error,
        isStreaming: snapshot.isStreaming,
        lastEventAt: Date.now(),
        sessionId,
      })

      for (const listener of listeners) {
        listener()
      }
    },
    getSessionSnapshot: vi.fn((sessionId: string) => {
      return (
        snapshots.get(sessionId) ?? {
          isStreaming: false,
          lastEventAt: Date.now(),
          sessionId,
        }
      )
    }),
    hydrateSession: vi.fn(async (_session: SessionData) => {}),
    loadSession: vi.fn(async (sessionId: string) => createSession(sessionId)),
    resetStore: () => {
      listeners.clear()
      snapshots.clear()
    },
    send: vi.fn(async (_sessionId: string, _content: string) => {}),
    setModelSelection: vi.fn(
      async (_sessionId: string, _providerGroup: string, _model: string) => {}
    ),
    setRepoSource: vi.fn(async (_sessionId: string, _repoSource?: SessionData["repoSource"]) => {}),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
    unobserveSession: vi.fn(async (_sessionId: string) => {}),
  }
})

vi.mock("@/sessions/session-service", () => ({
  loadSession,
}))

vi.mock("@/agent/runtime-client", () => ({
  runtimeClientStore: {
    abort,
    getSessionSnapshot,
    hydrateSession,
    send,
    setModelSelection,
    setRepoSource,
    subscribe,
    unobserveSession,
  },
}))

let latestHook: ReturnType<typeof useRuntimeSession>

function Harness(props: { session?: SessionData; sessionId: string }) {
  latestHook = useRuntimeSession(props.sessionId, props.session)

  return (
    <div data-testid="streaming">
      {String(latestHook.isStreaming)}:{latestHook.error ?? "ok"}
    </div>
  )
}

describe("useRuntimeSession", () => {
  beforeEach(() => {
    abort.mockReset()
    getSessionSnapshot.mockClear()
    hydrateSession.mockReset()
    loadSession.mockClear()
    send.mockReset()
    setModelSelection.mockReset()
    setRepoSource.mockReset()
    subscribe.mockClear()
    unobserveSession.mockReset()
    resetStore()
  })

  it("hydrates on mount, forwards actions, and unobserves on session switch", async () => {
    const rendered = render(
      <Harness session={createSession("session-1")} sessionId="session-1" />
    )

    await waitFor(() => {
      expect(hydrateSession).toHaveBeenCalledWith(createSession("session-1"))
    })
    expect(loadSession).not.toHaveBeenCalled()

    await act(async () => {
      await latestHook.send("hello")
      await latestHook.abort()
      await latestHook.setModelSelection("anthropic", "claude-sonnet-4-6")
      await latestHook.setRepoSource({
        owner: "openai",
        ref: "main",
        repo: "openai-node",
      })
    })

    expect(send).toHaveBeenCalledWith("session-1", "hello")
    expect(abort).toHaveBeenCalledWith("session-1")
    expect(setModelSelection).toHaveBeenCalledWith(
      "session-1",
      "anthropic",
      "claude-sonnet-4-6"
    )
    expect(setRepoSource).toHaveBeenCalledWith("session-1", {
      owner: "openai",
      ref: "main",
      repo: "openai-node",
    })

    act(() => {
      emitStore("session-1", {
        error: "streaming failure",
        isStreaming: true,
      })
    })

    expect(rendered.getByTestId("streaming").textContent).toContain("true")
    expect(rendered.getByTestId("streaming").textContent).toContain(
      "streaming failure"
    )

    rendered.rerender(
      <Harness session={createSession("session-2")} sessionId="session-2" />
    )

    await waitFor(() => {
      expect(unobserveSession).toHaveBeenCalledWith("session-1")
    })
    expect(hydrateSession).toHaveBeenCalledWith(createSession("session-2"))
  })
})
