import * as React from "react"
import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { SessionData } from "@/types/storage"
import { runtimeClient } from "@/agent/runtime-client"
import { getSetting, listProviderKeys, setSetting } from "@/db/schema"
import {
  getCanonicalProvider,
  getConnectedProviders,
  getDefaultModelForGroup,
  getDefaultProviderGroup,
  getPreferredProviderGroup,
  getProviderGroups,
  getVisibleProviderGroups,
  hasModelForGroup,
  isProviderGroupId,
} from "@/models/catalog"
import { getLastUsedRepoSource, setLastUsedRepoSource } from "@/repo/settings"
import {
  createSession,
  loadMostRecentSession,
  loadSession,
  persistSessionSnapshot,
} from "@/sessions/session-service"

export interface AppBootstrapState {
  error?: string
  session?: SessionData
  status: "error" | "loading" | "ready"
}

function isProviderId(value: string): value is ProviderId {
  return getProviderGroups().includes(value as ProviderGroupId) && value !== "opencode-free"
}

function normalizeVisibleSession(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>
): SessionData {
  const fallbackProviderGroup = visibleProviderGroups[0] ?? "opencode-free"
  const currentProviderGroup = session.providerGroup ?? session.provider
  const providerGroup = visibleProviderGroups.includes(currentProviderGroup)
    ? currentProviderGroup
    : fallbackProviderGroup
  const model = hasModelForGroup(providerGroup, session.model)
    ? session.model
    : getDefaultModelForGroup(providerGroup).id

  if (providerGroup === currentProviderGroup && model === session.model) {
    return session
  }

  return {
    ...session,
    model,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  }
}

async function persistVisibleSessionSelection(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>
): Promise<SessionData> {
  const normalized = normalizeVisibleSession(session, visibleProviderGroups)

  if (
    normalized.providerGroup !== session.providerGroup ||
    normalized.provider !== session.provider ||
    normalized.model !== session.model
  ) {
    await persistSessionSnapshot(normalized)
  }

  return normalized
}

export async function loadInitialSession(): Promise<SessionData> {
  const providerKeys = await listProviderKeys()
  const connectedProviders = getConnectedProviders(providerKeys)
  const visibleProviderGroups = getVisibleProviderGroups(connectedProviders)
  const fallbackProviderGroup = getPreferredProviderGroup(connectedProviders)
  const storedProviderGroup = await getSetting("last-used-provider-group")
  const storedProvider = await getSetting("last-used-provider")
  const providerGroup =
    typeof storedProviderGroup === "string" &&
    isProviderGroupId(storedProviderGroup) &&
    visibleProviderGroups.includes(storedProviderGroup)
      ? storedProviderGroup
      : typeof storedProvider === "string" && isProviderId(storedProvider)
          ? (() => {
              const nextProviderGroup = getDefaultProviderGroup(storedProvider)
              return visibleProviderGroups.includes(nextProviderGroup)
                ? nextProviderGroup
                : fallbackProviderGroup
            })()
          : fallbackProviderGroup
  const storedModel = await getSetting("last-used-model")
  const model =
    typeof storedModel === "string" && hasModelForGroup(providerGroup, storedModel)
      ? storedModel
      : getDefaultModelForGroup(providerGroup).id
  const requestedSessionId =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("session")
  const activeSessionId = await getSetting("active-session-id")
  const explicitSessionId =
    requestedSessionId ??
    (typeof activeSessionId === "string" ? activeSessionId : undefined)

  if (explicitSessionId) {
    const loaded = await loadSession(explicitSessionId)

    if (loaded) {
      return await persistVisibleSessionSelection(loaded, visibleProviderGroups)
    }
  }

  const recent = await loadMostRecentSession()

  if (recent) {
    return await persistVisibleSessionSelection(recent, visibleProviderGroups)
  }

  const created = createSession({
    model,
    providerGroup,
    repoSource: await getLastUsedRepoSource(),
  })
  await persistSessionSnapshot(created)
  return created
}

export function useAppBootstrap(): AppBootstrapState {
  const [state, setState] = React.useState<AppBootstrapState>({
    status: "loading",
  })

  React.useEffect(() => {
    let disposed = false
    const setStateIfMounted = (nextState: AppBootstrapState) => {
      if (disposed) {
        return
      }

      setState(nextState)
    }

    void (async () => {
      try {
        await runtimeClient.ensureConnected()
        const session = await loadInitialSession()

        await setSetting("active-session-id", session.id)
        await setSetting("last-used-model", session.model)
        await setSetting("last-used-provider", session.provider)
        await setSetting(
          "last-used-provider-group",
          session.providerGroup
        )
        await setLastUsedRepoSource(session.repoSource)
        setStateIfMounted({
          session,
          status: "ready",
        })
      } catch (error) {
        setStateIfMounted({
          error: error instanceof Error ? error.message : "Bootstrap failed",
          status: "error",
        })
      }
    })()

    return () => {
      disposed = true
    }
  }, [])

  return state
}
