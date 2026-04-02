import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { AppDb } from "@/db/schema";
import { createEmptyUsage } from "@/types/models";
import type { RepoRefOrigin, ResolvedRepoRef, SessionData } from "@/types/storage";
import {
  getCostsByModelFromAggregates,
  getCostsByProviderFromAggregates,
  getTotalCostFromAggregates,
  mergeDailyCostAggregate,
} from "@/db/schema";

type LegacyRepositoryRow = {
  lastOpenedAt: string;
  owner: string;
  ref: string;
  refOrigin?: RepoRefOrigin;
  repo: string;
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

function defineLegacySchema(db: Dexie): void {
  db.version(3).stores({
    daily_costs: "date",
    messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
    "provider-keys": "provider, updatedAt",
    repositories: "[owner+repo+ref], lastOpenedAt",
    session_leases: "sessionId, ownerTabId, heartbeatAt",
    session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
  });
}

function buildLegacySession(id: string, repoSource?: LegacySessionRepoSource): LegacySessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource,
    thinkingLevel: "medium",
    title: id,
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

describe("db schema helpers", () => {
  it("merges daily cost aggregates by provider and model", () => {
    const usage = createEmptyUsage();
    usage.cost.total = 1.25;

    expect(
      mergeDailyCostAggregate(undefined, usage, "openai-codex", "gpt-5.1", "2026-03-23"),
    ).toEqual({
      byProvider: {
        "openai-codex": {
          "gpt-5.1": 1.25,
        },
      },
      date: "2026-03-23",
      total: 1.25,
    });
  });

  it("exposes total, provider, and model cost queries", () => {
    const dailyCosts = [
      {
        byProvider: {
          anthropic: {
            "claude-sonnet-4-6": 2,
          },
          "openai-codex": {
            "gpt-5.1": 3,
          },
        },
        date: "2026-03-23",
        total: 5,
      },
    ];

    expect(getTotalCostFromAggregates(dailyCosts)).toBe(5);
    expect(getCostsByProviderFromAggregates(dailyCosts)).toMatchObject({
      anthropic: 2,
      "openai-codex": 3,
    });
    expect(getCostsByModelFromAggregates(dailyCosts)).toMatchObject({
      "claude-sonnet-4-6": 2,
      "gpt-5.1": 3,
    });
  });

  it("migrates repository rows missing refOrigin", async () => {
    const name = `gitinspect-migration-${Date.now()}`;
    const legacyDb = new Dexie(name);

    defineLegacySchema(legacyDb);

    await legacyDb.open();
    await legacyDb.table<LegacyRepositoryRow, [string, string, string]>("repositories").put({
      lastOpenedAt: "2026-03-24T12:00:00.000Z",
      owner: "acme",
      ref: "main",
      repo: "demo",
    });
    legacyDb.close();

    const migratedDb = new AppDb(name);
    await migratedDb.open();

    expect(await migratedDb.repositories.toArray()).toEqual([
      {
        lastOpenedAt: "2026-03-24T12:00:00.000Z",
        owner: "acme",
        ref: "main",
        refOrigin: "explicit",
        repo: "demo",
      },
    ]);

    migratedDb.close();
    await Dexie.delete(name);
  });

  it("migrates deterministic legacy session repo sources and clears ambiguous refs", async () => {
    const name = `gitinspect-session-migration-${Date.now()}`;
    const legacyDb = new Dexie(name);

    defineLegacySchema(legacyDb);

    await legacyDb.open();
    const sessionsTable = legacyDb.table<LegacySessionData, string>("sessions");
    const commitSha = "0123456789abcdef0123456789abcdef01234567";

    await sessionsTable.bulkPut([
      buildLegacySession("session-resolved", {
        owner: "acme",
        ref: "stale-value",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/main",
          fullRef: "refs/heads/main",
          kind: "branch",
          name: "main",
        },
      }),
      buildLegacySession("session-commit", {
        owner: "acme",
        ref: commitSha,
        repo: "demo",
      }),
      buildLegacySession("session-branch", {
        owner: "acme",
        ref: "refs/heads/feature/foo",
        repo: "demo",
      }),
      buildLegacySession("session-tag", {
        owner: "acme",
        ref: "tags/v1.2.3",
        repo: "demo",
      }),
      buildLegacySession("session-ambiguous", {
        owner: "acme",
        ref: "main",
        repo: "demo",
      }),
    ]);
    legacyDb.close();

    const migratedDb = new AppDb(name);
    await migratedDb.open();

    expect(await migratedDb.sessions.get("session-resolved")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: "main",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/main",
          fullRef: "refs/heads/main",
          kind: "branch",
          name: "main",
        },
      },
    });
    expect(await migratedDb.sessions.get("session-commit")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: commitSha,
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          kind: "commit",
          sha: commitSha,
        },
      },
    });
    expect(await migratedDb.sessions.get("session-branch")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/feature/foo",
          fullRef: "refs/heads/feature/foo",
          kind: "branch",
          name: "feature/foo",
        },
      },
    });
    expect(await migratedDb.sessions.get("session-tag")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: "v1.2.3",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "tags/v1.2.3",
          fullRef: "refs/tags/v1.2.3",
          kind: "tag",
          name: "v1.2.3",
        },
      },
    });
    expect(await migratedDb.sessions.get("session-ambiguous")).toMatchObject({
      repoSource: undefined,
    });

    migratedDb.close();
    await Dexie.delete(name);
  });
});
