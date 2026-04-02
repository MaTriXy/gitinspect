import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";

export interface SessionRunner {
  abort(): void | Promise<void>;
  dispose(): void | Promise<void>;
  isBusy(): boolean;
  refreshGithubToken(): Promise<void>;
  setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void>;
  setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void>;
  startTurn(content: string): Promise<void>;
  waitForTurn(): Promise<void>;
}
