import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyUsage } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

function createSessionRecord(
  id: string,
  repoSource?: RepoSource
): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-23T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-23T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

function catalogMock(overrides: Record<string, unknown> = {}) {
  return {
    DEFAULT_MODELS: { "openai-codex": "gpt-5.1-codex-mini" },
    getCanonicalProvider: vi.fn((g: string) => g),
    getConnectedProviders: vi.fn(() => []),
    getDefaultModelForGroup: vi.fn().mockReturnValue({
      id: "gpt-5.1-codex-mini",
    }),
    getDefaultProviderGroup: vi.fn((provider: string) => provider),
    getPreferredProviderGroup: vi.fn().mockReturnValue("openai-codex"),
    getProviderGroups: vi.fn().mockReturnValue(["openai-codex"]),
    getVisibleProviderGroups: vi.fn(() => ["opencode-free", "openai-codex"]),
    hasModelForGroup: vi.fn().mockReturnValue(false),
    isProviderGroupId: vi.fn().mockReturnValue(false),
    ...overrides,
  }
}

describe("loadInitialSessionFromLocation", () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState({}, "", "/")
  })

  it("returns null for the landing path /", async () => {
    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession: vi.fn(),
      persistSessionSnapshot: vi.fn(),
    }))
    vi.doMock("@/models/catalog", () => catalogMock())

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    const session = await loadInitialSessionFromLocation({
      pathname: "/",
      search: "",
    })

    expect(session).toBeNull()
  })

  it("creates an empty chat session on /chat when no sessions exist", async () => {
    const createdSession = createSessionRecord("session-new")
    const createSession = vi.fn().mockReturnValue(createdSession)

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      loadMostRecentSession: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn(),
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () => catalogMock())

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    const session = await loadInitialSessionFromLocation({
      pathname: "/chat",
      search: "",
    })

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      repoSource: undefined,
    })
    expect(session?.id).toBe("session-new")
    expect(session?.repoSource).toBeUndefined()
  })

  it("resumes the most recent session on /chat when no session query", async () => {
    const recent = createSessionRecord("session-recent")

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession: vi.fn(),
      loadMostRecentSession: vi.fn().mockResolvedValue(recent),
      loadSession: vi.fn(),
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () => catalogMock())

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    const session = await loadInitialSessionFromLocation({
      pathname: "/chat",
      search: "",
    })

    expect(session?.id).toBe("session-recent")
  })

  it("loads the session from ?session= on /chat", async () => {
    const requested = createSessionRecord("session-url")
    const loadSession = vi.fn().mockResolvedValue(requested)

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession: vi.fn(),
      loadMostRecentSession: vi.fn(),
      loadSession,
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () => catalogMock())

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    const session = await loadInitialSessionFromLocation({
      pathname: "/chat",
      search: "?session=session-url",
    })

    expect(loadSession).toHaveBeenCalledWith("session-url")
    expect(session?.id).toBe("session-url")
  })

  it("creates a new session scoped to the repo path", async () => {
    const createdSession = createSessionRecord("session-repo", {
      owner: "acme",
      ref: "main",
      repo: "demo",
    })
    const createSession = vi.fn().mockReturnValue(createdSession)

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () => catalogMock())

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    const session = await loadInitialSessionFromLocation({
      pathname: "/acme/demo",
      search: "",
    })

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      repoSource: {
        owner: "acme",
        ref: "main",
        repo: "demo",
      },
    })
    expect(session?.repoSource?.owner).toBe("acme")
    expect(session?.repoSource?.repo).toBe("demo")
  })

  it("ignores ?session= on repo paths and still creates a new session", async () => {
    const createdSession = createSessionRecord("session-new")
    const createSession = vi.fn().mockReturnValue(createdSession)
    const loadSession = vi.fn()

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      loadSession,
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () => catalogMock())

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    await loadInitialSessionFromLocation({
      pathname: "/acme/demo",
      search: "?session=old-id",
    })

    expect(loadSession).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalled()
  })

  it("prefers a provider that already has auth configured", async () => {
    const createSession = vi.fn().mockReturnValue(createSessionRecord("session-auth"))

    vi.doMock("@/db/schema", () => ({
      getSetting: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([
        {
          provider: "anthropic",
          updatedAt: "2026-03-23T12:00:00.000Z",
          value: "oauth-json",
        },
      ]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () =>
      catalogMock({
        DEFAULT_MODELS: {
          anthropic: "claude-sonnet-4-6",
          "openai-codex": "gpt-5.1-codex-mini",
        },
        getDefaultModelForGroup: vi.fn().mockReturnValue({
          id: "claude-sonnet-4-6",
        }),
        getPreferredProviderGroup: vi.fn().mockReturnValue("anthropic"),
        getProviderGroups: vi.fn().mockReturnValue(["openai-codex", "anthropic"]),
      })
    )

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    await loadInitialSessionFromLocation({ pathname: "/acme/demo", search: "" })

    expect(createSession).toHaveBeenCalledWith({
      model: "claude-sonnet-4-6",
      providerGroup: "anthropic",
      repoSource: {
        owner: "acme",
        ref: "main",
        repo: "demo",
      },
    })
  })

  it("keeps the stored last-used model when it exists for the provider", async () => {
    const createSession = vi.fn().mockReturnValue(createSessionRecord("session-model"))

    vi.doMock("@/db/schema", () => ({
      getSetting: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("openai-codex")
        .mockResolvedValueOnce("gpt-5.2-codex")
        .mockResolvedValueOnce(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      persistSessionSnapshot: vi.fn(async () => {}),
    }))
    vi.doMock("@/models/catalog", () =>
      catalogMock({
        hasModelForGroup: vi.fn().mockReturnValue(true),
      })
    )

    const { loadInitialSessionFromLocation } = await import(
      "@/sessions/initial-session"
    )
    await loadInitialSessionFromLocation({ pathname: "/acme/demo", search: "" })

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.2-codex",
      providerGroup: "openai-codex",
      repoSource: {
        owner: "acme",
        ref: "main",
        repo: "demo",
      },
    })
  })
})
