import { readGitHubErrorMessage, toGitHubFsError } from "@gitinspect/pi/lib/github/github-http";
import { GitHubFsError } from "@gitinspect/pi/lib/github/types";
import { githubApiFetch } from "@gitinspect/pi/repo/github-fetch";
import {
  createBranchRepoRef,
  createCommitRepoRef,
  createTagRepoRef,
  displayResolvedRepoRef,
} from "@gitinspect/pi/repo/refs";
import type { RepoTarget, ResolvedRepoRef, ResolvedRepoSource } from "@gitinspect/db/storage-types";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

type GitHubCommitLookup = {
  sha: string;
};

type GitHubRepositoryPayload = {
  default_branch?: string;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireTrimmed(value: string | undefined, field: string): string {
  const trimmed = trimToUndefined(value);

  if (!trimmed) {
    throw new Error(`A repository ${field} is required`);
  }

  return trimmed;
}

async function throwGitHubResponseError(response: Response, path: string): Promise<never> {
  throw toGitHubFsError(response, path, await readGitHubErrorMessage(response));
}

async function requestGitHubJson<T>(path: string, pathForError: string): Promise<T> {
  const response = await githubApiFetch(path);

  if (!response.ok) {
    await throwGitHubResponseError(response, pathForError);
  }

  return (await response.json()) as T;
}

async function requestGitHubJsonOrUndefined<T>(
  path: string,
  pathForError: string,
): Promise<T | undefined> {
  const response = await githubApiFetch(path);

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    await throwGitHubResponseError(response, pathForError);
  }

  return (await response.json()) as T;
}

async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const payload = await requestGitHubJson<GitHubRepositoryPayload>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    `/${owner}/${repo}`,
  );
  const defaultBranch = trimToUndefined(payload.default_branch);

  if (!defaultBranch) {
    throw new Error(`Repository ${owner}/${repo} does not expose a default branch`);
  }

  return defaultBranch;
}

async function lookupCommitByRef(
  owner: string,
  repo: string,
  ref: string,
): Promise<GitHubCommitLookup | undefined> {
  return await requestGitHubJsonOrUndefined<GitHubCommitLookup>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
    ref,
  );
}

async function resolveTreeOrBlobTail(
  owner: string,
  repo: string,
  tail: string,
): Promise<ResolvedRepoRef> {
  const segments = tail
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (let index = segments.length; index >= 1; index -= 1) {
    const candidate = segments.slice(0, index).join("/");

    if (await lookupCommitByRef(owner, repo, `heads/${candidate}`)) {
      return createBranchRepoRef(candidate);
    }

    if (await lookupCommitByRef(owner, repo, `tags/${candidate}`)) {
      return createTagRepoRef(candidate);
    }
  }

  const commitCandidate = segments[0];

  if (!commitCandidate) {
    throw new GitHubFsError({
      code: "ENOENT",
      isRetryable: false,
      kind: "not_found",
      message: `GitHub ref not found: ${tail}`,
      path: tail,
    });
  }

  const commit = await lookupCommitByRef(owner, repo, commitCandidate);

  if (commit) {
    return createCommitRepoRef(commit.sha);
  }

  throw new GitHubFsError({
    code: "ENOENT",
    isRetryable: false,
    kind: "not_found",
    message: `GitHub ref not found: ${tail}`,
    path: tail,
  });
}

export async function resolveGitHubRef(
  owner: string,
  repo: string,
  raw: string,
): Promise<ResolvedRepoRef> {
  const input = requireTrimmed(raw, "ref");

  if (input.startsWith("refs/heads/")) {
    const name = input.slice("refs/heads/".length);

    if (await lookupCommitByRef(owner, repo, `heads/${name}`)) {
      return createBranchRepoRef(name);
    }
  }

  if (input.startsWith("refs/tags/")) {
    const name = input.slice("refs/tags/".length);

    if (await lookupCommitByRef(owner, repo, `tags/${name}`)) {
      return createTagRepoRef(name);
    }
  }

  if (input.startsWith("heads/")) {
    const name = input.slice("heads/".length);

    if (await lookupCommitByRef(owner, repo, `heads/${name}`)) {
      return createBranchRepoRef(name);
    }
  }

  if (input.startsWith("tags/")) {
    const name = input.slice("tags/".length);

    if (await lookupCommitByRef(owner, repo, `tags/${name}`)) {
      return createTagRepoRef(name);
    }
  }

  if (FULL_COMMIT_SHA_PATTERN.test(input)) {
    const commit = await lookupCommitByRef(owner, repo, input);

    if (commit) {
      return createCommitRepoRef(commit.sha);
    }
  }

  if (await lookupCommitByRef(owner, repo, `heads/${input}`)) {
    return createBranchRepoRef(input);
  }

  if (await lookupCommitByRef(owner, repo, `tags/${input}`)) {
    return createTagRepoRef(input);
  }

  const commit = await lookupCommitByRef(owner, repo, input);

  if (commit) {
    return createCommitRepoRef(commit.sha);
  }

  throw new GitHubFsError({
    code: "ENOENT",
    isRetryable: false,
    kind: "not_found",
    message: `GitHub ref not found: ${input}`,
    path: input,
  });
}

export async function resolveRepoTarget(target: RepoTarget): Promise<ResolvedRepoSource> {
  const owner = requireTrimmed(target.owner, "owner");
  const repo = requireTrimmed(target.repo, "name");
  const token = trimToUndefined(target.token);
  const refPathTail = trimToUndefined(target.refPathTail);
  const rawRef = trimToUndefined(target.ref);
  const refOrigin = rawRef || refPathTail ? "explicit" : "default";
  const resolvedRef = refPathTail
    ? await resolveTreeOrBlobTail(owner, repo, refPathTail)
    : await resolveGitHubRef(owner, repo, rawRef ?? (await fetchDefaultBranch(owner, repo)));

  return {
    owner,
    ref: displayResolvedRepoRef(resolvedRef),
    refOrigin,
    repo,
    resolvedRef,
    token,
  };
}
