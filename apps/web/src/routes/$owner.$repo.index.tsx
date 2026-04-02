import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "@gitinspect/ui/components/chat";
import { resolveRepoTarget } from "@gitinspect/pi/repo/ref-resolver";

type RepoSearch = {
  q?: string;
};

export const Route = createFileRoute("/$owner/$repo/")({
  loader: async ({ params }) =>
    await resolveRepoTarget({
      owner: params.owner,
      repo: params.repo,
    }),
  validateSearch: (search: RepoSearch) => ({
    q: typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined,
  }),
  component: RepoChatRoute,
});

function RepoChatRoute() {
  const repoSource = Route.useLoaderData();

  return <Chat repoSource={repoSource} />;
}
