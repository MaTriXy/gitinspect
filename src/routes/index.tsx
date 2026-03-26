import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { AppShellLayout } from "@/components/app-shell-layout"
import { ChatHeader } from "@/components/chat-header"
import { ChatSidebar } from "@/components/chat-sidebar"
import { LandingPage } from "@/components/landing-page"
import { SettingsDialog } from "@/components/settings-dialog"
import { listSessions } from "@/db/schema"
import {
  deleteSessionAndResolveNext,
  navigateToSession,
  persistLastUsedSessionSettings,
} from "@/sessions/session-actions"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const sessions = useLiveQuery(async () => await listSessions(), [])

  const sessionList = sessions ?? []
  const runningSessionIds = sessionList
    .filter((session) => session.isStreaming)
    .map((session) => session.id)
  const settingsSection = search.settings ?? "providers"
  const settingsOpen = search.settings !== undefined

  const handleCreateSession = () => {
    void navigate({
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
    void deleteSessionAndResolveNext({
      sessionId,
      siblingSessions: sessionList,
    })
  }

  return (
    <AppShellLayout
      header={
        <ChatHeader
          onOpenSettings={() => {
            void navigate({
              search: {
                settings: "providers",
                sidebar: search.sidebar,
              },
            })
          }}
        />
      }
      main={<LandingPage />}
      onSidebarOpenChange={(open) => {
        void navigate({
          search: {
            settings: search.settings,
            sidebar: open ? "open" : undefined,
          },
        })
      }}
      settings={
        <SettingsDialog
          onOpenChange={(open) => {
            void navigate({
              search: {
                settings: open ? settingsSection : undefined,
                sidebar: search.sidebar,
              },
            })
          }}
          onSectionChange={(section) => {
            void navigate({
              search: {
                settings: section,
                sidebar: search.sidebar,
              },
            })
          }}
          open={settingsOpen}
          section={settingsSection}
        />
      }
      sidebar={
        <ChatSidebar
          activeSessionId=""
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
