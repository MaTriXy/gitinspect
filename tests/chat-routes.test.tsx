import * as React from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const useLiveQuery = vi.fn()

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery,
}))

vi.mock("@/db/schema", async () => {
  const actual = await vi.importActual<typeof import("@/db/schema")>(
    "@/db/schema"
  )

  return {
    ...actual,
    listSessions: vi.fn(async () => []),
    touchRepository: vi.fn(async () => {}),
  }
})

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>(
      "@tanstack/react-router"
    )

  return {
    ...actual,
    Navigate: (props: { to: string }) => (
      <div data-testid="navigate">{props.to}</div>
    ),
  }
})

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: () => ({
    abort: vi.fn(),
    error: undefined,
    send: vi.fn(),
    setModelSelection: vi.fn(),
    setRepoSource: vi.fn(),
    setThinkingLevel: vi.fn(),
  }),
}))

vi.mock("@/components/app-shell-layout", () => ({
  AppShellLayout: (props: {
    header: React.ReactNode
    main: React.ReactNode
    settings: React.ReactNode
    sidebar: React.ReactNode
  }) => (
    <div>
      <div data-testid="header">{props.header}</div>
      <div data-testid="main">{props.main}</div>
      <div data-testid="sidebar">{props.sidebar}</div>
      <div data-testid="settings">{props.settings}</div>
    </div>
  ),
}))

vi.mock("@/components/chat", () => ({
  Chat: () => <div data-testid="chat-view">chat</div>,
}))

vi.mock("@/components/empty-chat-content", () => ({
  EmptyChatContent: () => <div data-testid="empty-chat">empty</div>,
}))

vi.mock("@/components/chat-header", () => ({
  ChatHeader: () => <div data-testid="chat-header">header</div>,
}))

vi.mock("@/components/chat-sidebar", () => ({
  ChatSidebar: (props: { sessions: Array<{ id: string }> }) => (
    <div data-testid="chat-sidebar">{props.sessions.length}</div>
  ),
}))

vi.mock("@/components/settings-dialog", () => ({
  SettingsDialog: () => <div data-testid="settings-dialog">settings</div>,
}))

describe("chat routes", () => {
  beforeEach(() => {
    useLiveQuery.mockReset()
  })

  it("renders empty chat on /chat without creating a session", async () => {
    const navigate = vi.fn()
    const { Route } = await import("@/routes/chat")
    vi.spyOn(Route, "useNavigate").mockReturnValue(navigate)
    vi.spyOn(Route, "useSearch").mockReturnValue({
      session: undefined,
      settings: undefined,
      sidebar: undefined,
    })

    useLiveQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        model: "gpt-5.1-codex-mini",
        providerGroup: "openai-codex",
        thinkingLevel: "medium",
      })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("empty-chat")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  it("clears missing repo sessions back to the repo route", async () => {
    const navigate = vi.fn()
    const { Route } = await import("@/routes/$owner.$repo.index")
    vi.spyOn(Route, "useNavigate").mockReturnValue(navigate)
    vi.spyOn(Route, "useParams").mockReturnValue({
      owner: "acme",
      repo: "demo",
    })
    vi.spyOn(Route, "useSearch").mockReturnValue({
      session: "missing-session",
      settings: undefined,
      sidebar: undefined,
    })

    useLiveQuery.mockReturnValueOnce([]).mockReturnValueOnce(null).mockReturnValueOnce({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("navigate").textContent).toBe("/$owner/$repo")
  })
})
