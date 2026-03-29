# Remove Worker Runtime Plan

Date: 2026-03-29

## Decision Gate

- this plan intentionally removes the current worker architecture in `src/agent/runtime-client.ts`
- this plan does **not** promise continuation of the same provider HTTP stream after page/tab death
- this plan **does** promise recoverable interruption:
  - no stuck fake streaming
  - no lost durable history
  - deterministic owner handoff
  - clear mirror/read-only behavior

## Goal

- page-owned runtime
- no workers
- single owner tab per session
- read-only mirrors in other tabs
- no long-lived agent host per session
- ephemeral turn runner per in-flight assistant turn
- full recovery after tab/browser interruption
- simpler code than the current worker + Comlink split

## Ground Truth From Current Code

### 1. Current app complexity is mostly transport + split ownership

`src/agent/runtime-client.ts` creates `SharedWorker` or `Worker` per session:

```ts
if (sharedWorkerSupported) {
  const worker = new SharedWorker(url, opts)
  return {
    worker,
    api: wrap<SessionWorkerApi>(worker.port),
    workerType: "shared",
  }
}

const worker = new Worker(url, opts)
return {
  worker,
  api: wrap<SessionWorkerApi>(worker),
  workerType: "dedicated",
}
```

`src/agent/runtime-worker-api.ts` still has one host per worker instance:

```ts
let host: AgentHost | undefined
let activeSessionId: string | undefined
```

Meaning:

- worker lifecycle exists only to hold `AgentHost` outside the page
- transport, init, disposal, and recovery are separate moving parts

### 2. Same-tab navigation already does not require a worker

`src/components/chat.tsx`:

```ts
await runtimeClient.startInitialTurn(session, content)
await navigate({
  ...sessionDestination({
    id: session.id,
    repoSource: session.repoSource,
  }),
  ...
})
```

`src/routes/__root.tsx` uses a single TanStack Router shell with `Outlet`.

Meaning:

- same-tab route navigation is SPA navigation
- a page-owned runtime can survive normal in-app navigation
- worker is not needed just to survive route changes

### 3. Current session model is session-scoped, not message-scoped

`src/types/storage.ts`:

```ts
export interface SessionData {
  id: string
  isStreaming: boolean
  model: string
  provider: ProviderId
  providerGroup?: ProviderGroupId
  repoSource?: RepoSource
  thinkingLevel: ThinkingLevel
  ...
}
```

`src/agent/session-adapter.ts` rebuilds agent state from `session + messages + tools`:

```ts
export function buildInitialAgentState(
  session: SessionData,
  messages: MessageRow[],
  model: Model<any>,
  tools: AgentTool[]
): Partial<AgentState> {
  return {
    messages: toAgentMessages(messages),
    model,
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: session.thinkingLevel,
    tools,
  }
}
```

Meaning:

- the durable unit is still the session
- a single message is not enough state to reconstruct runtime behavior
- the right simplification is not "agent per message"
- the right simplification is "fresh turn runner per in-flight assistant turn, rebuilt from persisted session history"

### 4. `AgentHost.startTurn()` already matches the needed contract

`src/agent/agent-host.ts`:

```ts
async startTurn(content: string): Promise<void> {
  ...
  await this.persistPromptStart(userRow, assistantRow)
  ...
  this.runningTurn = this.runTurnToCompletion(userMessage).finally(() => {
    this.runningTurn = undefined
  })
}
```

Meaning:

- the app already has the correct high-level turn contract:
  - durable prompt start first
  - background completion second
- the big simplification is removing worker transport, not rewriting turn semantics from scratch

### 5. Sitegeist local code uses page-owned agent + lock ownership, not immortal background streaming

`docs/sitegeist/src/sidepanel.ts`:

```ts
let agent: Agent;
```

```ts
agent = new Agent({
  initialState: ...,
  streamFn: createStreamFn(async () => { ... }),
})
```

`docs/sitegeist/src/background.ts`:

```ts
const success = !ownerWindowId || !ownerSidepanelOpen || ownerWindowId === reqWindowId;
```

```ts
port.onDisconnect.addListener(() => {
  closeSidepanel(windowId, false);
});
```

`docs/sitegeist/src/sidepanel.ts`:

```ts
// Navigation will disconnect port and auto-release locks
window.location.href = url.toString();
```

Meaning:

- Sitegeist sidepanel owns the live `Agent`
- background owns lock state, not runtime execution
- closing/navigating the sidepanel releases ownership
- reopen behavior is reacquire + rebuild, not keep-the-same-stream-alive

That is the closest local reference point for the architecture below.

## Target Architecture

### Core shape

- page-owned runtime, not worker-owned runtime
- owner lease per session, not shared session runtime
- fresh `TurnRunner` per active turn
- Dexie as durable truth
- optional `BroadcastChannel` as fast signal only

### Durable state

Keep:

- `sessions`
- `messages`
- `settings`
- `providerKeys`
- `dailyCosts`

Add:

- `session_leases`
- `session_runtime`

### Runtime ownership model

- exactly one tab may own a session at a time
- other tabs can read the session from Dexie but cannot mutate it
- owner tab renews a heartbeat while it owns the session
- if owner dies, lease goes stale
- next tab may take over only after stale detection

### Turn model

- do not keep one long-lived `AgentHost` per session in memory
- create a fresh `TurnRunner` from persisted session + messages when a send starts
- keep the runner only while that turn is active
- persist checkpoints during the turn
- destroy the runner when the turn finishes, aborts, or errors

### Interruption model

- if the page is closed / discarded / frozen and the provider request dies, we do not try to continue the same request
- instead:
  - detect stale owner lease
  - reconcile any streaming rows into interrupted/error state
  - keep partial assistant output if it exists
  - allow clean retry/resume

## New Data Model

### New durable rows

Add to `src/types/storage.ts`:

```ts
export interface SessionLeaseRow {
  acquiredAt: string
  heartbeatAt: string
  ownerTabId: string
  ownerToken: string
  sessionId: string
}

export type SessionRuntimeStatus =
  | "idle"
  | "streaming"
  | "interrupted"
  | "aborted"
  | "error"
  | "completed"

export interface SessionRuntimeRow {
  assistantMessageId?: string
  lastError?: string
  lastProgressAt?: string
  ownerTabId?: string
  sessionId: string
  startedAt?: string
  status: SessionRuntimeStatus
  turnId?: string
  updatedAt: string
}
```

### Why separate tables instead of extending `SessionData`

- `SessionData.updatedAt` currently drives ordering in `listSessions()`
- heartbeat writes must not reorder the sidebar every few seconds
- `exportAllChatData()` currently exports `sessions + messages`
- lease/runtime rows are transient and should not ship in exports

Current export path in `src/db/schema.ts`:

```ts
return {
  exportVersion: 1,
  exportedAt: new Date().toISOString(),
  sessions: sessionsWithMessages,
}
```

So:

- keep lease/runtime metadata outside exported session history

### Dexie schema changes

In `src/db/schema.ts`, bump the DB version and add tables:

```ts
this.version(2).stores({
  daily_costs: "date",
  messages:
    "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
  "provider-keys": "provider, updatedAt",
  repositories: "[owner+repo+ref], lastOpenedAt",
  session_leases: "sessionId, ownerTabId, heartbeatAt",
  session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
  sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
  settings: "key, updatedAt",
})
```

Add helpers:

- `getSessionLease(sessionId)`
- `putSessionLease(row)`
- `deleteSessionLease(sessionId)`
- `getSessionRuntime(sessionId)`
- `putSessionRuntime(row)`
- `deleteSessionRuntime(sessionId)`

Also extend `deleteAllLocalData()` to clear both new stores.

## Recommended UX Policy

To keep the runtime simpler than the current worker model:

- one tab can own multiple sessions over time
- but do **not** allow a single tab to silently keep streaming session A while the user navigates that same tab into session B
- if the current tab owns a streaming session and the user tries to open another session:
  - open the target session in a new tab
  - keep the current tab attached to the active stream

This keeps the model simple:

- one active streaming session per tab
- one owner tab per session
- mirrors are read-only

If product later wants one tab to own multiple simultaneous streams, that can be added later, but it is not part of this plan.

## Implementation Status

### Phase 0: Contract / docs

- [x] `AGENTS.md` no longer requires `SharedWorker` / `Worker`
- [x] the implemented runtime guarantee is now:
  - recoverable interruption
  - no promise of immortal background continuation after page death
- [x] same-tab navigation away from a streaming session is redirected to a new tab from the sidebar/session list path
- [x] `SPEC.md` was already absent from the worktree, so there was no in-repo spec file left to update

### Phase 1: Tab identity and lease persistence

- [x] added `src/agent/tab-id.ts`
- [x] added `src/agent/session-lease.ts`
- [x] implemented `claimSessionLease(sessionId)`
- [x] implemented `renewSessionLease(sessionId)`
- [x] implemented `releaseSessionLease(sessionId)`
- [x] implemented `loadSessionLeaseState(sessionId)`
- [x] Dexie is the source of truth for lease state
- [x] added best-effort release handlers for `beforeunload` and `pagehide`
- [x] added `LEASE_HEARTBEAT_MS`
- [x] added `LEASE_STALE_MS`
- [x] skipped `BroadcastChannel` because Dexie live queries plus lease heartbeats were sufficient for the implemented ownership model

### Phase 2: Durable turn runtime state

- [x] added `src/agent/session-runtime-store.ts`
- [x] added `session_runtime` CRUD helpers in `src/db/schema.ts`
- [x] added `SessionRuntimeRow` / `SessionRuntimeStatus`
- [x] added `markTurnStarted`
- [x] added `markTurnProgress`
- [x] added `markTurnCompleted`
- [x] added `markTurnInterrupted`
- [x] added `clearSessionRuntime`
- [x] kept `session.isStreaming` for current UI compatibility
- [x] added `session_runtime` timing metadata so recovery no longer depends only on `session.updatedAt`

### Phase 3: Replace worker transport with page-owned runtime registry

- [x] refactored `src/agent/runtime-client.ts` into a page-owned runtime manager
- [x] replaced worker handles with page-local active turn hosts
- [x] removed Comlink / worker init / transport retry logic
- [x] kept the public runtime methods:
  - `startTurn`
  - `startInitialTurn`
  - `abort`
  - `setModelSelection`
  - `setThinkingLevel`
  - `refreshGithubToken`
- [x] kept `BusyRuntimeError` for same-session double-send
- [x] kept `MissingSessionRuntimeError` for missing Dexie state
- [x] deleted:
  - `src/agent/runtime-worker.ts`
  - `src/agent/runtime-worker-api.ts`
  - `src/agent/runtime-worker-types.ts`

### Phase 4: Ephemeral turn runner behavior

- [x] kept the existing `AgentHost` persistence/watchdog core
- [x] changed runtime ownership so `AgentHost` now exists only for active turns held by `RuntimeClient`
- [x] runtime state is written on:
  - turn start
  - streaming progress
  - terminal completion
  - repair/error
- [x] idle sessions no longer need worker-held runtime memory

### Phase 5: First-send/runtime boundary

- [x] first send still uses in-memory session creation followed by `startInitialTurn`
- [x] navigation still happens after `startInitialTurn` resolves
- [x] there is no worker bootstrap path anymore
- [x] there is no `src/sessions/session-bootstrap.ts` left to preserve
- [x] existing-session send and first-send now use the same page-owned runtime boundary

### Phase 6: Owner-aware UI and read-only mirrors

- [x] added `src/hooks/use-session-ownership.ts`
- [x] `Chat` now reads ownership state
- [x] mirror tabs disable the composer
- [x] mirror tabs disable model/thinking changes through the same composer lock path
- [x] mirror tabs show a read-only banner
- [x] sidebar/session list mark locked sessions
- [x] selecting another session while the current one is streaming opens the target in a new tab

### Phase 7: Recovery layer

- [x] `reconcileInterruptedSession()` now consults lease state before repairing
- [x] stale-owner recovery now:
  - rewrites streaming assistant rows
  - clears `session.isStreaming`
  - marks runtime `interrupted`
  - removes stale lease rows
- [x] recovery no longer relies only on `session.updatedAt`
- [x] visibility-based stale recovery in `Chat` now delegates to lease-aware reconciliation

### Phase 8: Cleanup

- [x] updated `src/components/data-settings.tsx` to call `runtimeClient.releaseAll()`
- [x] removed worker-specific debug phases from `src/lib/runtime-debug.ts`
- [x] added page-runtime debug phases:
  - `lease_claim_started`
  - `lease_claimed`
- [x] updated `src/db/schema.ts` wording away from worker teardown
- [x] removed obsolete bootstrap-only runtime error code
- [x] removed obsolete worker-specific tests:
  - `tests/runtime-client.test.ts`
  - `tests/runtime-worker-api.test.ts`

## Validation Status

- [x] `bun run typecheck` was run repeatedly during the refactor
- [x] final `bun run typecheck` passes
- [x] the remaining app runtime no longer imports worker-only files

## Files Deleted

- [x] `src/agent/runtime-worker.ts`
- [x] `src/agent/runtime-worker-api.ts`
- [x] `src/agent/runtime-worker-types.ts`
- [x] `tests/runtime-client.test.ts`
- [x] `tests/runtime-worker-api.test.ts`

## Files Added

- [x] `src/agent/tab-id.ts`
- [x] `src/agent/session-lease.ts`
- [x] `src/agent/session-runtime-store.ts`
- [x] `src/hooks/use-session-ownership.ts`

## Files Heavily Refactored

- [x] `src/agent/runtime-client.ts`
- [x] `src/agent/agent-host.ts`
- [x] `src/components/chat.tsx`
- [x] `src/components/app-sidebar.tsx`
- [x] `src/components/chat-composer.tsx`
- [x] `src/components/chat-session-list.tsx`
- [x] `src/components/data-settings.tsx`
- [x] `src/db/schema.ts`
- [x] `src/types/storage.ts`
- [x] `src/sessions/session-actions.ts`
- [x] `src/sessions/session-notices.ts`

## Final Architecture Check

- [x] no worker transport remains
- [x] no shared background runtime remains
- [x] runtime ownership is page-local
- [x] session ownership is lease-based
- [x] mirror tabs are read-only
- [x] active turns are recoverable after interruption
