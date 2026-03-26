import type { Table } from "dexie"
import type Dexie from "dexie"
import { createEmptyUsage } from "@/types/models"
import type {
  DailyCostAggregate,
  MessageRow,
  ProviderKeyRecord,
  RecentRepoRow,
  SessionData,
  SessionMetadata,
  SettingsRow,
} from "@/types/storage"
import type { ChatMessage } from "@/types/chat"
import { buildPreview, generateTitle } from "@/sessions/session-metadata"

export type AppDbTables = {
  dailyCosts: Table<DailyCostAggregate, string>
  messages: Table<MessageRow, string>
  providerKeys: Table<ProviderKeyRecord, string>
  recentRepos: Table<RecentRepoRow, [string, string, string]>
  sessions: Table<SessionData, string>
  settings: Table<SettingsRow, string>
}

type LegacySessionData = Omit<SessionData, "error" | "isStreaming" | "messageCount"> & {
  messages?: ChatMessage[]
}

function aggregateSessionUsage(messages: ChatMessage[]) {
  return messages.reduce((usage, message) => {
    if (message.role !== "assistant") {
      return usage
    }

    return {
      cacheRead: usage.cacheRead + message.usage.cacheRead,
      cacheWrite: usage.cacheWrite + message.usage.cacheWrite,
      cost: {
        cacheRead: usage.cost.cacheRead + message.usage.cost.cacheRead,
        cacheWrite: usage.cost.cacheWrite + message.usage.cost.cacheWrite,
        input: usage.cost.input + message.usage.cost.input,
        output: usage.cost.output + message.usage.cost.output,
        total: usage.cost.total + message.usage.cost.total,
      },
      input: usage.input + message.usage.input,
      output: usage.output + message.usage.output,
      totalTokens: usage.totalTokens + message.usage.totalTokens,
    }
  }, createEmptyUsage())
}

function inferMessageStatus(message: ChatMessage): MessageRow["status"] {
  if (message.role === "system") {
    return "completed"
  }

  if (message.role !== "assistant") {
    return "completed"
  }

  switch (message.stopReason) {
    case "aborted":
      return "aborted"
    case "error":
      return "error"
    default:
      return "completed"
  }
}

export function applyMigrations(db: Dexie): void {
  db.version(1).stores({
    daily_costs: "date",
    "provider-keys": "provider, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model",
    "sessions-metadata": "id, lastModified, provider, model",
    settings: "key, updatedAt",
  })

  db
    .version(2)
    .stores({
      daily_costs: "date",
      messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      "sessions-metadata": "id, lastModified, provider, model",
      settings: "key, updatedAt",
    })
    .upgrade(async (tx) => {
      const sessionsTable = tx.table<LegacySessionData, string>("sessions")
      const messagesTable = tx.table<MessageRow, string>("messages")
      const legacySessions = await sessionsTable.toArray()

      for (const legacySession of legacySessions) {
        const messages = legacySession.messages ?? []
        const usage = aggregateSessionUsage(messages)

        const nextSession: SessionData = {
          cost: usage.cost.total,
          createdAt: legacySession.createdAt,
          error: undefined,
          id: legacySession.id,
          isStreaming: false,
          messageCount: messages.length,
          model: legacySession.model,
          preview: buildPreview(messages),
          provider: legacySession.provider,
          providerGroup: legacySession.providerGroup,
          repoSource: legacySession.repoSource,
          thinkingLevel: legacySession.thinkingLevel,
          title: generateTitle(messages),
          updatedAt: legacySession.updatedAt,
          usage,
        }

        await sessionsTable.put(nextSession as LegacySessionData)

        if (messages.length > 0) {
          await messagesTable.bulkPut(
            messages.map((message) => ({
              ...message,
              sessionId: legacySession.id,
              status: inferMessageStatus(message),
            }))
          )
        }
      }
    })

  db
    .version(3)
    .stores({
      daily_costs: "date",
      messages:
        "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      recent_repos: "[owner+repo+ref], lastOpenedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      "sessions-metadata": "id, lastModified, provider, model",
      settings: "key, updatedAt",
    })
    .upgrade(async (tx) => {
      const settingsTable = tx.table<SettingsRow, string>("settings")
      for (const key of [
        "repo.owner",
        "repo.name",
        "repo.ref",
        "repo.token",
        "active-session-id",
      ]) {
        await settingsTable.delete(key)
      }
    })
}

export function getSessionsMetadataTable(
  db: Dexie
): Table<SessionMetadata, string> {
  return db.table<SessionMetadata, string>("sessions-metadata")
}
