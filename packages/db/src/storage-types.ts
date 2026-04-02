import type { JsonValue } from "@gitinspect/pi/types/common";
import type { ChatMessage } from "@gitinspect/pi/types/chat";
import type {
  ProviderGroupId,
  ProviderId,
  ThinkingLevel,
  Usage,
} from "@gitinspect/pi/types/models";

export type RepoRefOrigin = "default" | "explicit";

export type ResolvedRepoRef =
  | {
      apiRef: `heads/${string}`;
      fullRef: `refs/heads/${string}`;
      kind: "branch";
      name: string;
    }
  | {
      apiRef: `tags/${string}`;
      fullRef: `refs/tags/${string}`;
      kind: "tag";
      name: string;
    }
  | {
      kind: "commit";
      sha: string;
    };

// Raw repository input from URLs, route params, or text input.
export interface RepoTarget {
  owner: string;
  repo: string;
  ref?: string;
  refPathTail?: string;
  token?: string;
}

// Canonical repository state stored in Dexie and passed to runtime/UI.
export interface ResolvedRepoSource {
  owner: string;
  repo: string;
  ref: string;
  refOrigin: RepoRefOrigin;
  resolvedRef: ResolvedRepoRef;
  token?: string;
}

export interface RepositoryRow {
  lastOpenedAt: string;
  owner: string;
  ref: string;
  refOrigin: RepoRefOrigin;
  repo: string;
}

export interface SessionData {
  cost: number;
  createdAt: string;
  error?: string;
  id: string;
  isStreaming: boolean;
  messageCount: number;
  model: string;
  preview: string;
  provider: ProviderId;
  providerGroup?: ProviderGroupId;
  repoSource?: ResolvedRepoSource;
  thinkingLevel: ThinkingLevel;
  title: string;
  updatedAt: string;
  usage: Usage;
}

export type MessageStatus = "aborted" | "completed" | "error" | "streaming";

export type MessageRow = ChatMessage & {
  sessionId: string;
  status: MessageStatus;
};

export interface SessionLeaseRow {
  acquiredAt: string;
  heartbeatAt: string;
  ownerTabId: string;
  ownerToken: string;
  sessionId: string;
}

export type SessionRuntimeStatus =
  | "aborted"
  | "completed"
  | "error"
  | "idle"
  | "interrupted"
  | "streaming";

export interface SessionRuntimeRow {
  assistantMessageId?: string;
  lastError?: string;
  lastProgressAt?: string;
  ownerTabId?: string;
  sessionId: string;
  startedAt?: string;
  status: SessionRuntimeStatus;
  turnId?: string;
  updatedAt: string;
}

export interface SettingsRow {
  key: string;
  updatedAt: string;
  value: JsonValue;
}

export interface ProviderKeyRecord {
  provider: ProviderId;
  updatedAt: string;
  value: string;
}

export type DailyCostByProvider = Partial<Record<ProviderId, Record<string, number>>>;

export interface DailyCostAggregate {
  byProvider: DailyCostByProvider;
  date: string;
  total: number;
}
