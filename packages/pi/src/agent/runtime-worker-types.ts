import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeErrorPayload } from "@gitinspect/pi/agent/runtime-error-payload";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import type { MessageRow, SessionData } from "@gitinspect/db/storage-types";
import type { TurnEnvelope } from "@gitinspect/pi/agent/agent-turn-persistence";

export type WorkerSnapshot = {
  error: string | undefined;
  isStreaming: boolean;
  messages: AgentMessage[];
  streamMessage: AgentMessage | null;
};

export type WorkerSnapshotEnvelope = {
  rotateStreamingAssistantDraft?: boolean;
  runtimeErrors?: RuntimeErrorPayload[];
  sessionId: string;
  snapshot: WorkerSnapshot;
  terminalStatus?: "aborted" | "error";
};

export interface RuntimeWorkerEvents {
  pushSnapshot(envelope: WorkerSnapshotEnvelope): Promise<void>;
}

export type StartTurnInput = {
  githubRuntimeToken?: string;
  messages: MessageRow[];
  session: SessionData;
  turn: TurnEnvelope;
};

export type ConfigureSessionInput = {
  modelId: string;
  providerGroup: ProviderGroupId;
  sessionId: string;
};

export type SetThinkingLevelInput = {
  sessionId: string;
  thinkingLevel: ThinkingLevel;
};

export type RefreshGithubTokenInput = {
  sessionId: string;
  token?: string;
};
