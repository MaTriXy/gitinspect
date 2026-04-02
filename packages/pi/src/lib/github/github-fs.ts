import type { IFileSystem } from "just-bash";
import { ContentCache, TreeCache } from "./cache.js";
import { GitHubClient } from "./github-client.js";
import {
  GitHubFsError,
  type TreeLoadWarning,
  type DirEntry,
  type GitHubContentResponse,
  type GitHubFsOptions,
} from "./types.js";

const DEFAULT_TREE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONTENT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_CONTENT_MAX_ENTRIES = 1000;
const MAX_SUPPORTED_FILE_BYTES = 1_000_000;

export class GitHubFs implements IFileSystem {
  private readonly client: GitHubClient;
  private readonly treeCache: TreeCache;
  private readonly contentCache: ContentCache;
  private readonly cachingEnabled: boolean;
  private readonly warningsInternal: TreeLoadWarning[] = [];
  private lastErrorInternal?: GitHubFsError;

  constructor(options: GitHubFsOptions) {
    this.client = new GitHubClient({
      owner: options.owner,
      repo: options.repo,
      ref: options.ref,
      token: options.token,
      baseUrl: options.baseUrl ?? "https://api.github.com",
    });

    this.cachingEnabled = options.cache?.enabled !== false;

    this.treeCache = new TreeCache({
      ttlMs: options.cache?.treeTtlMs ?? DEFAULT_TREE_TTL_MS,
    });

    this.contentCache = new ContentCache({
      maxBytes: options.cache?.contentMaxBytes ?? DEFAULT_CONTENT_MAX_BYTES,
      maxEntries: options.cache?.contentMaxEntries ?? DEFAULT_CONTENT_MAX_ENTRIES,
    });
  }

  async readFile(path: string): Promise<string> {
    const normalized = normalizePath(path);

    if (this.cachingEnabled && this.treeCache.loaded) {
      const entry = this.treeCache.get(normalized);
      if (entry && entry.type === "blob") {
        const cached = this.contentCache.get(entry.sha);
        if (typeof cached === "string") {
          return cached;
        }
      }
    }

    try {
      const response = await this.client.fetchContents(normalized);
      if (Array.isArray(response)) {
        throw this.rememberError(directoryError("EISDIR", path));
      }
      if (response.type !== "file" && response.type !== "symlink") {
        throw this.rememberError(directoryError("EISDIR", path));
      }

      this.assertSupportedFileSize(path, response.size);

      const content =
        response.content && response.encoding === "base64"
          ? decodeBase64(response.content)
          : await this.readBlobText(response.sha);

      if (this.cachingEnabled) {
        this.contentCache.set(response.sha, content);
      }
      return content;
    } catch (err) {
      if (err instanceof GitHubFsError) {
        throw this.rememberError(err);
      }

      throw this.rememberError(unknownReadError(path, err));
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path);

    if (this.cachingEnabled && this.treeCache.loaded) {
      const entry = this.treeCache.get(normalized);
      if (entry && entry.type === "blob") {
        const cached = this.contentCache.get(entry.sha);
        if (cached instanceof Uint8Array) {
          return cached;
        }
      }
    }

    try {
      const response = await this.client.fetchContents(normalized);
      if (Array.isArray(response)) {
        throw this.rememberError(directoryError("EISDIR", path));
      }
      if (response.type !== "file" && response.type !== "symlink") {
        throw this.rememberError(directoryError("EISDIR", path));
      }

      this.assertSupportedFileSize(path, response.size);

      const buffer =
        response.content && response.encoding === "base64"
          ? decodeBase64Buffer(response.content)
          : await this.readBlobBuffer(response.sha);

      if (this.cachingEnabled && this.treeCache.loaded) {
        const entry = this.treeCache.get(normalized);
        if (entry) {
          this.contentCache.set(entry.sha, buffer);
        }
      }
      return buffer;
    } catch (err) {
      if (err instanceof GitHubFsError) {
        throw this.rememberError(err);
      }

      throw this.rememberError(unknownReadError(path, err));
    }
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirInternal(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(
    path: string,
  ): Promise<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }[]> {
    const entries = await this.readdirInternal(path);
    return entries.map((e) => ({
      name: e.name,
      isFile: e.type === "file",
      isDirectory: e.type === "dir" || e.type === "submodule",
      isSymbolicLink: e.type === "symlink",
    }));
  }

  async stat(
    path: string,
  ): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
  }> {
    const info = await this.statInternal(path);
    return toFsStat(info.type, info.size, info.mode);
  }

  async lstat(
    path: string,
  ): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
  }> {
    return this.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err) {
      if (err instanceof GitHubFsError && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async realpath(path: string): Promise<string> {
    const normalized = normalizePath(path);
    return "/" + normalized;
  }

  async readlink(path: string): Promise<string> {
    const content = await this.readFile(path);
    return content.trim();
  }

  private async readdirInternal(path: string): Promise<DirEntry[]> {
    const normalized = normalizePath(path);

    if (this.cachingEnabled && this.treeCache.loaded) {
      if (normalized === "") {
        const entries = this.treeCache.listDir("");
        return entries.map((e) => ({
          name: e.path.split("/").pop()!,
          type: treeEntryType(e.type, e.mode),
          size: e.size ?? 0,
          sha: e.sha,
        }));
      }
      const treeEntry = this.treeCache.get(normalized);
      if (treeEntry?.type === "tree") {
        const entries = this.treeCache.listDir(normalized);
        return entries.map((e) => ({
          name: e.path.split("/").pop()!,
          type: treeEntryType(e.type, e.mode),
          size: e.size ?? 0,
          sha: e.sha,
        }));
      }
    }

    const response = await this.client.fetchContents(normalized).catch((error) => {
      if (error instanceof GitHubFsError) {
        throw this.rememberError(error);
      }

      throw error;
    });
    if (!Array.isArray(response)) {
      throw this.rememberError(directoryError("ENOTDIR", path));
    }

    return response.map((entry: GitHubContentResponse) => ({
      name: entry.name,
      type: entry.type as DirEntry["type"],
      size: entry.size,
      sha: entry.sha,
    }));
  }

  private async statInternal(
    path: string,
  ): Promise<{ type: string; size: number; sha: string; mode: string }> {
    const normalized = normalizePath(path);

    if (normalized === "") {
      return { type: "dir", size: 0, sha: "", mode: "040000" };
    }

    await this.loadTree();

    if (this.treeCache.loaded) {
      const entry = this.treeCache.get(normalized);
      if (entry) {
        return {
          type: treeEntryType(entry.type, entry.mode),
          size: entry.size ?? 0,
          sha: entry.sha,
          mode: entry.mode,
        };
      }
      throw this.rememberError(notFoundError(path));
    }

    const response = await this.client.fetchContents(normalized).catch((error) => {
      if (error instanceof GitHubFsError) {
        throw this.rememberError(error);
      }

      throw error;
    });
    if (Array.isArray(response)) {
      return { type: "dir", size: 0, sha: "", mode: "040000" };
    }
    return {
      type: response.type,
      size: response.size,
      sha: response.sha,
      mode: response.type === "file" ? "100644" : "040000",
    };
  }

  async tree(): Promise<string[]> {
    await this.loadTree();
    return this.treeCache.allPaths();
  }

  getAllPaths(): string[] {
    return this.treeCache.allPaths();
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) return path;
    const parts = base.split("/").filter(Boolean);
    for (const segment of path.split("/")) {
      if (segment === "..") parts.pop();
      else if (segment !== ".") parts.push(segment);
    }
    return "/" + parts.join("/");
  }

  async writeFile(): Promise<void> {
    throw readOnlyFsError();
  }

  async appendFile(): Promise<void> {
    throw readOnlyFsError();
  }

  async mkdir(): Promise<void> {
    throw readOnlyFsError();
  }

  async rm(): Promise<void> {
    throw readOnlyFsError();
  }

  async cp(): Promise<void> {
    throw readOnlyFsError();
  }

  async mv(): Promise<void> {
    throw readOnlyFsError();
  }

  async chmod(): Promise<void> {
    throw readOnlyFsError();
  }

  async symlink(): Promise<void> {
    throw readOnlyFsError();
  }

  async link(): Promise<void> {
    throw readOnlyFsError();
  }

  async utimes(): Promise<void> {}

  refresh(): void {
    this.treeCache.clear();
    this.contentCache.clear();
    this.warningsInternal.length = 0;
    this.lastErrorInternal = undefined;
  }

  get rateLimit() {
    return this.client.rateLimit;
  }

  get warnings(): TreeLoadWarning[] {
    return [...this.warningsInternal];
  }

  clearLastError(): void {
    this.lastErrorInternal = undefined;
  }

  consumeLastError(): GitHubFsError | undefined {
    const error = this.lastErrorInternal;
    this.lastErrorInternal = undefined;
    return error;
  }

  private async loadTree(): Promise<void> {
    if (this.treeCache.loaded) return;
    const response = await this.client.fetchTree().catch((error) => {
      if (error instanceof GitHubFsError) {
        throw this.rememberError(error);
      }

      throw error;
    });
    this.warningsInternal.length = 0;
    if (response.truncated) {
      this.warningsInternal.push({
        message:
          "GitHub returned a truncated repository tree. Some files may be unavailable to bash and directory traversal.",
        type: "truncated-tree",
      });
    }
    this.treeCache.load(response.sha, response.tree);
  }

  private rememberError<TError extends GitHubFsError>(error: TError): TError {
    this.lastErrorInternal = error;
    return error;
  }

  private assertSupportedFileSize(path: string, size: number): void {
    if (size <= MAX_SUPPORTED_FILE_BYTES) {
      return;
    }

    throw unsupportedFileError(path, size);
  }

  private async readBlobText(sha: string): Promise<string> {
    const blob = await this.client.fetchBlob(sha);

    return blob.encoding === "base64" ? decodeBase64(blob.content) : blob.content;
  }

  private async readBlobBuffer(sha: string): Promise<Uint8Array> {
    const blob = await this.client.fetchBlob(sha);

    return blob.encoding === "base64"
      ? decodeBase64Buffer(blob.content)
      : new TextEncoder().encode(blob.content);
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

function treeEntryType(type: string, mode: string): DirEntry["type"] {
  if (type === "commit") return "submodule";
  if (mode === "120000") return "symlink";
  if (type === "tree") return "dir";
  return "file";
}

function toFsStat(type: string, size: number, mode: string) {
  const modeNum = parseInt(mode, 8) || 0o100644;
  return {
    isFile: type === "file",
    isDirectory: type === "dir" || type === "submodule",
    isSymbolicLink: type === "symlink",
    mode: modeNum,
    size,
    mtime: new Date(0),
  };
}

function decodeBase64(encoded: string): string {
  const bytes = decodeBase64Buffer(encoded);
  return new TextDecoder().decode(bytes);
}

function decodeBase64Buffer(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/\n/g, "");
  return Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
}

function directoryError(code: "EISDIR" | "ENOTDIR", path: string): GitHubFsError {
  return new GitHubFsError({
    code,
    isRetryable: false,
    kind: "unsupported",
    message: code === "EISDIR" ? `Is a directory: ${path}` : `Not a directory: ${path}`,
    path,
  });
}

function notFoundError(path: string): GitHubFsError {
  return new GitHubFsError({
    code: "ENOENT",
    isRetryable: false,
    kind: "not_found",
    message: `No such file or directory: ${path}`,
    path,
  });
}

function readOnlyFsError(): GitHubFsError {
  return new GitHubFsError({
    code: "EROFS",
    isRetryable: false,
    kind: "unsupported",
    message: "Read-only filesystem",
  });
}

function unknownReadError(path: string, cause: unknown): GitHubFsError {
  return new GitHubFsError({
    cause,
    code: "EIO",
    isRetryable: true,
    kind: "unknown",
    message: `Failed to read file: ${path}`,
    path,
  });
}

function unsupportedFileError(path: string, size: number): GitHubFsError {
  return new GitHubFsError({
    code: "EFBIG",
    githubMessage: `File size: ${size} bytes`,
    isRetryable: false,
    kind: "unsupported",
    message: `File is too large for gitinspect v0 (${size} bytes): ${path}`,
    path,
  });
}
