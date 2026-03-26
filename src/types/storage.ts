import type { JsonValue } from "@/types/common"
import type { ChatMessage } from "@/types/chat"
import type {
  ProviderGroupId,
  ProviderId,
  ThinkingLevel,
  Usage,
} from "@/types/models"

export interface RepoSource {
  owner: string
  ref: string
  repo: string
  token?: string
}

/** Minimal recency index for repos (identity + lastOpenedAt only). */
export interface RecentRepoRow {
  lastOpenedAt: string
  owner: string
  ref: string
  repo: string
}

export interface SessionData {
  cost: number
  createdAt: string
  error?: string
  id: string
  isStreaming: boolean
  messageCount: number
  model: string
  preview: string
  provider: ProviderId
  providerGroup?: ProviderGroupId
  repoSource?: RepoSource
  thinkingLevel: ThinkingLevel
  title: string
  updatedAt: string
  usage: Usage
}

export interface SessionMetadata {
  cost: number
  createdAt: string
  id: string
  isStreaming: boolean
  lastModified: string
  messageCount: number
  model: string
  modelId: string
  preview: string
  provider: ProviderId
  providerGroup?: ProviderGroupId
  repoSource?: RepoSource
  thinkingLevel: ThinkingLevel
  title: string
  usage: Usage
}

export type MessageStatus = "aborted" | "completed" | "error" | "streaming"

export type MessageRow = ChatMessage & {
  sessionId: string
  status: MessageStatus
}

export interface SettingsRow {
  key: string
  updatedAt: string
  value: JsonValue
}

export interface ProviderKeyRecord {
  provider: ProviderId
  updatedAt: string
  value: string
}

export type DailyCostByProvider = Partial<Record<ProviderId, Record<string, number>>>

export interface DailyCostAggregate {
  byProvider: DailyCostByProvider
  date: string
  total: number
}
