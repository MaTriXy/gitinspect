import * as React from "react"
import { runtimeClientStore } from "@/agent/runtime-client"
import { getSetting, listProviderKeys, setSetting } from "@/db/schema"
import {
  getDefaultModelForGroup,
  getDefaultProviderGroup,
  getPreferredProviderGroup,
  getProviderGroups,
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
import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { SessionData } from "@/types/storage"

export interface AppBootstrapState {
  error?: string
  session?: SessionData
  status: "error" | "loading" | "ready"
}

function isProviderId(value: string): value is ProviderId {
  return getProviderGroups().includes(value as ProviderGroupId) && value !== "opencode-free"
}

export async function loadInitialSession(): Promise<SessionData> {
  const providerKeys = await listProviderKeys()
  const storedProviderGroup = await getSetting("last-used-provider-group")
  const storedProvider = await getSetting("last-used-provider")
  const providerGroup =
    typeof storedProviderGroup === "string" &&
    isProviderGroupId(storedProviderGroup)
      ? storedProviderGroup
      : typeof storedProvider === "string" && isProviderId(storedProvider)
        ? getDefaultProviderGroup(storedProvider)
        : getPreferredProviderGroup(providerKeys.map((record) => record.provider))
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
      return loaded
    }
  }

  const recent = await loadMostRecentSession()

  if (recent) {
    return recent
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

    void (async () => {
      try {
        await runtimeClientStore.ensureConnected()
        const session = await loadInitialSession()

        await setSetting("active-session-id", session.id)
        await setSetting("last-used-model", session.model)
        await setSetting("last-used-provider", session.provider)
        await setSetting(
          "last-used-provider-group",
          session.providerGroup ?? session.provider
        )
        await setLastUsedRepoSource(session.repoSource)

        if (!disposed) {
          setState({
            session,
            status: "ready",
          })
        }
      } catch (error) {
        if (!disposed) {
          setState({
            error: error instanceof Error ? error.message : "Bootstrap failed",
            status: "error",
          })
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [])

  return state
}
