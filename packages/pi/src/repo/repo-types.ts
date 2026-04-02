import type { Bash, BashExecResult } from "just-bash/browser";
import type { GitHubFs } from "@gitinspect/pi/lib/github/github-fs";
import type { ResolvedRepoSource } from "@gitinspect/db/storage-types";

export interface RepoRuntime {
  bash: Bash;
  fs: GitHubFs;
  getCwd(): string;
  getWarnings(): string[];
  refresh(): void;
  setCwd(next: string): void;
  source: ResolvedRepoSource;
}

export interface RepoExecResult extends BashExecResult {
  cwd: string;
}
