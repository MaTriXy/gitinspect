// Rebuilds the Sitegeist/web-ui Dexie contract with the same store split and local-only persistence model.
import Dexie, { type EntityTable, type Table } from "dexie";
import { getDateKey, getIsoNow } from "@gitinspect/pi/lib/dates";
import {
  createBranchRepoRef,
  createCommitRepoRef,
  createTagRepoRef,
  displayResolvedRepoRef,
} from "@gitinspect/pi/repo/refs";
import type {
  DailyCostAggregate,
  MessageRow,
  ProviderKeyRecord,
  RepoRefOrigin,
  ResolvedRepoRef,
  ResolvedRepoSource,
  RepositoryRow,
  SessionData,
  SessionLeaseRow,
  SessionRuntimeRow,
  SettingsRow,
} from "@gitinspect/db/storage-types";
import type { JsonValue } from "@gitinspect/pi/types/common";
import type { ProviderId, Usage } from "@gitinspect/pi/types/models";

const DB_NAME = "gitinspect-store";
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

type LegacyRepositoryRow = Omit<RepositoryRow, "refOrigin"> & {
  refOrigin?: RepoRefOrigin;
};

type LegacySessionRepoSource = {
  owner?: string;
  ref?: string;
  refOrigin?: RepoRefOrigin;
  repo?: string;
  resolvedRef?: ResolvedRepoRef;
  token?: string;
};

type LegacySessionData = Omit<SessionData, "repoSource"> & {
  repoSource?: LegacySessionRepoSource;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeResolvedRepoRef(ref: ResolvedRepoRef | undefined): ResolvedRepoRef | undefined {
  if (!ref) {
    return undefined;
  }

  if (ref.kind === "commit") {
    const sha = trimToUndefined(ref.sha);
    return sha ? createCommitRepoRef(sha) : undefined;
  }

  const name = trimToUndefined(ref.name);

  if (!name) {
    return undefined;
  }

  return ref.kind === "branch" ? createBranchRepoRef(name) : createTagRepoRef(name);
}

function resolveDeterministicLegacyRef(ref: string): ResolvedRepoRef | undefined {
  if (FULL_COMMIT_SHA_PATTERN.test(ref)) {
    return createCommitRepoRef(ref);
  }

  if (ref.startsWith("refs/heads/")) {
    const name = trimToUndefined(ref.slice("refs/heads/".length));
    return name ? createBranchRepoRef(name) : undefined;
  }

  if (ref.startsWith("heads/")) {
    const name = trimToUndefined(ref.slice("heads/".length));
    return name ? createBranchRepoRef(name) : undefined;
  }

  if (ref.startsWith("refs/tags/")) {
    const name = trimToUndefined(ref.slice("refs/tags/".length));
    return name ? createTagRepoRef(name) : undefined;
  }

  if (ref.startsWith("tags/")) {
    const name = trimToUndefined(ref.slice("tags/".length));
    return name ? createTagRepoRef(name) : undefined;
  }

  return undefined;
}

function migrateLegacyRepoSource(
  source: LegacySessionRepoSource | undefined,
): ResolvedRepoSource | undefined {
  if (!source) {
    return undefined;
  }

  const owner = trimToUndefined(source.owner);
  const repo = trimToUndefined(source.repo);
  const ref = trimToUndefined(source.ref);

  if (!owner || !repo || !ref) {
    return undefined;
  }

  const resolvedRef =
    normalizeResolvedRepoRef(source.resolvedRef) ?? resolveDeterministicLegacyRef(ref);

  if (!resolvedRef) {
    return undefined;
  }

  return {
    owner,
    ref: displayResolvedRepoRef(resolvedRef),
    refOrigin: source.refOrigin ?? "explicit",
    repo,
    resolvedRef,
    token: trimToUndefined(source.token),
  };
}

export class AppDb extends Dexie {
  dailyCosts!: EntityTable<DailyCostAggregate, "date">;
  messages!: EntityTable<MessageRow, "id">;
  providerKeys!: EntityTable<ProviderKeyRecord, "provider">;
  repositories!: Table<RepositoryRow, [string, string, string]>;
  sessionLeases!: EntityTable<SessionLeaseRow, "sessionId">;
  sessionRuntime!: EntityTable<SessionRuntimeRow, "sessionId">;
  sessions!: EntityTable<SessionData, "id">;
  settings!: EntityTable<SettingsRow, "key">;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      daily_costs: "date",
      messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    });
    this.version(2).stores({
      daily_costs: "date",
      messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      session_leases: "sessionId, ownerTabId, heartbeatAt",
      session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    });
    this.version(3)
      .stores({
        daily_costs: "date",
        messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
        "provider-keys": "provider, updatedAt",
        repositories: "[owner+repo+ref], lastOpenedAt",
        session_leases: "sessionId, ownerTabId, heartbeatAt",
        session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
        sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
        settings: "key, updatedAt",
      })
      .upgrade(async (tx) => {
        const repositories = tx.table("repositories") as Table<
          LegacyRepositoryRow,
          [string, string, string]
        >;
        await repositories.toCollection().modify((row) => {
          if (row.refOrigin === undefined) {
            row.refOrigin = "explicit";
          }
        });
      });
    this.version(4)
      .stores({
        daily_costs: "date",
        messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
        "provider-keys": "provider, updatedAt",
        repositories: "[owner+repo+ref], lastOpenedAt",
        session_leases: "sessionId, ownerTabId, heartbeatAt",
        session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
        sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
        settings: "key, updatedAt",
      })
      .upgrade(async (tx) => {
        const repositories = tx.table("repositories") as Table<
          LegacyRepositoryRow,
          [string, string, string]
        >;
        await repositories.toCollection().modify((row) => {
          if (row.refOrigin === undefined) {
            row.refOrigin = "explicit";
          }
        });

        const sessions = tx.table("sessions") as Table<LegacySessionData, string>;
        await sessions.toCollection().modify((row) => {
          row.repoSource = migrateLegacyRepoSource(row.repoSource);
        });
      });
    this.dailyCosts = this.table("daily_costs");
    this.messages = this.table("messages");
    this.providerKeys = this.table("provider-keys");
    this.repositories = this.table("repositories");
    this.sessionLeases = this.table("session_leases");
    this.sessionRuntime = this.table("session_runtime");
    this.sessions = this.table("sessions");
    this.settings = this.table("settings");
  }
}

export const db = new AppDb();

export async function touchRepository(
  source: Pick<RepositoryRow, "owner" | "ref" | "refOrigin" | "repo">,
): Promise<void> {
  const owner = source.owner.trim();
  const repo = source.repo.trim();
  const ref = source.ref.trim();

  if (!owner || !repo || !ref) {
    return;
  }

  await db.repositories.put({
    lastOpenedAt: getIsoNow(),
    owner,
    ref,
    refOrigin: source.refOrigin,
    repo,
  });
}

export async function listRepositories(): Promise<RepositoryRow[]> {
  return await db.repositories.orderBy("lastOpenedAt").reverse().toArray();
}

export async function putSession(session: SessionData): Promise<void> {
  await db.sessions.put(session);
}

export async function putMessage(message: MessageRow): Promise<void> {
  await db.messages.put(message);
}

export async function putMessages(messages: MessageRow[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  await db.messages.bulkPut(messages);
}

export async function putSessionAndMessages(
  session: SessionData,
  messages: MessageRow[],
): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.put(session);
    await putMessages(messages);
  });
}

export async function replaceSessionMessages(
  session: SessionData,
  messages: MessageRow[],
): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    const existingMessages = await db.messages.where("sessionId").equals(session.id).toArray();
    const nextMessageIds = new Set(messages.map((message) => message.id));
    const deletedMessageIds = existingMessages
      .filter((message) => !nextMessageIds.has(message.id))
      .map((message) => message.id);

    await db.sessions.put(session);

    if (deletedMessageIds.length > 0) {
      await db.messages.bulkDelete(deletedMessageIds);
    }

    if (messages.length > 0) {
      await db.messages.bulkPut(messages);
    }
  });
}

export async function getSession(id: string): Promise<SessionData | undefined> {
  return await db.sessions.get(id);
}

export async function getSessionMessages(sessionId: string): Promise<MessageRow[]> {
  return await db.messages
    .where("[sessionId+timestamp]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .sortBy("timestamp");
}

export async function listSessions(): Promise<SessionData[]> {
  return await db.sessions.orderBy("updatedAt").reverse().toArray();
}

export async function getLatestSessionId(): Promise<string | undefined> {
  return (await db.sessions.orderBy("updatedAt").reverse().first())?.id;
}

export async function getMostRecentSession(): Promise<SessionData | undefined> {
  const latestId = await getLatestSessionId();

  if (!latestId) {
    return undefined;
  }

  return await getSession(latestId);
}

export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const messageIds = await db.messages.where("sessionId").equals(sessionId).primaryKeys();

  await db.messages.bulkDelete(messageIds);
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction(
    "rw",
    db.sessions,
    db.messages,
    db.sessionLeases,
    db.sessionRuntime,
    async () => {
      await db.sessions.delete(id);
      await deleteMessagesBySession(id);
      await db.sessionLeases.delete(id);
      await db.sessionRuntime.delete(id);
    },
  );
}

export async function getSessionLease(sessionId: string): Promise<SessionLeaseRow | undefined> {
  return await db.sessionLeases.get(sessionId);
}

export async function putSessionLease(row: SessionLeaseRow): Promise<void> {
  await db.sessionLeases.put(row);
}

export async function deleteSessionLease(sessionId: string): Promise<void> {
  await db.sessionLeases.delete(sessionId);
}

export async function listSessionLeases(): Promise<SessionLeaseRow[]> {
  return await db.sessionLeases.toArray();
}

export async function getSessionRuntime(sessionId: string): Promise<SessionRuntimeRow | undefined> {
  return await db.sessionRuntime.get(sessionId);
}

export async function putSessionRuntime(row: SessionRuntimeRow): Promise<void> {
  await db.sessionRuntime.put(row);
}

export async function deleteSessionRuntime(sessionId: string): Promise<void> {
  await db.sessionRuntime.delete(sessionId);
}

export type ChatDataExportV1 = {
  exportVersion: 1;
  exportedAt: string;
  sessions: Array<{
    messages: MessageRow[];
    session: SessionData;
  }>;
};

export async function exportAllChatData(): Promise<ChatDataExportV1> {
  const sessions = await listSessions();
  const sessionsWithMessages = await Promise.all(
    sessions.map(async (session) => ({
      messages: await getSessionMessages(session.id),
      session,
    })),
  );

  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    sessions: sessionsWithMessages,
  };
}

/**
 * Clears every persisted store (sessions, messages, settings, provider keys,
 * repositories, daily cost aggregates, runtime metadata). Release active
 * runtime ownership before calling.
 */
export async function deleteAllLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.sessions,
      db.messages,
      db.settings,
      db.providerKeys,
      db.repositories,
      db.dailyCosts,
      db.sessionLeases,
      db.sessionRuntime,
    ],
    async () => {
      await db.sessions.clear();
      await db.messages.clear();
      await db.settings.clear();
      await db.providerKeys.clear();
      await db.repositories.clear();
      await db.dailyCosts.clear();
      await db.sessionLeases.clear();
      await db.sessionRuntime.clear();
    },
  );
}

export async function setSetting(key: string, value: JsonValue): Promise<void> {
  await db.settings.put({
    key,
    updatedAt: getIsoNow(),
    value,
  });
}

export async function getSetting(key: string): Promise<JsonValue | undefined> {
  return (await db.settings.get(key))?.value;
}

export async function getAllSettings(): Promise<SettingsRow[]> {
  return await db.settings.toArray();
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

export async function setProviderKey(provider: ProviderId, value: string): Promise<void> {
  await db.providerKeys.put({
    provider,
    updatedAt: getIsoNow(),
    value,
  });
}

export async function getProviderKey(provider: ProviderId): Promise<ProviderKeyRecord | undefined> {
  return await db.providerKeys.get(provider);
}

export async function listProviderKeys(): Promise<ProviderKeyRecord[]> {
  return await db.providerKeys.toArray();
}

export async function deleteProviderKey(provider: ProviderId): Promise<void> {
  await db.providerKeys.delete(provider);
}

export async function getDailyCost(date: string): Promise<DailyCostAggregate | undefined> {
  return await db.dailyCosts.get(date);
}

export function mergeDailyCostAggregate(
  current: DailyCostAggregate | undefined,
  usage: Usage,
  provider: ProviderId,
  model: string,
  at: Date | number | string = Date.now(),
): DailyCostAggregate {
  const date = getDateKey(at);
  const providerTotals = current?.byProvider[provider] ?? {};
  const nextByProvider = {
    ...current?.byProvider,
    [provider]: {
      ...providerTotals,
      [model]: (providerTotals[model] ?? 0) + usage.cost.total,
    },
  };

  return {
    byProvider: nextByProvider,
    date,
    total: (current?.total ?? 0) + usage.cost.total,
  };
}

export async function recordUsage(
  usage: Usage,
  provider: ProviderId,
  model: string,
  at = Date.now(),
): Promise<void> {
  const date = getDateKey(at);
  const current = await db.dailyCosts.get(date);
  const next = mergeDailyCostAggregate(current, usage, provider, model, at);
  await db.dailyCosts.put(next);
}

export async function listDailyCosts(): Promise<DailyCostAggregate[]> {
  return await db.dailyCosts.orderBy("date").reverse().toArray();
}

export function getTotalCostFromAggregates(dailyCosts: DailyCostAggregate[]): number {
  return dailyCosts.reduce((total, daily) => total + daily.total, 0);
}

export async function getTotalCost(): Promise<number> {
  return getTotalCostFromAggregates(await listDailyCosts());
}

export function getCostsByProviderFromAggregates(
  dailyCosts: DailyCostAggregate[],
): Partial<Record<ProviderId, number>> {
  const totals: Partial<Record<ProviderId, number>> = {};

  for (const daily of dailyCosts) {
    for (const [provider, models] of Object.entries(daily.byProvider) as Array<
      [ProviderId, Record<string, number> | undefined]
    >) {
      const sum = Object.values(models ?? {}).reduce((subtotal, value) => subtotal + value, 0);
      totals[provider] = (totals[provider] ?? 0) + sum;
    }
  }

  return totals;
}

export async function getCostsByProvider(): Promise<Partial<Record<ProviderId, number>>> {
  return getCostsByProviderFromAggregates(await listDailyCosts());
}

export function getCostsByModelFromAggregates(
  dailyCosts: DailyCostAggregate[],
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const daily of dailyCosts) {
    for (const models of Object.values(daily.byProvider)) {
      for (const [model, value] of Object.entries(models ?? {})) {
        totals[model] = (totals[model] ?? 0) + value;
      }
    }
  }

  return totals;
}

export async function getCostsByModel(): Promise<Record<string, number>> {
  return getCostsByModelFromAggregates(await listDailyCosts());
}
