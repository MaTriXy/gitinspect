import type { RepoSource } from "@/types/storage"

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function normalizeRepoSource(
  source: RepoSource | undefined
): RepoSource | undefined {
  if (!source) {
    return undefined
  }

  const owner = trimToUndefined(source.owner)
  const repo = trimToUndefined(source.repo)

  if (!owner || !repo) {
    return undefined
  }

  return {
    owner,
    ref: trimToUndefined(source.ref) ?? "main",
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
