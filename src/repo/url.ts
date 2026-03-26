import type { RepoSource } from "@/types/storage"

/** Top-level app paths that are not owner/repo routes */
const RESERVED_ROOT_SEGMENTS = new Set([
  "auth",
  "chat",
  "api",
])

/**
 * Third path segment on GitHub that is never a branch/tag name for our
 * `/:owner/:repo/:ref` shorthand (conservative list).
 */
const RESERVED_REPO_SUBPATHS = new Set([
  "actions",
  "activity",
  "archive",
  "blob",
  "branches",
  "commit",
  "commits",
  "community",
  "compare",
  "contributors",
  "custom-properties",
  "dependabot",
  "discussions",
  "edit",
  "forks",
  "graphs",
  "insights",
  "issues",
  "issues-new",
  "labels",
  "marketplace",
  "milestones",
  "network",
  "new",
  "packages",
  "projects",
  "pull",
  "pulls",
  "pulse",
  "releases",
  "search",
  "security",
  "settings",
  "stargazers",
  "tags",
  "tree",
  "watchers",
  "wiki",
])

const SEGMENT_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/

function isValidSegment(segment: string): boolean {
  if (!segment || segment.length > 200) {
    return false
  }

  if (segment === "." || segment === "..") {
    return false
  }

  return SEGMENT_PATTERN.test(segment)
}

function stripDotGit(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo
}

export interface ParsedRepoPath {
  owner: string
  ref?: string
  repo: string
}

/**
 * Parse a URL pathname into owner/repo (and optional ref) for GitHub-style
 * paths. Used when the app host replaces github.com (same path shape).
 *
 * - `/:owner/:repo` — repo root, ref left to defaults
 * - `/:owner/:repo/:ref` — single-segment ref when not a reserved subpath
 * - `/:owner/:repo/tree/:ref/...` — ref is first segment after `tree` when
 *   there is at most one segment after `tree` (otherwise ambiguous → no ref)
 * - `/:owner/:repo/blob/:ref/...` — ref is always the first segment after `blob`
 */
export function parseRepoPathname(pathname: string): ParsedRepoPath | undefined {
  const raw = pathname.trim()
  if (!raw || raw === "/") {
    return undefined
  }

  const segments = raw
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)

  if (segments.length < 2) {
    return undefined
  }

  if (RESERVED_ROOT_SEGMENTS.has(segments[0]!)) {
    return undefined
  }

  const owner = segments[0]!
  let repo = stripDotGit(segments[1]!)

  if (!isValidSegment(owner) || !isValidSegment(repo)) {
    return undefined
  }

  if (segments.length === 2) {
    return { owner, repo }
  }

  const third = segments[2]!

  if (third === "tree") {
    const afterTree = segments.slice(3)
    if (afterTree.length === 0) {
      return { owner, repo }
    }

    if (afterTree.length === 1) {
      const ref = afterTree[0]!
      return isValidSegment(ref) ? { owner, ref, repo } : { owner, repo }
    }

    // More than one segment after tree: branch may contain "/" — omit ref
    return { owner, repo }
  }

  if (third === "blob") {
    const ref = segments[3]
    if (ref && isValidSegment(ref)) {
      return { owner, ref, repo }
    }

    return { owner, repo }
  }

  if (RESERVED_REPO_SUBPATHS.has(third)) {
    return { owner, repo }
  }

  if (segments.length === 3) {
    return isValidSegment(third)
      ? { owner, ref: third, repo }
      : { owner, repo }
  }

  return { owner, repo }
}

/**
 * Build a canonical pathname for the repo (and optional ref) for URL sync.
 */
export function buildRepoPathname(
  owner: string,
  repo: string,
  ref?: string
): string {
  const o = owner.trim()
  const r = repo.trim()
  const path = ref?.trim()
    ? `/${encodeURIComponent(o)}/${encodeURIComponent(r)}/${encodeURIComponent(ref!.trim())}`
    : `/${encodeURIComponent(o)}/${encodeURIComponent(r)}`

  return path
}

/**
 * GitHub serves an avatar image at this URL for users and organizations
 * (redirects to avatars.githubusercontent.com).
 */
export function githubOwnerAvatarUrl(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner)}.png`
}

/**
 * Convert a parsed path + defaults into a RepoSource (no token).
 */
export function parsedPathToRepoSource(
  parsed: ParsedRepoPath
): Pick<RepoSource, "owner" | "ref" | "repo"> {
  return {
    owner: parsed.owner,
    ref: parsed.ref ?? "main",
    repo: parsed.repo,
  }
}
