import type { AssistantMessage } from "@/types/chat"
import type { ProviderGroupId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

export type RuntimeCommandError = "busy" | "missing-session"

export interface RuntimeMutationResult {
  error?: RuntimeCommandError
  ok: boolean
}

export interface RuntimeSessionSnapshot {
  draftAssistantMessage?: AssistantMessage
  error?: string
  isStreaming: boolean
  lastEventAt: number
  sessionId: string
}

export interface RuntimeStateSnapshot {
  connectedClientIds: string[]
  runningSessionIds: string[]
  updatedAt: number
}

export interface RuntimeClientSink {
  onRuntimeState(snapshot: RuntimeStateSnapshot): void
  onSessionSnapshot(snapshot: RuntimeSessionSnapshot): void
}

export interface RuntimeWorkerApi {
  abort(sessionId: string): Promise<void>
  connectClient(clientId: string, sink: RuntimeClientSink): Promise<void>
  disconnectClient(clientId: string): Promise<void>
  getRuntimeState(): Promise<RuntimeStateSnapshot>
  getSessionSnapshot(
    sessionId: string
  ): Promise<RuntimeSessionSnapshot | undefined>
  hydrateSession(
    clientId: string,
    sessionId: string,
    persistedSession: SessionData
  ): Promise<void>
  observeSession(clientId: string, sessionId: string): Promise<void>
  send(sessionId: string, content: string): Promise<RuntimeMutationResult>
  setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult>
  setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult>
  unobserveSession(clientId: string, sessionId: string): Promise<void>
}

export function createIdleRuntimeSnapshot(
  sessionId: string
): RuntimeSessionSnapshot {
  return {
    isStreaming: false,
    lastEventAt: Date.now(),
    sessionId,
  }
}
