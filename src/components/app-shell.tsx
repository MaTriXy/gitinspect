import * as React from "react"
import { DotOutlineIcon, GearIcon } from "@phosphor-icons/react"
import { setSetting } from "@/db/schema"
import { useRuntimeState } from "@/hooks/use-runtime-state"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { useSessionData } from "@/hooks/use-session-data"
import { getCanonicalProvider } from "@/models/catalog"
import { formatRepoSourceLabel, setLastUsedRepoSource } from "@/repo/settings"
import { useSessionList } from "@/hooks/use-session-list"
import { createSession, persistSessionSnapshot } from "@/sessions/session-service"
import type { SessionData } from "@/types/storage"
import { ChatThread } from "@/components/chat-thread"
import { Composer } from "@/components/composer"
import { ModelPicker } from "@/components/model-picker"
import { ProviderBadge } from "@/components/provider-badge"
import { SessionSidebar } from "@/components/session-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"

function syncSessionToUrl(sessionId: string): void {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  url.searchParams.set("session", sessionId)
  window.history.replaceState({}, "", url)
}

export function AppShell() {
  const bootstrap = useAppBootstrap()
  const { sessions } = useSessionList()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const runtimeState = useRuntimeState()

  if (bootstrap.status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center px-6 text-sm text-destructive">
        {bootstrap.error}
      </div>
    )
  }

  if (bootstrap.status === "loading" || !bootstrap.session) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading local session state...
      </div>
    )
  }

  return (
    <ReadyAppShell
      initialSession={bootstrap.session}
      runningSessionIds={runtimeState.runningSessionIds}
      sessions={sessions}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
    />
  )
}

function ReadyAppShell(props: {
  initialSession: SessionData
  runningSessionIds: string[]
  sessions: ReturnType<typeof useSessionList>["sessions"]
  setSettingsOpen: (open: boolean) => void
  settingsOpen: boolean
}) {
  const [cachedSessions, setCachedSessions] = React.useState<Record<string, SessionData>>(
    () => ({
      [props.initialSession.id]: props.initialSession,
    })
  )
  const [selectedSessionId, setSelectedSessionId] = React.useState(
    props.initialSession.id
  )
  const [optimisticSession, setOptimisticSession] = React.useState<
    SessionData | undefined
  >(props.initialSession)
  const selectedSession = useSessionData(selectedSessionId)
  const cachedSession = cachedSessions[selectedSessionId]
  const activeSession =
    selectedSession?.id === selectedSessionId
      ? selectedSession
      : optimisticSession?.id === selectedSessionId
        ? optimisticSession
        : cachedSession?.id === selectedSessionId
          ? cachedSession
          : undefined
  const runtime = useRuntimeSession(selectedSessionId, activeSession)

  const cacheSession = React.useEffectEvent((session: SessionData) => {
    setCachedSessions((current) =>
      current[session.id] === session
        ? current
        : {
            ...current,
            [session.id]: session,
          }
    )
  })

  React.useEffect(() => {
    setSelectedSessionId(props.initialSession.id)
    setOptimisticSession(props.initialSession)
    cacheSession(props.initialSession)
  }, [props.initialSession])

  React.useEffect(() => {
    syncSessionToUrl(selectedSessionId)
  }, [selectedSessionId])

  React.useEffect(() => {
    if (selectedSession?.id !== selectedSessionId) {
      return
    }

    cacheSession(selectedSession)
    setOptimisticSession((current) =>
      current?.id === selectedSessionId ? undefined : current
    )
  }, [cacheSession, selectedSession, selectedSessionId])

  React.useEffect(() => {
    if (!activeSession) {
      return
    }

    void setSetting("last-used-model", activeSession.model)
    void setSetting("last-used-provider", activeSession.provider)
    void setSetting(
      "last-used-provider-group",
      activeSession.providerGroup ?? activeSession.provider
    )
    void setLastUsedRepoSource(activeSession.repoSource)
  }, [
    activeSession?.id,
    activeSession?.model,
    activeSession?.provider,
    activeSession?.providerGroup,
    activeSession?.repoSource,
  ])

  const setActiveSession = React.useEffectEvent(async (session: SessionData) => {
    setSelectedSessionId(session.id)
    setOptimisticSession(session)
    cacheSession(session)
    syncSessionToUrl(session.id)

    void setSetting("active-session-id", session.id)
  })

  return (
    <>
      <div className="flex min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.08),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.03),transparent_30%)]">
        <SessionSidebar
          activeSessionId={selectedSessionId}
          onCreateSession={async () => {
            if (!activeSession) {
              return
            }

            const nextSession = createSession({
              model: activeSession.model,
              providerGroup:
                activeSession.providerGroup ?? activeSession.provider,
              repoSource: activeSession.repoSource,
              thinkingLevel: activeSession.thinkingLevel,
            })
            await setActiveSession(nextSession)
            void persistSessionSnapshot(nextSession)
          }}
          onSelectSession={(sessionId) => {
            setSelectedSessionId(sessionId)
            setOptimisticSession(cachedSessions[sessionId])
            syncSessionToUrl(sessionId)
            void setSetting("active-session-id", sessionId)
          }}
          runningSessionIds={props.runningSessionIds}
          sessions={props.sessions}
        />
        <div className="flex min-h-svh min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                GitOverflow
              </div>
              <div className="mt-1 text-lg font-medium">
                {activeSession?.title ?? "Loading session..."}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker
                disabled={runtime.isStreaming || !activeSession}
                model={activeSession?.model ?? props.initialSession.model}
                onChange={async (providerGroup, model) => {
                  if (!activeSession) {
                    return
                  }

                  await runtime.setModelSelection(providerGroup, model)
                  void setSetting("active-session-id", activeSession.id)
                  void setSetting("last-used-model", model)
                  void setSetting(
                    "last-used-provider",
                    getCanonicalProvider(providerGroup)
                  )
                  void setSetting("last-used-provider-group", providerGroup)
                }}
                providerGroup={
                  activeSession?.providerGroup ??
                  activeSession?.provider ??
                  props.initialSession.providerGroup ??
                  props.initialSession.provider
                }
              />
              {activeSession ? (
                <ProviderBadge
                  provider={activeSession.provider}
                  providerGroup={
                    activeSession.providerGroup ?? activeSession.provider
                  }
                />
              ) : null}
              <div className="rounded-full border border-foreground/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {formatRepoSourceLabel(activeSession?.repoSource)}
              </div>
              <div
                className={
                  runtime.isStreaming
                    ? "flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-700"
                    : "flex items-center gap-1 rounded-full border border-foreground/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                }
              >
                <DotOutlineIcon weight={runtime.isStreaming ? "fill" : "regular"} />
                {runtime.isStreaming ? "Live" : "Idle"}
              </div>
              <Button
                onClick={() => props.setSettingsOpen(true)}
                size="icon-sm"
                variant="outline"
              >
                <GearIcon />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            {activeSession ? (
              <ChatThread
                draftAssistantMessage={runtime.runtimeDraft}
                isStreaming={runtime.isStreaming}
                messages={activeSession.messages}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                Loading session...
              </div>
            )}
          </div>
          <Composer
            error={runtime.error}
            isStreaming={activeSession ? runtime.isStreaming : false}
            onAbort={runtime.abort}
            onSend={runtime.send}
          />
        </div>
      </div>
      <SettingsDialog
        onOpenChange={props.setSettingsOpen}
        open={props.settingsOpen}
        onRepoSourceChange={runtime.setRepoSource}
        session={activeSession ?? props.initialSession}
        settingsDisabled={runtime.isStreaming || !activeSession}
      />
    </>
  )
}
