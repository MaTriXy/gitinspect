import {
  GitHubFsError,
  type GitHubBlobResponse,
  type GitHubContentResponse,
  type GitHubTreeResponse,
} from "./types.js";
import { displayResolvedRef, toCommitApiRef, type GitHubResolvedRef } from "./refs.js";
import { GitHubRateLimitController, parseGitHubRateLimitInfo } from "./github-rate-limit.js";
import {
  readGitHubErrorMessage,
  shouldRetryUnauthenticated,
  stripAuthorization,
  toGitHubFsError,
} from "./github-http.js";

export interface GitHubClientOptions {
  owner: string;
  repo: string;
  ref: GitHubResolvedRef;
  token?: string;
  baseUrl: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

interface GitHubCommitResponse {
  sha: string;
  tree: {
    sha: string;
  };
}

interface GitHubRefResponse {
  object: {
    sha: string;
    type: string;
  };
}

interface GitHubAnnotatedTagResponse {
  object: {
    sha: string;
    type: string;
  };
}

export class GitHubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: GitHubResolvedRef;
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly rateLimitController = new GitHubRateLimitController();
  rateLimit: RateLimitInfo | null = null;

  constructor(options: GitHubClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.ref = options.ref;
    this.token = options.token;
    this.baseUrl = options.baseUrl;
  }

  async fetchContents(path: string): Promise<GitHubContentResponse | GitHubContentResponse[]> {
    const normalized = normalizePath(path);
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${normalized}?ref=${encodeURIComponent(toCommitApiRef(this.ref))}`;
    return this.request<GitHubContentResponse | GitHubContentResponse[]>(url, path);
  }

  async fetchTree(): Promise<GitHubTreeResponse> {
    const commit = await this.fetchResolvedCommit();

    return this.request<GitHubTreeResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees/${commit.tree.sha}?recursive=1`,
      "/",
    );
  }

  async fetchBlob(sha: string): Promise<GitHubBlobResponse> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/blobs/${sha}`;
    return this.request<GitHubBlobResponse>(url, sha);
  }

  private async fetchResolvedCommit(): Promise<GitHubCommitResponse> {
    try {
      return await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(toCommitApiRef(this.ref))}`,
        displayResolvedRef(this.ref),
      );
    } catch (error) {
      if (
        this.ref.kind === "tag" &&
        error instanceof GitHubFsError &&
        (error.kind === "conflict" || error.kind === "not_found" || error.kind === "validation")
      ) {
        await this.throwUnsupportedTagTarget();
      }

      throw error;
    }
  }

  private async request<T>(url: string, pathForError: string): Promise<T> {
    const res = await this.fetchWithOptionalAnonymousFallback(
      url,
      {
        Accept: "application/vnd.github.v3+json",
        ...this.buildHeaders(),
      },
      pathForError,
    );

    if (!res.ok) {
      throw await this.httpError(res, pathForError);
    }

    return res.json() as Promise<T>;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async fetchWithOptionalAnonymousFallback(
    url: string,
    headers: Record<string, string>,
    pathForError: string,
  ): Promise<Response> {
    this.throwIfRateLimited(pathForError);

    let response: Response;

    try {
      response = await fetch(url, { headers });
    } catch (error) {
      throw new GitHubFsError({
        cause: error,
        code: "EIO",
        isRetryable: true,
        kind: "network",
        message: `GitHub network error: ${pathForError}`,
        path: pathForError,
      });
    }

    const rateLimitBlock = await this.observeRateLimit(response);
    if (rateLimitBlock) {
      throw this.createRateLimitError(pathForError, rateLimitBlock.blockedUntilMs);
    }

    if (response.ok || !this.token) {
      return response;
    }

    const detail = await readGitHubErrorMessage(response);
    if (!shouldRetryUnauthenticated(response, detail)) {
      return response;
    }

    const fallbackResponse = await fetch(url, {
      headers: stripAuthorization(headers),
    });
    const fallbackRateLimitBlock = await this.observeRateLimit(fallbackResponse);

    if (fallbackRateLimitBlock) {
      return response;
    }

    return fallbackResponse.ok ? fallbackResponse : response;
  }

  private async observeRateLimit(res: Response) {
    const info = parseGitHubRateLimitInfo(res);
    if (info) {
      this.rateLimit = info;
    }

    return await this.rateLimitController.afterResponse(res);
  }

  private throwIfRateLimited(path: string): void {
    const rateLimitBlock = this.rateLimitController.beforeRequest();
    if (!rateLimitBlock) {
      return;
    }

    throw this.createRateLimitError(path, rateLimitBlock.blockedUntilMs);
  }

  private createRateLimitError(path: string, blockedUntilMs: number): GitHubFsError {
    return new GitHubFsError({
      code: "EACCES",
      isRetryable: true,
      kind: "rate_limit",
      message: `GitHub API rate limit exceeded (retry after ${new Date(blockedUntilMs).toLocaleTimeString()}): ${path}`,
      path,
      rateLimitKind: "unknown",
      retryAt: blockedUntilMs,
      status: 429,
    });
  }

  private async httpError(res: Response, path: string): Promise<GitHubFsError> {
    return toGitHubFsError(res, path, await readGitHubErrorMessage(res));
  }

  private async throwUnsupportedTagTarget(): Promise<never> {
    const refName = this.ref.kind === "tag" ? this.ref.name : displayResolvedRef(this.ref);
    const refData = await this.request<GitHubRefResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/tags/${encodeURIComponent(refName)}`,
      refName,
    );

    const target =
      refData.object.type === "tag"
        ? await this.request<GitHubAnnotatedTagResponse>(
            `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/tags/${refData.object.sha}`,
            refName,
          )
        : refData;

    if (target.object.type !== "commit") {
      throw new GitHubFsError({
        code: "ENOTSUP",
        isRetryable: false,
        kind: "unsupported",
        message: "gitinspect v0 does not support annotated tags that target trees or blobs.",
        path: refName,
      });
    }

    throw new GitHubFsError({
      code: "EIO",
      isRetryable: false,
      kind: "unknown",
      message: `GitHub API error while resolving tag: ${refName}`,
      path: refName,
    });
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed || trimmed === "/" || trimmed === ".") {
    return "";
  }

  const normalizedSegments: string[] = [];

  for (const segment of trimmed.split("/")) {
    const next = segment.trim();

    if (!next || next === ".") {
      continue;
    }

    if (next === "..") {
      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(next);
  }

  return normalizedSegments.join("/");
}
