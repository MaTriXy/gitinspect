import * as React from "react"
import { DotOutlineIcon, GearIcon } from "@phosphor-icons/react"
import { setSetting } from "@/db/schema"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { useChatSession } from "@/hooks/use-chat-session"
import { formatRepoSourceLabel } from "@/repo/settings"
import { useSessionList } from "@/hooks/use-session-list"
import { createSession, loadSession } from "@/sessions/session-service"
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

  if (bootstrap.status === "loading" || !bootstrap.session) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading local session state...
      </div>
    )
  }

  if (bootstrap.status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center px-6 text-sm text-destructive">
        {bootstrap.error}
      </div>
    )
  }

  return <ReadyAppShell initialSession={bootstrap.session} sessions={sessions} settingsOpen={settingsOpen} setSettingsOpen={setSettingsOpen} />
}

function ReadyAppShell(props: {
  initialSession: ReturnType<typeof useAppBootstrap>["session"]
  sessions: ReturnType<typeof useSessionList>["sessions"]
  setSettingsOpen: (open: boolean) => void
  settingsOpen: boolean
}) {
  const chat = useChatSession(props.initialSession!)

  React.useEffect(() => {
    syncSessionToUrl(chat.session.id)
  }, [chat.session.id])

  return (
    <>
      <div className="flex min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.08),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.03),transparent_30%)]">
        <SessionSidebar
          activeSessionId={chat.session.id}
          onCreateSession={async () => {
            const nextSession = createSession({
              model: chat.session.model,
              providerGroup:
                chat.session.providerGroup ?? chat.session.provider,
              repoSource: chat.session.repoSource,
              thinkingLevel: chat.session.thinkingLevel,
            })
            await chat.replaceSession(nextSession)
          }}
          onSelectSession={async (sessionId) => {
            const loaded = await loadSession(sessionId)

            if (!loaded) {
              return
            }

            await chat.replaceSession(loaded)
          }}
          sessions={props.sessions}
        />
        <div className="flex min-h-svh min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                GitOverflow
              </div>
              <div className="mt-1 text-lg font-medium">{chat.session.title}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker
                model={chat.session.model}
                onChange={async (providerGroup, model) => {
                  await chat.setModelSelection(providerGroup, model)
                  await setSetting("active-session-id", chat.session.id)
                }}
                providerGroup={
                  chat.session.providerGroup ?? chat.session.provider
                }
              />
              <ProviderBadge
                provider={chat.session.provider}
                providerGroup={
                  chat.session.providerGroup ?? chat.session.provider
                }
              />
              <div className="rounded-full border border-foreground/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {formatRepoSourceLabel(chat.session.repoSource)}
              </div>
              <div
                className={
                  chat.isStreaming
                    ? "flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-700"
                    : "flex items-center gap-1 rounded-full border border-foreground/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                }
              >
                <DotOutlineIcon weight={chat.isStreaming ? "fill" : "regular"} />
                {chat.isStreaming ? "Live" : "Idle"}
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
            <ChatThread
              isStreaming={chat.isStreaming}
              messages={chat.session.messages}
            />
          </div>
          <Composer
            error={chat.error}
            isStreaming={chat.isStreaming}
            onAbort={chat.abort}
            onSend={chat.send}
          />
        </div>
      </div>
      <SettingsDialog
        onOpenChange={props.setSettingsOpen}
        open={props.settingsOpen}
        onRepoSourceChange={chat.setRepoSource}
        session={chat.session}
      />
    </>
  )
}
