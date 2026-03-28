import { createFileRoute } from "@tanstack/react-router"
import type { RepoTarget } from "@/types/storage"
import { Chat } from "@/components/chat"

type RepoSearch = {
  initialQuery?: string
  session?: string
}

export const Route = createFileRoute("/$owner/$repo/")({
  validateSearch: (search: RepoSearch) => ({
    initialQuery:
      typeof search.initialQuery === "string" && search.initialQuery.trim().length > 0
        ? search.initialQuery
        : undefined,
    session:
      typeof search.session === "string" && search.session.length > 0
        ? search.session
        : undefined,
  }),
  component: RepoChatRoute,
})

function RepoChatRoute() {
  const params = Route.useParams()
  const repoSource: RepoTarget = {
    owner: params.owner,
    ref: "main",
    repo: params.repo,
  }

  return <Chat repoSource={repoSource} />
}
