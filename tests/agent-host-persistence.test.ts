import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

const putMessage = vi.fn(async () => {})
const putMessages = vi.fn(async () => {})
const putSession = vi.fn(async () => {})
const putSessionAndMessages = vi.fn(async () => {})
const recordUsage = vi.fn(async () => {})

type Subscriber = (event: any) => void
let subscriber: Subscriber | undefined

const agentState = {
  error: undefined as string | undefined,
  isStreaming: false,
  messages: [] as any[],
  model: {
    id: "gpt-5.1-codex-mini",
    provider: "openai-codex",
  },
  streamMessage: null as any,
  thinkingLevel: "medium" as const,
}

const promptMock = vi.fn(async () => {})
const abortMock = vi.fn(() => {})
const setModelMock = vi.fn()
const setToolsMock = vi.fn()

vi.mock("@/db/schema", () => ({
  getSessionMessages: vi.fn(async () => []),
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  recordUsage,
}))

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: class {
    state = agentState
    sessionId = ""

    constructor() {}

    subscribe(listener: Subscriber) {
      subscriber = listener
      return () => {
        subscriber = undefined
      }
    }

    prompt = promptMock
    abort = abortMock
    setModel = setModelMock
    setTools = setToolsMock
  },
}))

function createSession(): SessionData {
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
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

describe("AgentHost persistence", () => {
  beforeEach(() => {
    putMessage.mockClear()
    putMessages.mockClear()
    putSession.mockClear()
    putSessionAndMessages.mockClear()
    recordUsage.mockClear()
    promptMock.mockClear()
    abortMock.mockClear()
    setModelMock.mockClear()
    setToolsMock.mockClear()

    agentState.error = undefined
    agentState.isStreaming = false
    agentState.messages = []
    agentState.streamMessage = null
    subscriber = undefined
  })

  it("persists tool result rows while the stream is still active", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    await host.prompt("read the repo")

    agentState.isStreaming = true
    agentState.messages = [
      {
        content: "read the repo",
        id: "user-1",
        role: "user",
        timestamp: 1,
      },
      {
        content: "README contents",
        id: "tool-result-1",
        role: "toolResult",
        timestamp: 2,
        toolCallId: "call-1",
      },
    ]
    agentState.streamMessage = {
      api: "openai-responses",
      content: [
        {
          arguments: { path: "README.md" },
          id: "call-1",
          name: "read",
          type: "toolCall",
        },
      ],
      id: "assistant-stream",
      model: "gpt-5.1-codex-mini",
      provider: "openai-codex",
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 3,
      usage: createEmptyUsage(),
    }

    await subscriber?.({ type: "tool_result" })

    expect(putMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool-result-1",
          role: "toolResult",
          sessionId: "session-1",
          toolCallId: "call-1",
        }),
      ])
    )
    expect(putMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        sessionId: "session-1",
        status: "streaming",
      })
    )

    host.dispose()
  })
})
