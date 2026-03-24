import * as React from "react"
import type { RepoSource, SessionData } from "@/types/storage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function toDraft(repoSource: RepoSource | undefined) {
  return {
    owner: repoSource?.owner ?? "",
    ref: repoSource?.ref ?? "main",
    repo: repoSource?.repo ?? "",
    token: repoSource?.token ?? "",
  }
}

export function RepoSettings(props: {
  disabled?: boolean
  onSave: (repoSource?: RepoSource) => Promise<void>
  session: SessionData
}) {
  const [draft, setDraft] = React.useState(() => toDraft(props.session.repoSource))
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    setDraft(toDraft(props.session.repoSource))
  }, [props.session.id, props.session.repoSource])

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">Repository Context</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Tools run against the current session&apos;s GitHub repository. The
          selection persists with the session and becomes the default for new chats.
        </div>
      </div>

      <div className="grid gap-4 border border-foreground/10 p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="repo-owner">Owner</Label>
          <Input
            disabled={props.disabled}
            id="repo-owner"
            onChange={(event) =>
              setDraft((current) => ({ ...current, owner: event.target.value }))
            }
            placeholder="openai"
            value={draft.owner}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repo-name">Repository</Label>
          <Input
            disabled={props.disabled}
            id="repo-name"
            onChange={(event) =>
              setDraft((current) => ({ ...current, repo: event.target.value }))
            }
            placeholder="openai-node"
            value={draft.repo}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repo-ref">Ref</Label>
          <Input
            disabled={props.disabled}
            id="repo-ref"
            onChange={(event) =>
              setDraft((current) => ({ ...current, ref: event.target.value }))
            }
            placeholder="main"
            value={draft.ref}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repo-token">GitHub token</Label>
          <Input
            disabled={props.disabled}
            id="repo-token"
            onChange={(event) =>
              setDraft((current) => ({ ...current, token: event.target.value }))
            }
            placeholder="Optional PAT for private repos or higher limits"
            type="password"
            value={draft.token}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={props.disabled || isSaving}
          onClick={async () => {
            setIsSaving(true)
            try {
              await props.onSave(draft)
            } finally {
              setIsSaving(false)
            }
          }}
          size="sm"
        >
          Save repo context
        </Button>
        <Button
          disabled={props.disabled || isSaving}
          onClick={async () => {
            setIsSaving(true)
            try {
              await props.onSave(undefined)
            } finally {
              setIsSaving(false)
            }
          }}
          size="sm"
          variant="ghost"
        >
          Clear repo context
        </Button>
      </div>
    </div>
  )
}
