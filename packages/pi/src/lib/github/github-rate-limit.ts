import { readGitHubErrorMessage } from "./github-http.js";

export type GitHubRateLimitKind = "primary" | "secondary" | "unknown";

export interface GitHubRateLimitBlock {
  blockedUntilMs: number;
  kind: GitHubRateLimitKind;
}

export interface ParsedGitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

const SECONDARY_RATE_LIMIT_FLOOR_MS = 60 * 1000;
const SECONDARY_RATE_LIMIT_MAX_MS = 15 * 60 * 1000;

export class GitHubRateLimitController {
  private blockedUntilMs = 0;
  private secondaryBackoffMs = SECONDARY_RATE_LIMIT_FLOOR_MS;

  beforeRequest(now = Date.now()): GitHubRateLimitBlock | undefined {
    if (this.blockedUntilMs !== 0 && this.blockedUntilMs <= now) {
      this.blockedUntilMs = 0;
    }

    if (this.blockedUntilMs <= now) {
      return undefined;
    }

    return {
      blockedUntilMs: this.blockedUntilMs,
      kind: "unknown",
    };
  }

  async afterResponse(res: Response, now = Date.now()): Promise<GitHubRateLimitBlock | undefined> {
    const info = parseGitHubRateLimitInfo(res);
    const retryAfterSeconds = parsePositiveInt(res.headers.get("retry-after"));
    const retryAfterMs =
      retryAfterSeconds !== undefined ? now + retryAfterSeconds * 1000 : undefined;

    if (info?.remaining === 0) {
      this.blockedUntilMs = Math.max(this.blockedUntilMs, info.reset.getTime());
      this.secondaryBackoffMs = SECONDARY_RATE_LIMIT_FLOOR_MS;
    } else if (res.ok && info && info.remaining > 0 && this.blockedUntilMs <= now) {
      this.blockedUntilMs = 0;
      this.secondaryBackoffMs = SECONDARY_RATE_LIMIT_FLOOR_MS;
    }

    if (retryAfterMs !== undefined) {
      this.blockedUntilMs = Math.max(this.blockedUntilMs, retryAfterMs);
    }

    if (res.status !== 403 && res.status !== 429) {
      return undefined;
    }

    const detail = await readGitHubErrorMessage(res);
    if (!isRateLimitedResponse(res, detail, info, retryAfterSeconds)) {
      return undefined;
    }

    const lower = detail?.toLowerCase();
    const kind: GitHubRateLimitKind =
      info?.remaining === 0
        ? "primary"
        : lower?.includes("secondary rate limit") || retryAfterSeconds !== undefined
          ? "secondary"
          : "unknown";

    const blockedUntilMs =
      retryAfterMs ?? (info?.remaining === 0 ? info.reset.getTime() : undefined);

    return this.recordRateLimitBlock(kind, blockedUntilMs, now);
  }

  private recordRateLimitBlock(
    kind: GitHubRateLimitKind,
    retryAtMs: number | undefined,
    now: number,
  ): GitHubRateLimitBlock {
    let nextBlockedUntilMs = retryAtMs;

    if (!nextBlockedUntilMs || nextBlockedUntilMs <= now) {
      nextBlockedUntilMs = now + this.secondaryBackoffMs;
    }

    this.blockedUntilMs = Math.max(this.blockedUntilMs, nextBlockedUntilMs);

    if (kind === "secondary" || kind === "unknown") {
      this.secondaryBackoffMs = Math.min(this.secondaryBackoffMs * 2, SECONDARY_RATE_LIMIT_MAX_MS);
    } else {
      this.secondaryBackoffMs = SECONDARY_RATE_LIMIT_FLOOR_MS;
    }

    return {
      blockedUntilMs: this.blockedUntilMs,
      kind,
    };
  }
}

export function parseGitHubRateLimitInfo(res: Response): ParsedGitHubRateLimitInfo | null {
  const limit = parsePositiveInt(res.headers.get("x-ratelimit-limit"));
  const remaining = parsePositiveInt(res.headers.get("x-ratelimit-remaining"));
  const resetAtSeconds = parsePositiveInt(res.headers.get("x-ratelimit-reset"));

  if (limit === undefined || remaining === undefined || resetAtSeconds === undefined) {
    return null;
  }

  return {
    limit,
    remaining,
    reset: new Date(resetAtSeconds * 1000),
  };
}

function isRateLimitedResponse(
  res: Response,
  detail: string | undefined,
  info: ParsedGitHubRateLimitInfo | null,
  retryAfterSeconds: number | undefined,
): boolean {
  if (res.status === 429) {
    return true;
  }

  if (res.status !== 403) {
    return false;
  }

  if (retryAfterSeconds !== undefined) {
    return true;
  }

  if (info?.remaining === 0) {
    return true;
  }

  return detail?.toLowerCase().includes("rate limit") === true;
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
