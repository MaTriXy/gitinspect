// Rebuilds the Sitegeist/web-ui Dexie contract with the same store split and local-only persistence model.
import Dexie, { type EntityTable } from "dexie"
import { getDateKey, getIsoNow } from "@/lib/dates"
import { applyMigrations, getSessionsMetadataTable } from "@/db/migrations"
import type {
  DailyCostAggregate,
  ProviderKeyRecord,
  SessionData,
  SessionMetadata,
  SettingsRow,
} from "@/types/storage"
import type { JsonValue } from "@/types/common"
import type { ProviderId, Usage } from "@/types/models"

export class AppDb extends Dexie {
  dailyCosts!: EntityTable<DailyCostAggregate, "date">
  providerKeys!: EntityTable<ProviderKeyRecord, "provider">
  sessions!: EntityTable<SessionData, "id">
  settings!: EntityTable<SettingsRow, "key">

  constructor() {
    super("gitoverflow")
    applyMigrations(this)
    this.dailyCosts = this.table("daily_costs")
    this.providerKeys = this.table("provider-keys")
    this.sessions = this.table("sessions")
    this.settings = this.table("settings")
  }
}

export const db = new AppDb()

export function sessionsMetadataTable() {
  return getSessionsMetadataTable(db)
}

export async function saveSession(
  session: SessionData,
  metadata: SessionMetadata
): Promise<void> {
  await db.transaction(
    "rw",
    db.sessions,
    sessionsMetadataTable(),
    async () => {
      await db.sessions.put(session)
      await sessionsMetadataTable().put(metadata)
    }
  )
}

export async function getSession(id: string): Promise<SessionData | undefined> {
  return await db.sessions.get(id)
}

export async function getSessionMetadata(
  id: string
): Promise<SessionMetadata | undefined> {
  return await sessionsMetadataTable().get(id)
}

export async function listSessionMetadata(): Promise<SessionMetadata[]> {
  return await sessionsMetadataTable().orderBy("lastModified").reverse().toArray()
}

export async function getLatestSessionId(): Promise<string | undefined> {
  return (await sessionsMetadataTable().orderBy("lastModified").reverse().first())
    ?.id
}

export async function getMostRecentSession(): Promise<SessionData | undefined> {
  const latestId = await getLatestSessionId()

  if (!latestId) {
    return undefined
  }

  return await getSession(latestId)
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction(
    "rw",
    db.sessions,
    sessionsMetadataTable(),
    async () => {
      await db.sessions.delete(id)
      await sessionsMetadataTable().delete(id)
    }
  )
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
): Record<ProviderId, number> {
  const totals: Record<ProviderId, number> = {
    anthropic: 0,
    "github-copilot": 0,
    "google-gemini-cli": 0,
    opencode: 0,
    "openai-codex": 0,
  }

  for (const daily of dailyCosts) {
    for (const [provider, models] of Object.entries(daily.byProvider) as Array<
      [ProviderId, Record<string, number> | undefined]
    >) {
      totals[provider] += Object.values(models ?? {}).reduce(
        (subtotal, value) => subtotal + value,
        0
      )
    }
  }

  return totals
}

export async function getCostsByProvider(): Promise<Record<ProviderId, number>> {
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
