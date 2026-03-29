import {
  GitHubFsError,
  type GitHubBlobResponse,
  type GitHubContentResponse,
  type GitHubTreeResponse,
} from "./types.js";
import {
  GitHubRateLimitController,
  parseGitHubRateLimitInfo,
} from "./github-rate-limit.js";

export interface GitHubClientOptions {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
  baseUrl: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

interface GitHubCommitResponse {
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

interface GitHubResolvedCommitRef extends GitHubRefResponse {
  _commit: GitHubCommitResponse;
}

export class GitHubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
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
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${normalized}?ref=${encodeURIComponent(this.ref)}`;
    return this.request<GitHubContentResponse | GitHubContentResponse[]>(url, path);
  }

  async fetchRaw(path: string): Promise<string> {
    this.throwIfRateLimited(path);

    const normalized = normalizePath(path);
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.ref}/${normalized}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });
    const rateLimitBlock = await this.observeRateLimit(res);
    if (rateLimitBlock) {
      throw this.createRateLimitError(path, rateLimitBlock.blockedUntilMs);
    }
    if (!res.ok) {
      throw this.httpError(res, path);
    }
    return res.text();
  }

  async fetchRawBuffer(path: string): Promise<Uint8Array> {
    this.throwIfRateLimited(path);

    const normalized = normalizePath(path);
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.ref}/${normalized}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });
    const rateLimitBlock = await this.observeRateLimit(res);
    if (rateLimitBlock) {
      throw this.createRateLimitError(path, rateLimitBlock.blockedUntilMs);
    }
    if (!res.ok) {
      throw this.httpError(res, path);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async fetchTree(): Promise<GitHubTreeResponse> {
    // First, resolve the ref to a commit SHA, then get its tree
    const encodedRef = this.ref.split("/").map(encodeURIComponent).join("/");
    const refData = await this.request<GitHubRefResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/heads/${encodedRef}`,
      this.ref,
    ).catch(async (): Promise<GitHubRefResponse> => {
      // Try as a tag
      return this.request<GitHubRefResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/tags/${encodedRef}`,
        this.ref,
      );
    }).catch(async (): Promise<GitHubResolvedCommitRef> => {
      // Try as a direct commit SHA — get the commit directly
      const commit = await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${encodeURIComponent(this.ref)}`,
        this.ref,
      );
      return { object: { sha: this.ref, type: "commit" }, _commit: commit };
    });

    let treeSha: string;
    if ("_commit" in refData) {
      treeSha = refData._commit.tree.sha;
    } else if (refData.object.type === "commit") {
      const commit = await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${refData.object.sha}`,
        this.ref,
      );
      treeSha = commit.tree.sha;
    } else {
      // Tag pointing to a commit
      const tag = await this.request<{ object: { sha: string } }>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/tags/${refData.object.sha}`,
        this.ref,
      );
      const commit = await this.request<{ tree: { sha: string } }>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${tag.object.sha}`,
        this.ref,
      );
      treeSha = commit.tree.sha;
    }

    return this.request<GitHubTreeResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
      "/",
    );
  }

  async fetchBlob(sha: string): Promise<GitHubBlobResponse> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/blobs/${sha}`;
    return this.request<GitHubBlobResponse>(url, sha);
  }

  private async request<T>(url: string, pathForError: string): Promise<T> {
    this.throwIfRateLimited(pathForError);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });
    const rateLimitBlock = await this.observeRateLimit(res);
    if (rateLimitBlock) {
      throw this.createRateLimitError(pathForError, rateLimitBlock.blockedUntilMs);
    }

    if (!res.ok) {
      throw this.httpError(res, pathForError);
    }

    return res.json() as Promise<T>;
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

  private createRateLimitError(
    path: string,
    blockedUntilMs: number,
  ): GitHubFsError {
    const retryAt = new Date(blockedUntilMs).toLocaleTimeString();
    return new GitHubFsError(
      "EACCES",
      `GitHub API rate limit exceeded (retry after ${retryAt}): ${path}`,
      path,
    );
  }

  private httpError(res: Response, path: string): GitHubFsError {
    switch (res.status) {
      case 404:
        return new GitHubFsError("ENOENT", `No such file or directory: ${path}`, path);
      case 403:
        return new GitHubFsError("EACCES", `Permission denied: ${path}`, path);
      case 401:
        return new GitHubFsError("EACCES", `Authentication required: ${path}`, path);
      default:
        return new GitHubFsError("EIO", `GitHub API error (${res.status}): ${path}`, path);
    }
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}
