import { createAssistantMessageEventStream } from "@mariozechner/pi-ai"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AssistantMessage } from "@/types/chat"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

const recordUsage = vi.fn()
const resolveApiKeyForProvider = vi.fn()
const persistSession = vi.fn()
const shouldSaveSession = vi.fn()
const streamChatWithPiAgent = vi.fn()

vi.mock("@/db/schema", () => ({
  recordUsage,
}))

vi.mock("@/auth/resolve-api-key", () => ({
  resolveApiKeyForProvider,
}))

vi.mock("@/sessions/session-service", async () => {
  const actual = await vi.importActual<typeof import("@/sessions/session-service")>(
    "@/sessions/session-service"
  )

  return {
    ...actual,
    persistSession,
    shouldSaveSession,
  }
})

vi.mock("@/agent/live-runtime", () => ({
  streamChatWithPiAgent,
}))

function createSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    id: "session-1",
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

function createUsage(total: number) {
  const usage = createEmptyUsage()
  usage.cost.total = total
  usage.cost.input = total / 3
  usage.cost.output = (total / 3) * 2
  usage.input = 10
  usage.output = 20
  usage.totalTokens = 30
  return usage
}

describe("AgentHost", () => {
  beforeEach(() => {
    recordUsage.mockReset()
    resolveApiKeyForProvider.mockReset()
    persistSession.mockReset()
    shouldSaveSession.mockReset()
    streamChatWithPiAgent.mockReset()
    resolveApiKeyForProvider.mockResolvedValue("oauth-token")
    shouldSaveSession.mockImplementation((session: SessionData) => {
      return session.messages.some((message) => message.role === "assistant")
    })
  })

  it("streams through the mounted agent and persists finalized assistant state", async () => {
    streamChatWithPiAgent.mockImplementation(async (model, _context, options) => {
      const stream = createAssistantMessageEventStream()

      queueMicrotask(() => {
        const usage = createUsage(0.3)
        const partial: AssistantMessage = {
          api: model.api,
          content: [{ text: "", type: "text" }],
          id: "assistant-1",
          model: model.id,
          provider: model.provider,
          role: "assistant",
          stopReason: "stop",
          timestamp: 2,
          usage,
        }
        const message: AssistantMessage = {
          ...partial,
          content: [{ text: "Hello from the mounted agent", type: "text" }],
        }

        stream.push({
          partial,
          type: "start",
        })
        stream.push({
          contentIndex: 0,
          partial,
          type: "text_start",
        })
        const firstContent = partial.content[0]

        if (firstContent?.type === "text") {
          firstContent.text = "Hello from the mounted agent"
        }
        stream.push({
          contentIndex: 0,
          delta: "Hello from the mounted agent",
          partial,
          type: "text_delta",
        })
        stream.push({
          content: "Hello from the mounted agent",
          contentIndex: 0,
          partial,
          type: "text_end",
        })
        stream.push({
          message,
          reason: "stop",
          type: "done",
        })
        stream.end(message)
      })

      if (options?.apiKey) {
        expect(options.apiKey).toBe("oauth-token")
      }

      return stream
    })

    const snapshots: SessionData[] = []
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), (snapshot) => {
      snapshots.push(snapshot.session)
    })

    await host.prompt("hello")

    expect(resolveApiKeyForProvider).toHaveBeenCalledWith(
      "openai-codex",
      "openai-codex"
    )
    expect(snapshots.at(-1)?.messages).toHaveLength(2)
    expect(snapshots.at(-1)?.messages[1]).toMatchObject({
      content: [{ text: "Hello from the mounted agent", type: "text" }],
      role: "assistant",
    })
    expect(persistSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "session-1",
        title: "hello",
      })
    )
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        cost: expect.objectContaining({
          total: 0.3,
        }),
      }),
      "openai-codex",
      "gpt-5.1-codex-mini",
      2
    )

    host.dispose()
  })

  it("uses the bundled public key for OpenCode free when no local key exists", async () => {
    resolveApiKeyForProvider.mockResolvedValue("sk-public-free-key")

    const snapshots: SessionData[] = []
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(
      {
        ...createSession(),
        model: "gpt-5-nano",
        provider: "opencode",
        providerGroup: "opencode-free",
      },
      (snapshot) => {
        snapshots.push(snapshot.session)
      }
    )

    await host.prompt("hello")

    expect(resolveApiKeyForProvider).toHaveBeenCalledWith(
      "opencode",
      "opencode-free"
    )
    expect(snapshots[0]?.providerGroup ?? "opencode-free").toBe("opencode-free")

    host.dispose()
  })

  it("updates the live model immediately and persists the session snapshot", async () => {
    const snapshots: SessionData[] = []
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), (snapshot) => {
      snapshots.push(snapshot.session)
    })

    await host.setModelSelection("anthropic", "claude-sonnet-4-6")

    expect(snapshots.at(-1)).toMatchObject({
      model: "claude-sonnet-4-6",
      provider: "anthropic",
    })
    expect(persistSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      })
    )

    host.dispose()
  })
})
