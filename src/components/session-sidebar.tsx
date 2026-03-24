import type { SessionMetadata } from "@/types/storage"
import { getProviderGroupMetadata } from "@/models/catalog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

export function SessionSidebar(props: {
  activeSessionId: string
  onCreateSession: () => void
  onSelectSession: (sessionId: string) => void
  runningSessionIds: string[]
  sessions: SessionMetadata[]
}) {
  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-r border-foreground/10 bg-card/30">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Sessions
          </div>
          <div className="mt-1 text-sm font-medium">Local history</div>
        </div>
        <Button onClick={props.onCreateSession} size="sm" variant="outline">
          New chat
        </Button>
      </div>
      <ScrollArea className="h-full">
        <div className="flex flex-col">
          {props.sessions.map((session) => {
            const active = session.id === props.activeSessionId
            const running = props.runningSessionIds.includes(session.id)
            const providerGroup = session.providerGroup ?? session.provider

            return (
              <button
                className={`border-b border-foreground/8 px-4 py-4 text-left transition hover:bg-foreground/5 ${active ? "bg-foreground/6" : ""}`}
                key={session.id}
                onClick={() => props.onSelectSession(session.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{session.title}</div>
                  {running ? (
                    <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-700">
                      Live
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                  {session.preview || "No preview yet"}
                </div>
                <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {getProviderGroupMetadata(providerGroup).label} · {session.model}
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
