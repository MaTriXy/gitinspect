import type { RepoRuntime } from "@gitinspect/pi/repo/repo-types";
import { createBashTool } from "@gitinspect/pi/tools/bash";
import { createReadTool } from "@gitinspect/pi/tools/read";
import { toAgentTool, toProviderToolDefinition } from "@gitinspect/pi/tools/types";

export function createRepoTools(
  runtime: RepoRuntime,
  options?: {
    onRepoError?: (error: unknown) => void | Promise<void>;
  },
) {
  const read = createReadTool(runtime, options?.onRepoError);
  const bash = createBashTool(runtime, options?.onRepoError);
  const definitions = [read, bash];

  return {
    agentTools: [toAgentTool(read), toAgentTool(bash)],
    definitions,
    providerTools: [toProviderToolDefinition(read), toProviderToolDefinition(bash)],
  };
}
