import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyUsage } from "@/types/models"
import type { AssistantMessage } from "@/types/chat"
import type { SessionData, SessionMetadata } from "@/types/storage"

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
    title: id === "session-1" ? "Runtime session" : "Idle session",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

function createMetadata(id: string): SessionMetadata {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    id,
    lastModified: "2026-03-24T12:00:00.000Z",
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    modelId: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: id === "session-1" ? "Runtime session" : "Idle session",
    usage: createEmptyUsage(),
  }
}

const runtimeDraft: AssistantMessage = {
  api: "openai-responses",
  content: [{ text: "Draft reply from runtime", type: "text" }],
  id: "assistant-draft",
  model: "gpt-5.1-codex-mini",
  provider: "openai-codex",
  role: "assistant",
  stopReason: "stop",
  timestamp: Date.now(),
  usage: createEmptyUsage(),
}

const {
  createSessionMock,
  loadSessionMock,
  persistSessionSnapshotMock,
  runtimeSessionState,
  sessionStore,
} = vi.hoisted(() => ({
  createSessionMock: vi.fn(() => ({
    ...createSession("session-new"),
    title: "New chat",
  })),
  loadSessionMock: vi.fn(async (sessionId: string) => createSession(sessionId)),
  persistSessionSnapshotMock: vi.fn(async () => {}),
  runtimeSessionState: {
    error: undefined as string | undefined,
    isStreaming: false,
    runtimeDraft: undefined as AssistantMessage | undefined,
  },
  sessionStore: {
    sessionId: "session-1",
    sessionRecords: {
      "session-1": createSession("session-1"),
      "session-2": createSession("session-2"),
    } as Record<string, SessionData | undefined>,
  },
}))

const setSettingMock = vi.hoisted(() => vi.fn(async () => {}))
const setLastUsedRepoSourceMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("@/db/schema", () => ({
  setSetting: setSettingMock,
}))

vi.mock("@/repo/settings", () => ({
  formatRepoSourceLabel: vi.fn(() => "No repository selected"),
  setLastUsedRepoSource: setLastUsedRepoSourceMock,
}))

vi.mock("@/sessions/session-service", () => ({
  createSession: createSessionMock,
  loadSession: loadSessionMock,
  persistSessionSnapshot: persistSessionSnapshotMock,
}))

vi.mock("@/hooks/use-app-bootstrap", () => ({
  useAppBootstrap: vi.fn(() => ({
    session: createSession("session-1"),
    status: "ready",
  })),
}))

vi.mock("@/hooks/use-session-data", () => ({
  useSessionData: vi.fn((sessionId: string | undefined) =>
    sessionId ? sessionStore.sessionRecords[sessionId] : undefined
  ),
}))

vi.mock("@/hooks/use-session-list", () => ({
  useSessionList: vi.fn(() => ({
    sessions: [createMetadata("session-1"), createMetadata("session-2")],
  })),
}))

vi.mock("@/hooks/use-runtime-state", () => ({
  useRuntimeState: vi.fn(() => ({
    connectedClientIds: ["client-a"],
    runningSessionIds: ["session-1"],
    updatedAt: Date.now(),
  })),
}))

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: vi.fn((sessionId: string) => ({
    abort: vi.fn(async () => {}),
    error: runtimeSessionState.error,
    isStreaming:
      sessionId === "session-1" ? runtimeSessionState.isStreaming : false,
    runtimeDraft:
      sessionId === "session-1" ? runtimeSessionState.runtimeDraft : undefined,
    send: vi.fn(async () => {}),
    setModelSelection: vi.fn(async () => {}),
    setRepoSource: vi.fn(async () => {}),
  })),
}))

describe("AppShell runtime integration", () => {
  beforeEach(() => {
    runtimeSessionState.error = undefined
    runtimeSessionState.isStreaming = false
    runtimeSessionState.runtimeDraft = undefined
    sessionStore.sessionRecords["session-1"] = createSession("session-1")
    sessionStore.sessionRecords["session-2"] = createSession("session-2")
    createSessionMock.mockReset()
    createSessionMock.mockImplementation(() => ({
      ...createSession("session-new"),
      title: "New chat",
    }))
    loadSessionMock.mockReset()
    loadSessionMock.mockImplementation(async (sessionId: string) =>
      createSession(sessionId)
    )
    persistSessionSnapshotMock.mockReset()
    setSettingMock.mockReset()
    setLastUsedRepoSourceMock.mockReset()
  })

  it("shows live badges and overlays the runtime draft message", async () => {
    runtimeSessionState.isStreaming = true
    runtimeSessionState.runtimeDraft = runtimeDraft

    const { AppShell } = await import("@/components/app-shell")

    render(<AppShell />)

    expect(screen.getAllByText("Live").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Draft reply from runtime")).toBeTruthy()
  })

  it("switches to an optimistic new chat immediately while another session streams", async () => {
    runtimeSessionState.isStreaming = true
    runtimeSessionState.runtimeDraft = runtimeDraft
    createSessionMock.mockReturnValueOnce({
      ...createSession("session-new"),
      title: "New chat",
    })

    const { AppShell } = await import("@/components/app-shell")

    render(<AppShell />)
    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    expect(screen.getByText("New chat")).toBeTruthy()
    expect(screen.queryByText("Loading local session state...")).toBeNull()
    expect(persistSessionSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "session-new",
        title: "New chat",
      })
    )
    expect(screen.getByText("Live")).toBeTruthy()
  })

  it("keeps the selected idle session interactive while another session remains live", async () => {
    runtimeSessionState.isStreaming = true
    runtimeSessionState.runtimeDraft = undefined

    const { AppShell } = await import("@/components/app-shell")

    render(<AppShell />)
    fireEvent.click(screen.getByRole("button", { name: /idle session/i }))

    expect(screen.getByText("Idle session")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
    expect(screen.getAllByText("Live").length).toBeGreaterThanOrEqual(1)
  })
})
