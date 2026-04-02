import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "@sinclair/typebox";
import type { ImageContent, TextContent } from "@gitinspect/pi/types/chat";

export interface AppToolResult<TDetails = undefined> {
  content: Array<TextContent | ImageContent>;
  details: TDetails;
}

export interface AppToolDefinition<TParameters extends TSchema = TSchema, TDetails = undefined> {
  description: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partial: AppToolResult<TDetails>) => void,
  ) => Promise<AppToolResult<TDetails>>;
  label: string;
  name: string;
  parameters: TParameters;
}

export interface ProviderToolDefinition {
  description: string;
  name: string;
  parameters: TSchema;
}

export function toProviderToolDefinition<TParameters extends TSchema, TDetails = undefined>(
  tool: AppToolDefinition<TParameters, TDetails>,
): ProviderToolDefinition {
  return {
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
  };
}

export function toAgentTool<TParameters extends TSchema, TDetails = undefined>(
  tool: AppToolDefinition<TParameters, TDetails>,
): AgentTool<TSchema, TDetails> {
  return {
    description: tool.description,
    execute(toolCallId, params, signal, onUpdate) {
      return tool.execute(
        toolCallId,
        params as Static<TParameters>,
        signal,
        onUpdate as ((partial: AppToolResult<TDetails>) => void) | undefined,
      );
    },
    label: tool.label,
    name: tool.name,
    parameters: tool.parameters,
  };
}
