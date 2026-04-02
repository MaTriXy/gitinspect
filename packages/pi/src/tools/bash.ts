import { Type, type Static } from "@sinclair/typebox";
import { GitHubFsError } from "@gitinspect/pi/lib/github/types";
import { execInRepoShell } from "@gitinspect/pi/repo/repo-runtime";
import type { RepoRuntime } from "@gitinspect/pi/repo/repo-types";
import { warningMessageToError } from "@gitinspect/pi/tools/repo-warnings";
import { truncateTail, type TruncationResult } from "@gitinspect/pi/tools/truncate";
import type { AppToolDefinition } from "@gitinspect/pi/tools/types";

const bashSchema = Type.Object({
  command: Type.String({
    description: "Shell command (read-only virtual shell on the repo snapshot; not host OS)",
  }),
});

export type BashToolParams = Static<typeof bashSchema>;

export interface BashToolDetails {
  command: string;
  cwd: string;
  exitCode: number;
  truncation?: TruncationResult;
  warnings?: string[];
}

function takeActionableGithubError(runtime: RepoRuntime): GitHubFsError | undefined {
  const error = runtime.fs.consumeLastError();
  return error ?? undefined;
}

export function createBashTool(
  runtime: RepoRuntime,
  onRepoError?: (error: unknown) => void | Promise<void>,
): AppToolDefinition<typeof bashSchema, BashToolDetails> {
  return {
    description:
      "Run a command in the repo's read-only virtual shell (browser snapshot). " +
      "Banned: writes, installs, network, git, node/npm/python/sqlite/curl. " +
      "OK: pipes + grep/sed/awk/cat/head/tail/ls/find.",
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error("Command aborted");
      }

      runtime.fs.clearLastError();

      let result: Awaited<ReturnType<typeof execInRepoShell>>;

      try {
        result = await execInRepoShell(runtime, params.command, signal);
      } catch (error) {
        const githubError = takeActionableGithubError(runtime);
        const nextError = githubError ?? error;

        if (onRepoError) {
          await onRepoError(nextError);
        }

        throw nextError;
      }

      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const truncation = truncateTail(combined || "(no output)");
      let output = truncation.content || "(no output)";

      if (truncation.truncated) {
        output += "\n\n[Output truncated. Showing the tail of the command output.]";
      }

      if (result.exitCode !== 0) {
        output += `\n\nCommand exited with code ${result.exitCode}`;
        const githubError = takeActionableGithubError(runtime);
        const err = githubError ?? new Error(output);
        if (onRepoError) {
          await onRepoError(err);
        }

        throw err;
      }

      const warnings = runtime.getWarnings();
      if (onRepoError) {
        for (const warning of warnings) {
          await onRepoError(warningMessageToError(warning));
        }
      }

      return {
        content: [{ text: output, type: "text" }],
        details: {
          command: params.command,
          cwd: result.cwd,
          exitCode: result.exitCode,
          truncation: truncation.truncated ? truncation : undefined,
          warnings,
        },
      };
    },
    label: "Bash",
    name: "bash",
    parameters: bashSchema,
  };
}
