import { Navigate, createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { runtimeClient } from "@/agent/runtime-client"
import { AppShellLayout } from "@/components/app-shell-layout"
import { Chat } from "@/components/chat"
import { EmptyChatContent, type EmptyChatDraft } from "@/components/empty-chat-content"
import { ChatHeader } from "@/components/chat-header"
import { ChatSidebar } from "@/components/chat-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { listSessions } from "@/db/schema"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { getCanonicalProvider } from "@/models/catalog"
import {
  createSessionAndSend,
  deleteSessionAndResolveNext,
  navigateToSession,
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
} from "@/sessions/session-actions"
import { loadSessionWithMessages } from "@/sessions/session-service"

type ChatSearch = {
  session?: string
}

export const Route = createFileRoute("/chat")({
  validateSearch: (search: ChatSearch) => ({
    session:
      typeof search.session === "string" && search.session.length > 0
        ? search.session
        : undefined,
  }),
  component: ChatRoute,
})

function ChatRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const sessions = useLiveQuery(async () => await listSessions(), [])
  const selectedSessionState = useLiveQuery(async () => {
    if (!search.session) {
      return null
    }

    return (await loadSessionWithMessages(search.session)) ?? null
  }, [search.session])
  const emptyDraft = useLiveQuery(async () => {
    const defaults = await resolveProviderDefaults()

    return {
      model: defaults.model,
      providerGroup: defaults.providerGroup,
      thinkingLevel: "medium",
    } satisfies EmptyChatDraft
  }, [])

  const sessionList = sessions ?? []
  const runningSessionIds = sessionList
    .filter((session) => session.isStreaming)
    .map((session) => session.id)
  const runtime = useRuntimeSession(search.session)
  const settingsSection = search.settings ?? "providers"
  const settingsOpen = search.settings !== undefined

  if (search.session && selectedSessionState === null) {
    return (
      <Navigate
        replace
        search={{
          settings: search.settings,
          sidebar: search.sidebar,
          session: undefined,
        }}
        to="/chat"
      />
    )
  }

  const selectedSession = selectedSessionState?.session
  const selectedMessages = selectedSessionState?.messages

  const handleDraftChange = (draft: EmptyChatDraft) => {
    void persistLastUsedSessionSettings({
      model: draft.model,
      provider: getCanonicalProvider(draft.providerGroup),
      providerGroup: draft.providerGroup,
    })
  }

  const handleFirstSend = async (content: string, draft: EmptyChatDraft) => {
    const session = await createSessionAndSend({
      base: {
        model: draft.model,
        provider: getCanonicalProvider(draft.providerGroup),
        providerGroup: draft.providerGroup,
        thinkingLevel: draft.thinkingLevel,
      },
      content,
    })

    await navigate(
      navigateToSession(
        {
          id: session.id,
          repoSource: session.repoSource,
        },
        {
          settings: search.settings,
          sidebar: search.sidebar,
        }
      )
    )
  }

  const handleCreateSession = () => {
    void navigate({
      replace: search.session !== undefined,
      search: {
        settings: search.settings,
        sidebar: search.sidebar,
        session: undefined,
      },
      to: "/chat",
    })
  }

  const handleSelectSession = (sessionId: string) => {
    const session = sessionList.find((candidate) => candidate.id === sessionId)

    if (!session) {
      return
    }

    void (async () => {
      await persistLastUsedSessionSettings({
        model: session.model,
        provider: session.provider,
        providerGroup: session.providerGroup,
      })

      await navigate(
        navigateToSession(
          {
            id: session.id,
            repoSource: session.repoSource,
          },
          {
            settings: search.settings,
            sidebar: search.sidebar,
          }
        )
      )
    })()
  }

  const handleDeleteSession = (sessionId: string) => {
    void (async () => {
      const wasSelected = sessionId === search.session
      const { nextSession } = await deleteSessionAndResolveNext({
        sessionId,
        siblingSessions: sessionList,
      })

      if (!wasSelected) {
        return
      }

      if (!nextSession) {
        await navigate({
          replace: true,
          search: {
            settings: search.settings,
            sidebar: search.sidebar,
            session: undefined,
          },
          to: "/chat",
        })
        return
      }

      const nextMetadata = sessionList.find(
        (session) => session.id === nextSession.id
      )

      if (nextMetadata) {
        await persistLastUsedSessionSettings({
          model: nextMetadata.model,
          provider: nextMetadata.provider,
          providerGroup: nextMetadata.providerGroup,
        })
      }

      await navigate(
        navigateToSession(nextSession, {
          settings: search.settings,
          sidebar: search.sidebar,
        })
      )
    })()
  }

  const main = (() => {
    if (!search.session) {
      if (!emptyDraft) {
        return (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            Loading composer...
          </div>
        )
      }

      return (
        <EmptyChatContent
          initialDraft={emptyDraft}
          key={`${emptyDraft.providerGroup}:${emptyDraft.model}`}
          onDraftChange={handleDraftChange}
          onSend={handleFirstSend}
        />
      )
    }

    if (!selectedSession || !selectedMessages) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
          Loading session...
        </div>
      )
    }

    return (
      <Chat
        error={runtime.error ?? selectedSession.error}
        messages={selectedMessages}
        onOpenGithubSettings={() => {
          void navigate({
            search: {
              settings: "github",
              sidebar: search.sidebar,
              session: search.session,
            },
          })
        }}
        runtime={runtime}
        session={selectedSession}
      />
    )
  })()

  return (
    <AppShellLayout
      header={
        <ChatHeader
          onOpenSettings={() => {
            void navigate({
              search: {
                settings: "providers",
                sidebar: search.sidebar,
                session: search.session,
              },
            })
          }}
          repoSource={selectedSession?.repoSource}
          settingsDisabled={selectedSession?.isStreaming ?? false}
        />
      }
      main={main}
      onSidebarOpenChange={(open) => {
        void navigate({
          search: {
            settings: search.settings,
            sidebar: open ? "open" : undefined,
            session: search.session,
          },
        })
      }}
      settings={
        <SettingsDialog
          onGithubTokenSaved={() => {
            if (!search.session) {
              return
            }

            void runtimeClient.refreshGithubToken(search.session)
          }}
          onOpenChange={(open) => {
            void navigate({
              search: {
                settings: open ? settingsSection : undefined,
                sidebar: search.sidebar,
                session: search.session,
              },
            })
          }}
          onSectionChange={(section) => {
            void navigate({
              search: {
                settings: section,
                sidebar: search.sidebar,
                session: search.session,
              },
            })
          }}
          open={settingsOpen}
          section={settingsSection}
          session={selectedSession}
          settingsDisabled={selectedSession?.isStreaming ?? false}
        />
      }
      sidebar={
        <ChatSidebar
          activeSessionId={search.session ?? ""}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={handleSelectSession}
          runningSessionIds={runningSessionIds}
          sessions={sessionList}
        />
      }
      sidebarOpen={search.sidebar === "open"}
    />
  )
}
