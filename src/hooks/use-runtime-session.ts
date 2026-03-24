import * as React from "react"
import { runtimeClientStore } from "@/agent/runtime-client"
import { loadSession } from "@/sessions/session-service"
import type { SessionData } from "@/types/storage"

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Runtime request failed"
  }

  switch (error.message) {
    case "busy":
      return "This session is already streaming."
    case "missing-session":
      return "This session is not attached to the live runtime."
    default:
      return error.message
  }
}

export function useRuntimeSession(
  sessionId: string | undefined,
  session?: SessionData
) {
  const [actionError, setActionError] = React.useState<string | undefined>(undefined)
  const subscribe = React.useCallback((onStoreChange: () => void) => {
    if (!sessionId) {
      return () => {}
    }

    return runtimeClientStore.subscribeSession(sessionId, onStoreChange)
  }, [sessionId])
  const getSnapshot = React.useCallback(() => {
    return sessionId
      ? runtimeClientStore.getSessionSnapshot(sessionId)
      : undefined
  }, [sessionId])

  const snapshot = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  )

  const ensureHydrated = React.useEffectEvent(async () => {
    if (!sessionId) {
      return false
    }

    const hydrateTarget =
      session?.id === sessionId ? session : await loadSession(sessionId)

    if (!hydrateTarget) {
      return false
    }

    await runtimeClientStore.hydrateSession(hydrateTarget)
    return true
  })

  React.useEffect(() => {
    if (!sessionId) {
      return
    }

    let cancelled = false

    void (async () => {
      const hydrateTarget =
        session?.id === sessionId ? session : await loadSession(sessionId)

      if (!hydrateTarget || cancelled) {
        return
      }

      await runtimeClientStore.hydrateSession(hydrateTarget)
    })()

    return () => {
      cancelled = true
      void runtimeClientStore.unobserveSession(sessionId)
    }
  }, [session, sessionId])

  const send = React.useEffectEvent(async (content: string) => {
    if (!sessionId) {
      return
    }

    setActionError(undefined)

    try {
      await ensureHydrated()
      await runtimeClientStore.send(sessionId, content)
    } catch (error) {
      setActionError(getErrorMessage(error))
    }
  })

  const abort = React.useEffectEvent(async () => {
    if (!sessionId) {
      return
    }

    setActionError(undefined)
    await runtimeClientStore.abort(sessionId)
  })

  const setModelSelection = React.useEffectEvent(
    async (providerGroup: Parameters<typeof runtimeClientStore.setModelSelection>[1], model: string) => {
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        await ensureHydrated()
        await runtimeClientStore.setModelSelection(sessionId, providerGroup, model)
      } catch (error) {
        setActionError(getErrorMessage(error))
      }
    }
  )

  const setRepoSource = React.useEffectEvent(
    async (repoSource?: Parameters<typeof runtimeClientStore.setRepoSource>[1]) => {
      if (!sessionId) {
        return
      }

      setActionError(undefined)

      try {
        await ensureHydrated()
        await runtimeClientStore.setRepoSource(sessionId, repoSource)
      } catch (error) {
        setActionError(getErrorMessage(error))
      }
    }
  )

  return {
    abort,
    error: actionError ?? snapshot?.error,
    isStreaming: snapshot?.isStreaming ?? false,
    lastEventAt: snapshot?.lastEventAt,
    runtimeDraft: snapshot?.draftAssistantMessage,
    send,
    setModelSelection,
    setRepoSource,
  }
}
