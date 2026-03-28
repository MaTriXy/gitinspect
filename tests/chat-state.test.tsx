import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { MessageRow, SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"

const useLiveQueryMock = vi.fn()
const navigateMock = vi.fn()
const useSearchMock = vi.fn(() => ({}))
const useRuntimeSessionMock = vi.fn(() => ({
  abort: vi.fn(),
  send: vi.fn(),
  setModelSelection: vi.fn(),
  setThinkingLevel: vi.fn(),
}))

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: useLiveQueryMock,
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}))

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: () => useRuntimeSessionMock(),
}))

vi.mock("@/sessions/session-actions", () => ({
  persistLastUsedSessionSettings: vi.fn(async () => {}),
  resolveProviderDefaults: vi.fn(async () => ({
    model: "gpt-5.1-codex-mini",
    providerGroup: "openai-codex",
  })),
  sessionDestination: vi.fn(() => ({ to: "/chat" })),
}))

vi.mock("@/repo/settings", () => ({
  normalizeRepoSource: vi.fn(() => undefined),
  resolveRepoSource: vi.fn(async () => undefined),
}))

vi.mock("@/db/schema", () => ({
  touchRepository: vi.fn(async () => {}),
}))

vi.mock("@/sessions/session-bootstrap", () => ({
  bootstrapSessionAndSend: vi.fn(async () => ({
    bootstrapStatus: "bootstrap",
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
  })),
}))

vi.mock("@/components/chat-empty-state", () => ({
  ChatEmptyState: () => <div data-testid="empty-state">empty</div>,
}))

vi.mock("@/components/chat-composer", () => ({
  ChatComposer: () => <div data-testid="composer">composer</div>,
}))

vi.mock("@/components/repo-combobox", () => ({
  RepoCombobox: React.forwardRef(() => <div data-testid="repo-combobox" />),
}))

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationScrollButton: () => null,
}))

vi.mock("@/components/ui/progressive-blur", () => ({
  ProgressiveBlur: () => null,
}))

vi.mock("@/components/chat-message", () => ({
  ChatMessage: () => null,
}))

vi.mock("@/components/chat-adapter", () => ({
  getFoldedToolResultIds: () => new Set<string>(),
}))

function buildSession(
  bootstrapStatus: SessionData["bootstrapStatus"],
  messageCount: number
): { kind: "active"; messages: Array<MessageRow>; session: SessionData } {
  return {
    kind: "active",
    messages:
      messageCount === 0
        ? []
        : [
            {
              content: [{ text: "hello", type: "text" }],
              id: "message-1",
              role: "user",
              sessionId: "session-1",
              status: "completed",
              timestamp: 1,
            } as MessageRow,
          ],
    session: {
      bootstrapStatus,
      cost: 0,
      createdAt: "2026-03-24T12:00:00.000Z",
      error: undefined,
      id: "session-1",
      isStreaming: false,
      messageCount,
      model: "gpt-5.1-codex-mini",
      preview: "",
      provider: "openai-codex",
      providerGroup: "openai-codex",
      repoSource: undefined,
      thinkingLevel: "medium",
      title: "New chat",
      updatedAt: "2026-03-24T12:00:00.000Z",
      usage: createEmptyUsage(),
    },
  }
}

describe("Chat state", () => {
  beforeEach(() => {
    navigateMock.mockReset()
    useLiveQueryMock.mockReset()
    useRuntimeSessionMock.mockClear()
  })

  it("shows the bootstrap loading state for provisional sessions", async () => {
    const session = buildSession("bootstrap", 0)
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    let callIndex = 0
    useLiveQueryMock.mockImplementation(() => {
      callIndex += 1
      return callIndex % 2 === 1 ? session : defaults
    })

    const { Chat } = await import("@/components/chat")

    render(<Chat />)

    expect(screen.getByText("Starting session...")).toBeTruthy()
    expect(screen.queryByTestId("empty-state")).toBeNull()
    expect(screen.getByTestId("composer")).toBeTruthy()
  })

  it("shows the normal empty state only when ready and empty", async () => {
    const session = buildSession("ready", 0)
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    let callIndex = 0
    useLiveQueryMock.mockImplementation(() => {
      callIndex += 1
      return callIndex % 2 === 1 ? session : defaults
    })

    const { Chat } = await import("@/components/chat")

    render(<Chat />)

    expect(screen.getByTestId("empty-state")).toBeTruthy()
    expect(screen.queryByText("Starting session...")).toBeNull()
    expect(screen.getByTestId("composer")).toBeTruthy()
  })

  it("shows a streaming status row when the assistant has not rendered yet", async () => {
    const session = buildSession("ready", 1)
    session.session.isStreaming = true
    session.messages = [
      {
        content: [{ text: "hello", type: "text" }],
        id: "message-1",
        role: "user",
        sessionId: "session-1",
        status: "completed",
        timestamp: 1,
      } as MessageRow,
    ]

    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    let callIndex = 0
    useLiveQueryMock.mockImplementation(() => {
      callIndex += 1
      return callIndex % 2 === 1 ? session : defaults
    })

    const { Chat } = await import("@/components/chat")

    render(<Chat />)

    expect(screen.getByRole("status").textContent).toContain(
      "Assistant is streaming..."
    )
  })
})
