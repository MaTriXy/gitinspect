import * as React from "react"
import { useRouterState } from "@tanstack/react-router"
import { runtimeClient } from "@/agent/runtime-client"
import { setSetting, touchRecentRepo } from "@/db/schema"
import { getDefaultProviderGroup } from "@/models/catalog"
import { normalizeRepoSource } from "@/repo/settings"
import { loadInitialSessionFromLocation } from "@/sessions/initial-session"
import type { SessionData } from "@/types/storage"

export interface AppBootstrapState {
  error?: string
  session?: SessionData
  status: "error" | "loading" | "ready"
}

export function useAppBootstrap(): AppBootstrapState {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  }) as string
  const search = useRouterState({
    select: (s) => s.location.search,
  }) as string

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
        const session = await loadInitialSessionFromLocation({
          pathname,
          search,
        })

        if (disposed) {
          return
        }

        if (!session) {
          setStateIfMounted({
            status: "ready",
          })
          return
        }

        const repo = normalizeRepoSource(session.repoSource)
        if (repo) {
          await touchRecentRepo({
            owner: repo.owner,
            ref: repo.ref,
            repo: repo.repo,
          })
        }

        await setSetting("last-used-model", session.model)
        await setSetting("last-used-provider", session.provider)
        await setSetting(
          "last-used-provider-group",
          session.providerGroup ?? getDefaultProviderGroup(session.provider)
        )
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
  }, [pathname, search])

  return state
}
