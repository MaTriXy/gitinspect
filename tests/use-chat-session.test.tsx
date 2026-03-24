import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

const { hostInstances, setLastUsedRepoSource, setSetting } = vi.hoisted(() => ({
  hostInstances: [] as Array<{
    abort: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    emit: (snapshot: {
      error?: string
      isStreaming: boolean
      session: SessionData
    }) => void
    prompt: ReturnType<typeof vi.fn>
    session: SessionData
    setModelSelection: ReturnType<typeof vi.fn>
  }>,
  setLastUsedRepoSource: vi.fn(),
  setSetting: vi.fn(),
}))

vi.mock("@/db/schema", () => ({
  setSetting,
}))

vi.mock("@/repo/settings", () => ({
  setLastUsedRepoSource,
}))

vi.mock("@/agent/agent-host", () => ({
  AgentHost: class FakeAgentHost {
    readonly abort = vi.fn()
    readonly dispose = vi.fn()
    readonly prompt = vi.fn(async (_content: string) => {})
    readonly setModelSelection = vi.fn(async (_provider: string, _model: string) => {})

    constructor(
      readonly session: SessionData,
      readonly onSnapshot: (snapshot: {
        error?: string
        isStreaming: boolean
        session: SessionData
      }) => void
    ) {
      hostInstances.push(this)
    }

    emit(snapshot: { error?: string; isStreaming: boolean; session: SessionData }) {
      this.onSnapshot(snapshot)
    }
  },
}))

import { useChatSession } from "@/hooks/use-chat-session"

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

let latestHook: ReturnType<typeof useChatSession>

function Harness(props: { session: SessionData }) {
  latestHook = useChatSession(props.session)

  return (
    <div data-testid="session-id">
      {latestHook.session.id}:{latestHook.session.title}
    </div>
  )
}

describe("useChatSession", () => {
  beforeEach(() => {
    hostInstances.length = 0
    setSetting.mockReset()
    setLastUsedRepoSource.mockReset()
  })

  it("mounts a host, forwards actions, and disposes on session switch", async () => {
    const firstSession = createSession("session-1")
    const secondSession = createSession("session-2")
    const rendered = render(<Harness session={firstSession} />)

    expect(hostInstances).toHaveLength(1)

    await act(async () => {
      await latestHook.send("hello")
    })
    expect(hostInstances[0]?.prompt).toHaveBeenCalledWith("hello")

    act(() => {
      hostInstances[0]?.emit({
        isStreaming: true,
        session: {
          ...firstSession,
          title: "Updated live session",
        },
      })
    })
    expect(rendered.getByTestId("session-id").textContent).toContain(
      "Updated live session"
    )

    rendered.rerender(<Harness session={secondSession} />)

    expect(hostInstances[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(hostInstances).toHaveLength(2)

    await act(async () => {
      await latestHook.setModelSelection("anthropic", "claude-sonnet-4-6")
      await latestHook.replaceSession(secondSession)
    })

    expect(hostInstances[1]?.setModelSelection).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet-4-6"
    )
    expect(setSetting).toHaveBeenCalledWith("last-used-model", "claude-sonnet-4-6")
    expect(setSetting).toHaveBeenCalledWith("last-used-provider", "anthropic")
    expect(setSetting).toHaveBeenCalledWith(
      "last-used-provider-group",
      "anthropic"
    )
    expect(setSetting).toHaveBeenCalledWith("active-session-id", "session-2")
  })
})
