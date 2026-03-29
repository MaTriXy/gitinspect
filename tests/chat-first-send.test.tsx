import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

const useLiveQueryMock = vi.fn()
const navigateMock = vi.fn(async () => {})
const useSearchMock = vi.fn(() => ({}))
const startInitialTurnMock = vi.fn(async () => {})
const createSessionForRepoMock = vi.fn()
const persistLastUsedSessionSettingsMock = vi.fn(async () => {})

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: useLiveQueryMock,
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}))

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: () => ({
    abort: vi.fn(),
    send: vi.fn(),
    setModelSelection: vi.fn(),
    setThinkingLevel: vi.fn(),
  }),
}))

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    startInitialTurn: startInitialTurnMock,
  },
}))

vi.mock("@/sessions/session-actions", () => ({
  createSessionForChat: vi.fn(),
  createSessionForRepo: createSessionForRepoMock,
  persistLastUsedSessionSettings: persistLastUsedSessionSettingsMock,
  resolveProviderDefaults: vi.fn(async () => ({
    model: "gpt-5.1-codex-mini",
    providerGroup: "openai-codex",
  })),
  sessionDestination: vi.fn(() => ({
    params: {
      _splat: "main",
      owner: "acme",
      repo: "demo",
    },
    to: "/$owner/$repo/$",
  })),
}))

vi.mock("@/repo/settings", () => ({
  normalizeRepoSource: vi.fn(() => ({
    owner: "acme",
    ref: "main",
    repo: "demo",
  })),
  resolveRepoSource: vi.fn(async () => ({
    owner: "acme",
    ref: "main",
    repo: "demo",
  })),
}))

vi.mock("@/db/schema", () => ({
  touchRepository: vi.fn(async () => {}),
}))

vi.mock("@/components/chat-empty-state", () => ({
  ChatEmptyState: () => <div data-testid="empty-state">empty</div>,
}))

vi.mock("@/components/chat-composer", () => ({
  ChatComposer: ({
    onSend,
  }: {
    onSend: (content: string) => Promise<void>
  }) => (
    <button onClick={() => void onSend("hello")} type="button">
      Send
    </button>
  ),
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

function buildSession(): SessionData {
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
    repoSource: {
      owner: "acme",
      ref: "main",
      repo: "demo",
    },
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

function createDeferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve: () => resolve?.(),
  }
}

describe("Chat first send", () => {
  beforeEach(() => {
    createSessionForRepoMock.mockReset()
    navigateMock.mockReset()
    persistLastUsedSessionSettingsMock.mockReset()
    startInitialTurnMock.mockReset()
    useLiveQueryMock.mockReset()
  })

  it("starts the initial turn before navigating to the new session", async () => {
    const session = buildSession()
    createSessionForRepoMock.mockResolvedValue(session)
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    let callIndex = 0
    useLiveQueryMock.mockImplementation(() => {
      callIndex += 1
      return callIndex % 2 === 1 ? { kind: "none" } : defaults
    })

    const { Chat } = await import("@/components/chat")

    render(
      <Chat
        repoSource={{
          owner: "acme",
          repo: "demo",
        }}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByText("Send"))
    })

    await vi.waitFor(() => {
      expect(startInitialTurnMock).toHaveBeenCalledWith(session, "hello")
    })

    expect(
      startInitialTurnMock.mock.invocationCallOrder[0]
    ).toBeLessThan(navigateMock.mock.invocationCallOrder[0])
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          _splat: "main",
          owner: "acme",
          repo: "demo",
        },
        to: "/$owner/$repo/$",
      })
    )
  })

  it("does not block navigation on settings persistence", async () => {
    const session = buildSession()
    const settingsWrite = createDeferred()
    createSessionForRepoMock.mockResolvedValue(session)
    persistLastUsedSessionSettingsMock.mockImplementation(
      async () => await settingsWrite.promise
    )
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    let callIndex = 0
    useLiveQueryMock.mockImplementation(() => {
      callIndex += 1
      return callIndex % 2 === 1 ? { kind: "none" } : defaults
    })

    const { Chat } = await import("@/components/chat")

    render(
      <Chat
        repoSource={{
          owner: "acme",
          repo: "demo",
        }}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByText("Send"))
    })

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalled()
    })

    expect(persistLastUsedSessionSettingsMock).toHaveBeenCalledWith(session)
    settingsWrite.resolve()
    await act(async () => {
      await settingsWrite.promise
    })
  })
})
