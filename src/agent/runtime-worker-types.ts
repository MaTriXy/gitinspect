import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { MessageRow, SessionData } from "@/types/storage"
import type { TurnEnvelope } from "@/agent/agent-turn-persistence"

export type WorkerSnapshot = {
  error: string | undefined
  isStreaming: boolean
  messages: AgentMessage[]
  streamMessage: AgentMessage | null
}

export type WorkerSnapshotEnvelope = {
  rotateStreamingAssistantDraft?: boolean
  runtimeErrors?: string[]
  sessionId: string
  snapshot: WorkerSnapshot
  terminalStatus?: "aborted" | "error"
}

export interface RuntimeWorkerEvents {
  pushSnapshot(envelope: WorkerSnapshotEnvelope): Promise<void>
}

export type StartTurnInput = {
  githubRuntimeToken?: string
  messages: MessageRow[]
  session: SessionData
  turn: TurnEnvelope
}

export type ConfigureSessionInput = {
  modelId: string
  providerGroup: ProviderGroupId
  sessionId: string
}

export type SetThinkingLevelInput = {
  sessionId: string
  thinkingLevel: ThinkingLevel
}

export type RefreshGithubTokenInput = {
  sessionId: string
  token?: string
}
