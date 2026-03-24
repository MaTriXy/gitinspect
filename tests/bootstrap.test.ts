import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmptyUsage } from "@/types/models"
import type { SessionData } from "@/types/storage"

function createSessionRecord(id: string): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-23T12:00:00.000Z",
    id,
    messages: [],
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-23T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

describe("loadInitialSession", () => {
  beforeEach(() => {
    vi.resetModules()
    window.history.replaceState({}, "", "/")
  })

  it("prefers the explicit session id from the URL", async () => {
    const loadSession = vi.fn().mockResolvedValue(createSessionRecord("session-url"))

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn(),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession: vi.fn(),
      loadMostRecentSession: vi.fn(),
      loadSession,
    }))
    vi.doMock("@/models/catalog", () => ({
      DEFAULT_MODELS: { "openai-codex": "gpt-5.1-codex-mini" },
      getDefaultModelForGroup: vi.fn().mockReturnValue({
        id: "gpt-5.1-codex-mini",
      }),
      getDefaultProviderGroup: vi.fn((provider: string) => provider),
      getPreferredProviderGroup: vi.fn().mockReturnValue("openai-codex"),
      getProviderGroups: vi.fn().mockReturnValue(["openai-codex"]),
      hasModelForGroup: vi.fn().mockReturnValue(false),
      isProviderGroupId: vi.fn().mockReturnValue(false),
    }))

    window.history.replaceState({}, "", "/?session=session-url")

    const { loadInitialSession } = await import("@/hooks/use-app-bootstrap")
    const session = await loadInitialSession()

    expect(loadSession).toHaveBeenCalledWith("session-url")
    expect(session.id).toBe("session-url")
  })

  it("falls back to the most recent saved session", async () => {
    const recentSession = createSessionRecord("session-recent")

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn(),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession: vi.fn(),
      loadMostRecentSession: vi.fn().mockResolvedValue(recentSession),
      loadSession: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock("@/models/catalog", () => ({
      DEFAULT_MODELS: { "openai-codex": "gpt-5.1-codex-mini" },
      getDefaultModelForGroup: vi.fn().mockReturnValue({
        id: "gpt-5.1-codex-mini",
      }),
      getDefaultProviderGroup: vi.fn((provider: string) => provider),
      getPreferredProviderGroup: vi.fn().mockReturnValue("openai-codex"),
      getProviderGroups: vi.fn().mockReturnValue(["openai-codex"]),
      hasModelForGroup: vi.fn().mockReturnValue(false),
      isProviderGroupId: vi.fn().mockReturnValue(false),
    }))

    const { loadInitialSession } = await import("@/hooks/use-app-bootstrap")
    await expect(loadInitialSession()).resolves.toMatchObject({
      id: "session-recent",
    })
  })

  it("uses the stored active session when the URL does not override it", async () => {
    const activeSession = createSessionRecord("session-active")
    const loadSession = vi.fn().mockResolvedValue(activeSession)

    vi.doMock("@/db/schema", () => ({
      getSetting: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("session-active"),
      listProviderKeys: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn(),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession: vi.fn(),
      loadMostRecentSession: vi.fn().mockResolvedValue(undefined),
      loadSession,
    }))
    vi.doMock("@/models/catalog", () => ({
      DEFAULT_MODELS: { "openai-codex": "gpt-5.1-codex-mini" },
      getDefaultModelForGroup: vi.fn().mockReturnValue({
        id: "gpt-5.1-codex-mini",
      }),
      getDefaultProviderGroup: vi.fn((provider: string) => provider),
      getPreferredProviderGroup: vi.fn().mockReturnValue("openai-codex"),
      getProviderGroups: vi.fn().mockReturnValue(["openai-codex"]),
      hasModelForGroup: vi.fn().mockReturnValue(false),
      isProviderGroupId: vi.fn().mockReturnValue(false),
    }))

    const { loadInitialSession } = await import("@/hooks/use-app-bootstrap")
    const session = await loadInitialSession()

    expect(loadSession).toHaveBeenCalledWith("session-active")
    expect(session.id).toBe("session-active")
  })

  it("creates a fresh session when no persisted session exists", async () => {
    const createdSession = createSessionRecord("session-new")
    const createSession = vi.fn().mockReturnValue(createdSession)

    vi.doMock("@/db/schema", () => ({
      getSetting: vi.fn().mockResolvedValue(undefined),
      listProviderKeys: vi.fn().mockResolvedValue([]),
      setSetting: vi.fn(),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      loadMostRecentSession: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock("@/models/catalog", () => ({
      DEFAULT_MODELS: { "openai-codex": "gpt-5.1-codex-mini" },
      getDefaultModelForGroup: vi.fn().mockReturnValue({
        id: "gpt-5.1-codex-mini",
      }),
      getDefaultProviderGroup: vi.fn((provider: string) => provider),
      getPreferredProviderGroup: vi.fn().mockReturnValue("openai-codex"),
      getProviderGroups: vi.fn().mockReturnValue(["openai-codex"]),
      hasModelForGroup: vi.fn().mockReturnValue(false),
      isProviderGroupId: vi.fn().mockReturnValue(false),
    }))

    const { loadInitialSession } = await import("@/hooks/use-app-bootstrap")
    const session = await loadInitialSession()

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
    })
    expect(session.id).toBe("session-new")
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
      setSetting: vi.fn(),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      loadMostRecentSession: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock("@/models/catalog", () => ({
      DEFAULT_MODELS: {
        anthropic: "claude-sonnet-4-6",
        "openai-codex": "gpt-5.1-codex-mini",
      },
      getDefaultModelForGroup: vi.fn().mockReturnValue({
        id: "claude-sonnet-4-6",
      }),
      getDefaultProviderGroup: vi.fn((provider: string) => provider),
      getPreferredProviderGroup: vi.fn().mockReturnValue("anthropic"),
      getProviderGroups: vi.fn().mockReturnValue(["openai-codex", "anthropic"]),
      hasModelForGroup: vi.fn().mockReturnValue(false),
      isProviderGroupId: vi.fn().mockReturnValue(false),
    }))

    const { loadInitialSession } = await import("@/hooks/use-app-bootstrap")
    await loadInitialSession()

    expect(createSession).toHaveBeenCalledWith({
      model: "claude-sonnet-4-6",
      providerGroup: "anthropic",
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
      setSetting: vi.fn(),
    }))
    vi.doMock("@/sessions/session-service", () => ({
      createSession,
      loadMostRecentSession: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock("@/models/catalog", () => ({
      DEFAULT_MODELS: {
        "openai-codex": "gpt-5.1-codex-mini",
      },
      getDefaultModelForGroup: vi.fn().mockReturnValue({
        id: "gpt-5.1-codex-mini",
      }),
      getDefaultProviderGroup: vi.fn((provider: string) => provider),
      getPreferredProviderGroup: vi.fn().mockReturnValue("openai-codex"),
      getProviderGroups: vi.fn().mockReturnValue(["openai-codex"]),
      hasModelForGroup: vi.fn().mockReturnValue(true),
      isProviderGroupId: vi.fn().mockReturnValue(false),
    }))

    const { loadInitialSession } = await import("@/hooks/use-app-bootstrap")
    await loadInitialSession()

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.2-codex",
      providerGroup: "openai-codex",
    })
  })
})
