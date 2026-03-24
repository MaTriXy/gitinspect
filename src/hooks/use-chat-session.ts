import * as React from "react"
import { AgentHost, type AgentHostSnapshot } from "@/agent/agent-host"
import { setSetting } from "@/db/schema"
import { getCanonicalProvider } from "@/models/catalog"
import { setLastUsedRepoSource } from "@/repo/settings"
import type { ProviderGroupId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

export function useChatSession(initialSession: SessionData) {
  const hostRef = React.useRef<AgentHost | undefined>(undefined)
  const [mountedSession, setMountedSession] = React.useState(initialSession)
  const [snapshot, setSnapshot] = React.useState<AgentHostSnapshot>({
    isStreaming: false,
    session: initialSession,
  })

  React.useEffect(() => {
    setMountedSession(initialSession)
    setSnapshot({
      isStreaming: false,
      session: initialSession,
    })
  }, [initialSession])

  React.useEffect(() => {
    hostRef.current?.dispose()

    const host = new AgentHost(mountedSession, (nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })

    hostRef.current = host
    setSnapshot({
      isStreaming: false,
      session: mountedSession,
    })

    return () => {
      host.dispose()
      if (hostRef.current === host) {
        hostRef.current = undefined
      }
    }
  }, [mountedSession])

  const replaceSession = React.useEffectEvent(async (nextSession: SessionData) => {
    setMountedSession(nextSession)
    setSnapshot({
      isStreaming: false,
      session: nextSession,
    })
    await setSetting("active-session-id", nextSession.id)
    await setSetting("last-used-model", nextSession.model)
    await setSetting("last-used-provider", nextSession.provider)
    await setSetting(
      "last-used-provider-group",
      nextSession.providerGroup ?? nextSession.provider
    )
    await setLastUsedRepoSource(nextSession.repoSource)
  })

  const setModelSelection = React.useEffectEvent(
    async (providerGroup: ProviderGroupId, model: string) => {
      await hostRef.current?.setModelSelection(providerGroup, model)
      await setSetting("last-used-model", model)
      await setSetting("last-used-provider", getCanonicalProvider(providerGroup))
      await setSetting("last-used-provider-group", providerGroup)
    }
  )

  const send = React.useEffectEvent(async (content: string) => {
    if (!content.trim() || snapshot.isStreaming) {
      return
    }

    await hostRef.current?.prompt(content)
  })

  const abort = React.useEffectEvent(() => {
    hostRef.current?.abort()
  })

  const setRepoSource = React.useEffectEvent(async (repoSource?: RepoSource) => {
    const nextSession = await hostRef.current?.setRepoSource(repoSource)

    if (!nextSession) {
      return
    }

    setMountedSession(nextSession)
    setSnapshot({
      isStreaming: false,
      session: nextSession,
    })
    await setLastUsedRepoSource(nextSession.repoSource)
  })

  return {
    abort,
    error: snapshot.error,
    isStreaming: snapshot.isStreaming,
    replaceSession,
    send,
    session: snapshot.session,
    setModelSelection,
    setRepoSource,
  }
}
