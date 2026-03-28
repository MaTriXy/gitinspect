import type { RepoSource, RepoTarget } from "@/types/storage"
import { githubApiFetch } from "@/repo/github-fetch"

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function normalizeRepoSource(
  source: RepoTarget | RepoSource | undefined
): RepoSource | undefined {
  if (!source) {
    return undefined
  }

  const owner = trimToUndefined(source.owner)
  const repo = trimToUndefined(source.repo)
  const ref = trimToUndefined(source.ref)

  if (!owner || !repo || !ref) {
    return undefined
  }

  return {
    owner,
    ref,
    repo,
    token: trimToUndefined(source.token),
  }
}

type GitHubRepoResponse = {
  default_branch?: string
}

export async function resolveRepoSource(
  source: RepoTarget | RepoSource
): Promise<RepoSource> {
  const normalized = normalizeRepoSource(source)
  if (normalized) {
    return normalized
  }

  const owner = trimToUndefined(source.owner)
  const repo = trimToUndefined(source.repo)
  if (!owner || !repo) {
    throw new Error("A repository owner and name are required")
  }

  const res = await githubApiFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  )
  if (!res.ok) {
    throw new Error(`Repository ${owner}/${repo} not found`)
  }

  const payload = (await res.json()) as GitHubRepoResponse
  const ref = trimToUndefined(payload.default_branch)
  if (!ref) {
    throw new Error(`Repository ${owner}/${repo} does not expose a default branch`)
  }

  return {
    owner,
    ref,
    repo,
    token: trimToUndefined(source.token),
  }
}

export function formatRepoSourceLabel(source: RepoSource | undefined): string {
  if (!source) {
    return "No repository selected"
  }

  return `${source.owner}/${source.repo}@${source.ref}`
}
