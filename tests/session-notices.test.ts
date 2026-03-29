import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageRow, SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"
import {
  appendSessionNotice,
  reconcileInterruptedSession,
} from "@/sessions/session-notices"

const helpers = vi.hoisted(() => {
  const state = {
    messagesBySession: new Map<string, Array<MessageRow>>(),
    sessions: new Map<string, SessionData>(),
  }

  function mergeSessionMessages(
    sessionId: string,
    messages: Array<MessageRow>
  ): void {
    const nextMessages = new Map<string, MessageRow>()

    for (const message of state.messagesBySession.get(sessionId) ?? []) {
      nextMessages.set(message.id, message)
    }

    for (const message of messages) {
      nextMessages.set(message.id, message)
    }

    state.messagesBySession.set(
      sessionId,
      [...nextMessages.values()].sort(
        (left, right) => left.timestamp - right.timestamp
      )
    )
  }

  const loadSessionWithMessages = vi.fn(
    async (
      sessionId: string
    ): Promise<
      { messages: Array<MessageRow>; session: SessionData } | undefined
    > => {
      const session = state.sessions.get(sessionId)

      if (!session) {
        return undefined
      }

      return {
        messages: state.messagesBySession.get(sessionId) ?? [],
        session,
      }
    }
  )

  const putSessionAndMessages = vi.fn(
    async (session: SessionData, messages: Array<MessageRow>): Promise<void> => {
      state.sessions.set(session.id, session)
      mergeSessionMessages(session.id, messages)
    }
  )

  return {
    loadSessionWithMessages,
    putSessionAndMessages,
    state,
  }
})

vi.mock("@/sessions/session-service", () => ({
  buildPersistedSession: (
    session: SessionData,
    messages: Array<MessageRow>
  ) => ({
    ...session,
    messageCount: messages.length,
  }),
  loadSessionWithMessages: helpers.loadSessionWithMessages,
}))

vi.mock("@/db/schema", () => ({
  putSessionAndMessages: helpers.putSessionAndMessages,
}))

function buildSession(overrides: Partial<SessionData> = {}): SessionData {
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

function buildStreamingAssistant(
  overrides: Partial<MessageRow> = {}
): MessageRow {
  return {
    api: "openai-responses",
    content: [{ text: "", type: "text" }],
    id: "assistant-1",
    model: "gpt-5.1-codex-mini",
    provider: "openai-codex",
    role: "assistant",
    sessionId: "session-1",
    status: "streaming",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  } as MessageRow
}

function buildUserMessage(): MessageRow {
  return {
    content: [{ text: "hello", type: "text" }],
    id: "user-1",
    role: "user",
    sessionId: "session-1",
    status: "completed",
    timestamp: 1,
  } as MessageRow
}

describe("session-notices", () => {
  beforeEach(() => {
    helpers.state.messagesBySession.clear()
    helpers.state.sessions.clear()
    helpers.loadSessionWithMessages.mockReset()
    helpers.putSessionAndMessages.mockReset()
  })

  it("dedupes persisted notices", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant(),
    ])

    await appendSessionNotice("session-1", new Error("boom"))
    await appendSessionNotice("session-1", new Error("boom"))

    expect(helpers.putSessionAndMessages).toHaveBeenCalledTimes(1)
    expect(
      helpers.state.messagesBySession
        .get("session-1")
        ?.filter((message) => message.role === "system")
    ).toHaveLength(1)
  })

  it("reconciles an interrupted session exactly once", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant(),
    ])

    await reconcileInterruptedSession("session-1")
    await reconcileInterruptedSession("session-1")

    expect(helpers.putSessionAndMessages).toHaveBeenCalledTimes(1)
    expect(helpers.state.sessions.get("session-1")).toMatchObject({
      isStreaming: false,
    })
    expect(helpers.state.messagesBySession.get("session-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          status: "error",
        }),
        expect.objectContaining({
          fingerprint:
            "stream_interrupted:Stream interrupted. The runtime stopped before completion.",
          role: "system",
        }),
      ])
    )
  })

  it("updates the session when the notice already exists", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant(),
      {
        fingerprint:
          "stream_interrupted:Stream interrupted. The runtime stopped before completion.",
        id: "system-1",
        kind: "stream_interrupted",
        message: "Stream interrupted. The runtime stopped before completion.",
        role: "system",
        sessionId: "session-1",
        severity: "error",
        source: "runtime",
        status: "completed",
        timestamp: 3,
      },
    ])

    await reconcileInterruptedSession("session-1")

    expect(helpers.putSessionAndMessages).toHaveBeenCalledTimes(1)
    expect(helpers.state.sessions.get("session-1")).toMatchObject({
      isStreaming: false,
    })
    expect(
      helpers.state.messagesBySession
        .get("session-1")
        ?.filter((message) => message.role === "system")
    ).toHaveLength(1)
    expect(helpers.state.messagesBySession.get("session-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-1",
          role: "assistant",
          status: "error",
        }),
      ])
    )
  })
})
