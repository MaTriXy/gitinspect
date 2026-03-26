import * as React from "react"
import { Navigate, createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { runtimeClient } from "@/agent/runtime-client"
import { AppShellLayout } from "@/components/app-shell-layout"
import { Chat } from "@/components/chat"
import { EmptyChatContent, type EmptyChatDraft } from "@/components/empty-chat-content"
import { ChatHeader } from "@/components/chat-header"
import { ChatSidebar } from "@/components/chat-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { listSessions, touchRepository } from "@/db/schema"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { getCanonicalProvider } from "@/models/catalog"
import type { RepoSource } from "@/types/storage"
import {
  createSessionAndSend,
  deleteSessionAndResolveNext,
  navigateToSession,
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
} from "@/sessions/session-actions"
import { loadSessionWithMessages } from "@/sessions/session-service"

type RepoSplatSearch = {
  session?: string
}

export const Route = createFileRoute("/$owner/$repo/$")({
  validateSearch: (search: RepoSplatSearch) => ({
    session:
      typeof search.session === "string" && search.session.length > 0
        ? search.session
        : undefined,
  }),
  component: RepoChatRoute,
})

function RepoChatRoute() {
  const search = Route.useSearch()
  const params = Route.useParams()
  const navigate = Route.useNavigate()
  const repoSource = React.useMemo(
    () =>
      ({
        owner: params.owner,
        ref: params._splat ?? "main",
        repo: params.repo,
      }) satisfies RepoSource,
    [params._splat, params.owner, params.repo]
  )
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

  React.useEffect(() => {
    void touchRepository(repoSource)
  }, [repoSource])

  const sessionList = sessions ?? []
  const sidebarSessions = sessionList.filter((session) => {
    return (
      session.repoSource?.owner === repoSource.owner &&
      session.repoSource?.repo === repoSource.repo &&
      session.repoSource?.ref === repoSource.ref
    )
  })
  const runningSessionIds = sidebarSessions
    .filter((session) => session.isStreaming)
    .map((session) => session.id)
  const runtime = useRuntimeSession(search.session)
  const settingsSection = search.settings ?? "providers"
  const settingsOpen = search.settings !== undefined

  if (search.session && selectedSessionState === null) {
    return (
      <Navigate
        params={{
          _splat: repoSource.ref,
          owner: repoSource.owner,
          repo: repoSource.repo,
        }}
        replace
        search={{
          settings: search.settings,
          sidebar: search.sidebar,
          session: undefined,
        }}
        to="/$owner/$repo/$"
      />
    )
  }

  const selectedSession = selectedSessionState?.session
  const selectedMessages = selectedSessionState?.messages

  if (
    selectedSession &&
    (selectedSession.repoSource?.owner !== repoSource.owner ||
      selectedSession.repoSource?.repo !== repoSource.repo ||
      selectedSession.repoSource?.ref !== repoSource.ref)
  ) {
    return (
      <Navigate
        {...navigateToSession(
          {
            id: selectedSession.id,
            repoSource: selectedSession.repoSource,
          },
          {
            settings: search.settings,
            sidebar: search.sidebar,
          }
        )}
        replace
      />
    )
  }

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
      repoSource,
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
      params: {
        _splat: repoSource.ref,
        owner: repoSource.owner,
        repo: repoSource.repo,
      },
      replace: search.session !== undefined,
      search: {
        settings: search.settings,
        sidebar: search.sidebar,
        session: undefined,
      },
      to: "/$owner/$repo/$",
    })
  }

  const handleSelectSession = (sessionId: string) => {
    const session = sidebarSessions.find((candidate) => candidate.id === sessionId)

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
        siblingSessions: sidebarSessions,
      })

      if (!wasSelected) {
        return
      }

      if (!nextSession) {
        await navigate({
          params: {
            _splat: repoSource.ref,
            owner: repoSource.owner,
            repo: repoSource.repo,
          },
          replace: true,
          search: {
            settings: search.settings,
            sidebar: search.sidebar,
            session: undefined,
          },
          to: "/$owner/$repo/$",
        })
        return
      }

      const nextMetadata = sidebarSessions.find(
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
          key={`${repoSource.owner}/${repoSource.repo}/${repoSource.ref}:${emptyDraft.providerGroup}:${emptyDraft.model}`}
          onDraftChange={handleDraftChange}
          onSend={handleFirstSend}
          repoSource={repoSource}
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
          repoSource={selectedSession?.repoSource ?? repoSource}
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
          sessions={sidebarSessions}
        />
      }
      sidebarOpen={search.sidebar === "open"}
    />
  )
}
