// Rebuilds the Sitegeist/web-ui Dexie contract with the same store split and local-only persistence model.
import Dexie, { type EntityTable, type Table } from "dexie"
import { getDateKey, getIsoNow } from "@/lib/dates"
import { applyMigrations } from "@/db/migrations"
import type {
  DailyCostAggregate,
  MessageRow,
  ProviderKeyRecord,
  RecentRepoRow,
  SessionData,
  SessionMetadata,
  SettingsRow,
} from "@/types/storage"
import type { JsonValue } from "@/types/common"
import type { ProviderId, Usage } from "@/types/models"

export class AppDb extends Dexie {
  dailyCosts!: EntityTable<DailyCostAggregate, "date">
  messages!: EntityTable<MessageRow, "id">
  providerKeys!: EntityTable<ProviderKeyRecord, "provider">
  recentRepos!: Table<RecentRepoRow, [string, string, string]>
  sessions!: EntityTable<SessionData, "id">
  settings!: EntityTable<SettingsRow, "key">

  constructor() {
    super("gitinspect")
    applyMigrations(this)
    this.dailyCosts = this.table("daily_costs")
    this.messages = this.table("messages")
    this.providerKeys = this.table("provider-keys")
    this.recentRepos = this.table("recent_repos")
    this.sessions = this.table("sessions")
    this.settings = this.table("settings")
  }
}

export const db = new AppDb()

export async function touchRecentRepo(
  source: Pick<RecentRepoRow, "owner" | "repo" | "ref">
): Promise<void> {
  const owner = source.owner.trim()
  const repo = source.repo.trim()
  const ref = source.ref.trim() || "main"

  if (!owner || !repo) {
    return
  }

  await db.recentRepos.put({
    lastOpenedAt: getIsoNow(),
    owner,
    ref,
    repo,
  })
}

export async function listRecentRepos(): Promise<RecentRepoRow[]> {
  return await db.recentRepos.orderBy("lastOpenedAt").reverse().toArray()
}

function toSessionMetadata(session: SessionData): SessionMetadata {
  return {
    cost: session.cost,
    createdAt: session.createdAt,
    id: session.id,
    isStreaming: session.isStreaming,
    lastModified: session.updatedAt,
    messageCount: session.messageCount,
    model: session.model,
    modelId: session.model,
    preview: session.preview,
    provider: session.provider,
    providerGroup: session.providerGroup,
    repoSource: session.repoSource,
    thinkingLevel: session.thinkingLevel,
    title: session.title,
    usage: session.usage,
  }
}

export async function putSession(session: SessionData): Promise<void> {
  await db.sessions.put(session)
}

export async function putMessage(message: MessageRow): Promise<void> {
  await db.messages.put(message)
}

export async function putMessages(messages: MessageRow[]): Promise<void> {
  if (messages.length === 0) {
    return
  }

  await db.messages.bulkPut(messages)
}

export async function putSessionAndMessages(
  session: SessionData,
  messages: MessageRow[]
): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.put(session)
    await putMessages(messages)
  })
}

export async function getSession(id: string): Promise<SessionData | undefined> {
  return await db.sessions.get(id)
}

export async function getSessionMessages(sessionId: string): Promise<MessageRow[]> {
  return await db.messages
    .where("[sessionId+timestamp]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .sortBy("timestamp")
}

export async function listSessionMetadata(): Promise<SessionMetadata[]> {
  return (await db.sessions.orderBy("updatedAt").reverse().toArray()).map(
    toSessionMetadata
  )
}

export async function getLatestSessionId(): Promise<string | undefined> {
  return (await db.sessions.orderBy("updatedAt").reverse().first())
    ?.id
}

export async function getMostRecentSession(): Promise<SessionData | undefined> {
  const latestId = await getLatestSessionId()

  if (!latestId) {
    return undefined
  }

  return await getSession(latestId)
}

export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const messageIds = await db.messages
    .where("sessionId")
    .equals(sessionId)
    .primaryKeys()

  await db.messages.bulkDelete(messageIds)
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.delete(id)
    await deleteMessagesBySession(id)
  })
}

export async function setSetting(
  key: string,
  value: JsonValue
): Promise<void> {
  await db.settings.put({
    key,
    updatedAt: getIsoNow(),
    value,
  })
}

export async function getSetting(key: string): Promise<JsonValue | undefined> {
  return (await db.settings.get(key))?.value
}

export async function getAllSettings(): Promise<SettingsRow[]> {
  return await db.settings.toArray()
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key)
}

export async function setProviderKey(
  provider: ProviderId,
  value: string
): Promise<void> {
  await db.providerKeys.put({
    provider,
    updatedAt: getIsoNow(),
    value,
  })
}

export async function getProviderKey(
  provider: ProviderId
): Promise<ProviderKeyRecord | undefined> {
  return await db.providerKeys.get(provider)
}

export async function listProviderKeys(): Promise<ProviderKeyRecord[]> {
  return await db.providerKeys.toArray()
}

export async function deleteProviderKey(provider: ProviderId): Promise<void> {
  await db.providerKeys.delete(provider)
}

export async function getDailyCost(
  date: string
): Promise<DailyCostAggregate | undefined> {
  return await db.dailyCosts.get(date)
}

export function mergeDailyCostAggregate(
  current: DailyCostAggregate | undefined,
  usage: Usage,
  provider: ProviderId,
  model: string,
  at: Date | number | string = Date.now()
): DailyCostAggregate {
  const date = getDateKey(at)
  const providerTotals = current?.byProvider[provider] ?? {}
  const nextByProvider = {
    ...(current?.byProvider ?? {}),
    [provider]: {
      ...providerTotals,
      [model]: (providerTotals[model] ?? 0) + usage.cost.total,
    },
  }

  return {
    byProvider: nextByProvider,
    date,
    total: (current?.total ?? 0) + usage.cost.total,
  }
}

export async function recordUsage(
  usage: Usage,
  provider: ProviderId,
  model: string,
  at = Date.now()
): Promise<void> {
  const date = getDateKey(at)
  const current = await db.dailyCosts.get(date)
  const next = mergeDailyCostAggregate(current, usage, provider, model, at)
  await db.dailyCosts.put(next)
}

export async function listDailyCosts(): Promise<DailyCostAggregate[]> {
  return await db.dailyCosts.orderBy("date").reverse().toArray()
}

export function getTotalCostFromAggregates(
  dailyCosts: DailyCostAggregate[]
): number {
  return dailyCosts.reduce((total, daily) => total + daily.total, 0)
}

export async function getTotalCost(): Promise<number> {
  return getTotalCostFromAggregates(await listDailyCosts())
}

export function getCostsByProviderFromAggregates(
  dailyCosts: DailyCostAggregate[]
): Partial<Record<ProviderId, number>> {
  const totals: Partial<Record<ProviderId, number>> = {}

  for (const daily of dailyCosts) {
    for (const [provider, models] of Object.entries(daily.byProvider) as Array<
      [ProviderId, Record<string, number> | undefined]
    >) {
      const sum = Object.values(models ?? {}).reduce(
        (subtotal, value) => subtotal + value,
        0
      )
      totals[provider] = (totals[provider] ?? 0) + sum
    }
  }

  return totals
}

export async function getCostsByProvider(): Promise<
  Partial<Record<ProviderId, number>>
> {
  return getCostsByProviderFromAggregates(await listDailyCosts())
}

export function getCostsByModelFromAggregates(
  dailyCosts: DailyCostAggregate[]
): Record<string, number> {
  const totals: Record<string, number> = {}

  for (const daily of dailyCosts) {
    for (const models of Object.values(daily.byProvider)) {
      for (const [model, value] of Object.entries(models ?? {})) {
        totals[model] = (totals[model] ?? 0) + value
      }
    }
  }

  return totals
}

export async function getCostsByModel(): Promise<Record<string, number>> {
  return getCostsByModelFromAggregates(await listDailyCosts())
}
