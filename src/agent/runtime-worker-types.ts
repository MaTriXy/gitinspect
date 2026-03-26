import type { ProviderGroupId, ThinkingLevel } from "@/types/models"

export interface SessionWorkerApi {
  abort: () => Promise<void>
  dispose: () => Promise<void>
  init: (sessionId: string) => Promise<boolean>
  refreshGithubToken: () => Promise<void>
  send: (content: string) => Promise<void>
  setModelSelection: (
    providerGroup: ProviderGroupId,
    modelId: string
  ) => Promise<void>
  setThinkingLevel: (thinkingLevel: ThinkingLevel) => Promise<void>
}
