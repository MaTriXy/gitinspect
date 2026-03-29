import type { SessionData } from "@/types/storage"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"

// Turn methods resolve after prompt-start persistence, not after stream completion.
export interface SessionWorkerApi {
  abort: () => Promise<void>
  dispose: () => Promise<void>
  initFromSession: (session: SessionData) => Promise<void>
  initFromStorage: (sessionId: string) => Promise<boolean>
  refreshGithubToken: () => Promise<void>
  startTurn: (content: string) => Promise<void>
  setModelSelection: (
    providerGroup: ProviderGroupId,
    modelId: string
  ) => Promise<void>
  setThinkingLevel: (thinkingLevel: ThinkingLevel) => Promise<void>
}
