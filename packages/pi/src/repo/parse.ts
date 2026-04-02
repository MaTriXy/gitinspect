import type { RepoTarget } from "@gitinspect/db/storage-types";
import { parsedPathToRepoTarget, parseRepoPathname } from "@gitinspect/pi/repo/url";

export function parseRepoQuery(raw: string): RepoTarget | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const slash = trimmed.split("/").filter(Boolean);
  if (slash.length === 2 && !trimmed.includes(" ") && !trimmed.startsWith("http")) {
    const parsed = parseRepoPathname(`/${slash[0]}/${slash[1]}`);
    return parsed ? parsedPathToRepoTarget(parsed) : undefined;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!url.hostname.endsWith("github.com")) {
      return undefined;
    }

    const parsed = parseRepoPathname(url.pathname);
    return parsed ? parsedPathToRepoTarget(parsed) : undefined;
  } catch {
    return undefined;
  }
}
