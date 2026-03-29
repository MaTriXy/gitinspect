# Runtime Reliability Refactor Plan

Date: 2026-03-28

## Goal

- fix same-session multi-tab flakiness
- fix first-send / navigation race
- stop infinite `isStreaming`
- stop silent runtime failures
- remove bootstrap-only state + special cases
- reduce LOC by collapsing lifecycle ownership

## What This Plan Does And Does Not Guarantee

This plan is intended to solve all **currently diagnosed runtime reliability issues in this codebase**, assuming IndexedDB writes still work:

- same-session `SharedWorker` init races
- first-send bootstrap race
- repeated same-fingerprint failures, including `BusyRuntimeError`
- handler/persistence throws leaving sessions stuck streaming
- hung prompt never reaching `finally`
- worker death leaving stale streaming state on reload/focus/tab switch
- UI blindness when runtime commands fail

This plan does **not** solve:

- IndexedDB quota/corruption/full-write failure beyond best-effort surfacing
- idle worker-handle accumulation / memory policy
- every possible multi-writer Dexie edge under extreme churn

Those are separate follow-ups.

---

## Ground Truth From Current Code

### 1. UI already treats Dexie as truth

`src/components/chat.tsx`:

```ts
const loadedSessionState = useLiveQuery(async (): Promise<LoadedSessionState> => {
  if (!sessionId) {
    return { kind: "none" }
  }

  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded) {
    return { kind: "missing" }
  }

  return {
    kind: "active",
    messages: loaded.messages,
    session: loaded.session,
  }
}, [sessionId])
```

Meaning:

- UI does not need live runtime memory to be source of truth
- UI only needs durable session/message state to become correct

### 2. `send()` currently resolves after the full turn, not durable start

`src/agent/runtime-worker-api.ts`:

```ts
export async function send(content: string): Promise<void> {
  await requireHost({ idle: true }).prompt(content)
}
```

`src/agent/agent-host.ts`:

```ts
await this.persistence.persistPromptStart(userRow, assistantRow)
await this.agent.prompt(userMessage)
```

Meaning:

- existing-session send can `await`
- first-send cannot `await` if UI wants to navigate immediately
- that contract split is why bootstrap exists

### 3. First send persists a provisional shell, then fire-and-forgets runtime

`src/sessions/session-bootstrap.ts`:

```ts
await persistSessionSnapshot({
  ...session,
  bootstrapStatus: "bootstrap",
})

void runtimeClient.send(session.id, params.content).catch(async (error) => {
  await recordBootstrapFailure(session.id, error)
})
```

`src/components/chat.tsx`:

```ts
const session = await bootstrapSessionAndSend(...)
await navigate({
  ...sessionDestination({ id: session.id, repoSource: session.repoSource }),
  ...
})
```

Meaning:

- new-session send path is fundamentally different from normal send
- navigation can beat worker init / prompt start
- bootstrap-only UI state exists only to cover that gap

### 4. New-session builders persist immediately today

`src/sessions/session-actions.ts`:

```ts
const session = createSession({
  model: base.model,
  providerGroup: base.providerGroup ?? base.provider,
  thinkingLevel: base.thinkingLevel,
})
await persistSessionSnapshot(session)
return session
```

Meaning:

- even session construction currently commits to Dexie too early
- if we want no provisional rows, session creation must become in-memory first

### 5. Worker init is single-host and can interleave

`src/agent/runtime-worker-api.ts`:

```ts
let host: AgentHost | undefined
let activeSessionId: string | undefined

export async function init(id: string): Promise<boolean> {
  if (host && activeSessionId === id) {
    return true
  }

  if (host) {
    host.dispose()
    host = undefined
  }

  activeSessionId = id
  const loaded = await loadSessionWithMessages(id)
```

Meaning:

- one worker instance has one host at a time
- concurrent `init()` calls on two ports can still interleave inside that worker
- lifecycle must be serialized even if we keep per-session workers

### 6. Runtime repair ownership is split across UI + bootstrap + worker

`src/hooks/use-runtime-session.ts`:

```ts
} catch (error) {
  try {
    await appendSessionNotice(sessionId, error)
  } catch (noticeError) {
    console.error("[gitinspect:runtime] notice_persistence_failed", ...)
  }
}
```

`src/sessions/session-bootstrap.ts`:

```ts
await appendSessionNotice(sessionId, toBootstrapFailure(error), {
  bootstrapStatus: "failed",
  clearStreaming: true,
  rewriteStreamingAssistant: true,
})
```

`src/agent/agent-host.ts`:

```ts
await appendSessionNotice(this.session.id, error)
```

Meaning:

- there is no single lifecycle owner
- multiple writers mutate runtime failure state

### 7. Notice dedupe and repair are still mixed into one helper API

`src/sessions/session-notices.ts`:

```ts
export async function appendSessionNotice(
  sessionId: string,
  error: unknown,
  options: AppendSessionNoticeOptions = {}
): Promise<void> {
  const classified = classifyRuntimeError(error)
  const nextMessages = options.rewriteStreamingAssistant
    ? rewriteStreamingAssistantRows(loaded.messages, classified.message)
    : loaded.messages
  const hasExistingFingerprint = loaded.messages.some((message) =>
    isSystemFingerprintRow(message, classified.fingerprint)
  )
```

Meaning:

- one function currently owns:
  - system-row dedupe
  - streaming repair
  - bootstrap mutation
  - interrupted-session recovery
- even after the repeated-fingerprint fix, the abstraction is still wrong

### 8. Repeated `BusyRuntimeError` is the same dedupe class

`src/agent/runtime-worker-api.ts`:

```ts
if (options.idle && host.isBusy()) {
  throw new BusyRuntimeError(activeSessionId)
}
```

`src/agent/runtime-errors.ts`:

```ts
if (error instanceof BusyRuntimeError) {
  return {
    fingerprint: fingerprintFor("runtime_busy", message),
    kind: "runtime_busy",
    message,
    severity: "warning",
    source: "runtime",
  }
}
```

Meaning:

- repeated busy failures hit the same fingerprint dedupe logic
- repair must remain separate from visible notice insertion

### 9. `SessionPersistence` is not really shared

`src/agent/agent-host.ts` is its only consumer.

Meaning:

- `AgentHost` + `SessionPersistence` are one unit split across files
- folding them together should reduce indirection, callbacks, and state hopping

---

## Core Decision

Do **not** keep hardening the current bootstrap/send/notices split.

Refactor to this shape:

1. keep one worker handle per `sessionId`
2. keep `SharedWorker` where available, dedicated `Worker` fallback elsewhere
3. replace full-turn `send()` with durable-start `startTurn()`
4. add `startInitialTurn(session, content)` for in-memory new sessions
5. make worker runtime the only owner of:
   - prompt lifecycle
   - streaming repair
   - system notices
   - watchdogs
   - stale-stream recovery
6. fold `SessionPersistence` into `AgentHost`
7. delete `bootstrapStatus`, `session-bootstrap.ts`, `chat-bootstrap-ui.ts`
8. remove UI-side `appendSessionNotice(...)` for runtime commands

This is the simplest shape that still respects current repo constraints:

- no backend
- no browser extension APIs
- no `browserjs`
- Dexie remains durable truth
- per-session worker model remains intact

---

## Target Runtime Contract

Replace:

```ts
send(sessionId, content): Promise<void> // resolves after full turn
```

With:

```ts
startTurn(sessionId, content): Promise<void> // resolves after persistPromptStart
startInitialTurn(session, content): Promise<void> // same contract for a new in-memory session
```

### Worker API target

`src/agent/runtime-worker-types.ts` should move toward:

```ts
export interface SessionWorkerApi {
  initFromStorage(sessionId: string): Promise<boolean>
  initFromSession(session: SessionData): Promise<void>
  startTurn(content: string): Promise<void>
  abort(): Promise<void>
  dispose(): Promise<void>
  refreshGithubToken(): Promise<void>
  setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void>
  setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void>
}
```

### Runtime client target

`src/agent/runtime-client.ts` should expose:

```ts
await runtimeClient.startTurn(sessionId, content)
await runtimeClient.startInitialTurn(session, content)
```

### Worker runtime target

`AgentHost` becomes the single lifecycle owner:

```ts
async startTurn(content: string): Promise<void> {
  const { userMessage, userRow, assistantRow } = this.buildTurnStart(content)

  await this.persistPromptStart(userRow, assistantRow)

  this.runningTurn = this.runTurnToCompletion(userMessage).catch((error) => {
    void this.repairTurnFailure(error)
  })
}
```

And repair is split from notice dedupe:

```ts
private async repairTurnFailure(error: unknown): Promise<void> {
  await this.rewriteStreamingAssistantRows(error)
  await this.persistStreamingCleared()
  await this.appendSystemNoticeIfMissing(error)
  this.clearActiveTurnPointers()
}
```

That is the core simplification.

---

## How The Refactor Solves Each Diagnosed Issue

### Same-session multi-tab / tab-switch flakiness

- serialize worker `init()` and `dispose()`
- keep exactly one active host transition at a time inside `runtime-worker-api.ts`
- remove fire-and-forget bootstrap path, so there is one fewer race window

### First-send race

- stop persisting empty shell sessions before prompt start
- build session in memory
- initialize worker from that session object
- `await startInitialTurn(...)`
- navigate only after `persistPromptStart()` succeeded

By navigation time:

- session row exists
- user row exists
- assistant streaming row exists

### Infinite streaming

- worker-side repair always clears streaming state
- watchdog aborts hung turns
- reload/focus reconcile handles dead-worker residue

### Silent runtime errors

- worker persists system notices itself
- UI no longer swallows runtime failures behind best-effort notice writes
- UI only shows toast/log for catastrophic client-side invocation failures

### Repeated same-fingerprint failures, including `BusyRuntimeError`

- repair state first
- append notice if missing second
- dedupe never suppresses repair

### Main-thread / worker Dexie clashes

- reduce them by removing UI-side runtime notice writes
- runtime lifecycle state gets one primary writer: the worker

### Worker death while Dexie still says streaming

- init-from-storage reconciles stale `isStreaming`
- visibility/focus backstop can re-run stale reconcile if needed

---

## Detailed TODO List

### Phase 0. Lock the new contract before touching behavior

- [ ] Update this doc if code inspection reveals another owner of runtime lifecycle state.
- [ ] Add a short architecture comment in `src/agent/runtime-worker-types.ts` explaining the new contract: worker methods resolve after durable acceptance, not full turn completion.
- [ ] Decide final naming: prefer `startTurn` / `startInitialTurn`; avoid keeping `send` as an alias longer than migration needs.
- [ ] Define one invariant in the doc and in code comments: "repair and notice dedupe are separate operations."

### Phase 1. Make new-session creation in-memory first

- [ ] Add pure builders in `src/sessions/session-service.ts` or `src/sessions/session-actions.ts` that create `SessionData` without persisting.
- [ ] Stop using `createSessionForChat()` / `createSessionForRepo()` as immediate persistence helpers for first-send flow.
- [ ] Keep persisted creation only where a truly empty saved session is still desired; if no such path is needed, remove the persisted-first API entirely.
- [ ] Update `src/components/chat.tsx` first-send path to use in-memory session construction.
- [ ] Remove any assumption that "new session id already exists in Dexie before runtime starts."
- [ ] Add tests proving first-send does not create a durable empty session row on failure before `persistPromptStart()`.

### Phase 2. Change runtime API from full-turn `send` to durable-start `startTurn`

- [ ] Replace `send(content)` in `src/agent/runtime-worker-types.ts` with `startTurn(content)`.
- [ ] Split worker init into two paths in `src/agent/runtime-worker-api.ts`:
- [ ] `initFromStorage(sessionId)` loads from Dexie.
- [ ] `initFromSession(session)` builds host from in-memory session.
- [ ] Add `runtimeClient.startTurn(sessionId, content)` in `src/agent/runtime-client.ts`.
- [ ] Add `runtimeClient.startInitialTurn(session, content)` in `src/agent/runtime-client.ts`.
- [ ] Keep migration shim only if needed; delete old `send` after callers move.
- [ ] Update all callers in `src/components/chat.tsx` and `src/hooks/use-runtime-session.ts`.
- [ ] Add tests proving `startTurn()` resolves after prompt-start persistence, not after full stream completion.

### Phase 3. Serialize worker lifecycle completely

- [ ] Add one module-level lifecycle queue in `src/agent/runtime-worker-api.ts`.
- [ ] Put `initFromStorage`, `initFromSession`, and `dispose` through that queue.
- [ ] Ensure `host.dispose()`, `host = undefined`, `activeSessionId = ...`, load, reconcile, and host construction happen as one serialized transition.
- [ ] Keep same-session fast path only if it still obeys the queue and cannot bypass disposal/init ordering.
- [ ] Add tests for two concurrent `initFromStorage(sessionId)` calls from separate ports.
- [ ] Add tests for `dispose()` interleaving with `initFromStorage()` / `initFromSession()`.

### Phase 4. Fold `SessionPersistence` into `AgentHost`

- [ ] Move the persist queue, assistant-id bookkeeping, current-row building, and session-boundary persistence into `src/agent/agent-host.ts`.
- [ ] Delete callback bag wiring between `AgentHost` and `SessionPersistence`.
- [ ] Replace `this.persistence.*` calls with private `AgentHost` methods.
- [ ] Keep write ordering semantics identical while moving code.
- [ ] Delete `src/agent/session-persistence.ts` after migration.
- [ ] Update `tests/agent-host-persistence.test.ts` or split tests if the file becomes too broad.

### Phase 5. Run turns in background after durable start

- [ ] Split `prompt()` in `src/agent/agent-host.ts` into:
- [ ] `startTurn(content)` for validation + prompt-start persistence.
- [ ] `runTurnToCompletion(userMessage)` for background completion.
- [ ] Track one `runningTurn` promise so shutdown/abort logic can reason about active work.
- [ ] Preserve `BusyRuntimeError` behavior for concurrent sends while a turn is active.
- [ ] Clear active turn pointers in one place only.
- [ ] Ensure `abort()` still routes through `agent.abort()` and does not accidentally target the next turn.
- [ ] Add tests proving:
- [ ] second send while active still throws `BusyRuntimeError`
- [ ] first send can navigate immediately after `startInitialTurn()`
- [ ] normal send no longer waits for model completion

### Phase 6. Centralize repair inside the worker runtime

- [ ] Create separate private methods in `src/agent/agent-host.ts`:
- [ ] `repairStreamingState(...)`
- [ ] `appendSystemNoticeIfMissing(...)`
- [ ] `reconcileInterruptedState(...)`
- [ ] Never use one helper that both decides dedupe and decides whether repair should run.
- [ ] Make `handleEvent()` failures go through the same repair path instead of `console.error` only.
- [ ] Ensure repeated same-fingerprint failures still rewrite streaming assistant rows and clear `isStreaming`.
- [ ] Keep `BusyRuntimeError` in the same model: visible notice may dedupe, repair must not.
- [ ] Simplify `src/sessions/session-notices.ts` into notice helpers or migrate the repair logic fully into `AgentHost`.
- [ ] Remove runtime-error persistence from `src/hooks/use-runtime-session.ts`.
- [ ] Update tests for repeated-fingerprint recovery, including repeated `runtime_busy`.

### Phase 7. Delete bootstrap-only state and UI branches

- [ ] Remove `BootstrapStatus` from `src/types/storage.ts`.
- [ ] Remove `normalizeBootstrapStatus()` from `src/sessions/session-service.ts`.
- [ ] Delete `src/sessions/session-bootstrap.ts`.
- [ ] Delete `src/sessions/chat-bootstrap-ui.ts`.
- [ ] Remove bootstrap-only rendering branches from `src/components/chat.tsx`.
- [ ] Replace first-send path in `src/components/chat.tsx` with:
- [ ] build in-memory session
- [ ] `await runtimeClient.startInitialTurn(session, content)`
- [ ] navigate to `sessionDestination(...)`
- [ ] Ensure route transition still works for repo-backed sessions.
- [ ] Update tests that currently assert `"bootstrap"` / `"failed"` / `"ready"` behavior.

### Phase 8. Add liveness watchdog + stale-stream backstop

- [ ] Track `lastProgressAt` inside `AgentHost`.
- [ ] Update it only on real liveness signals:
- [ ] agent events that indicate progress
- [ ] assistant stream deltas
- [ ] tool-result / turn-boundary events if they are emitted during long tool phases
- [ ] Start an idle watchdog when background turn execution starts.
- [ ] Abort the turn if there has been no progress for the configured threshold.
- [ ] Optionally keep a second hard max duration cap if needed.
- [ ] Clear watchdog state in every terminal path.
- [ ] Keep `reconcileInterruptedSession(...)` or equivalent for init-time stale recovery.
- [ ] Add optional focus/visibility backstop in the UI only as stale-worker recovery, not as the primary correctness path.
- [ ] Add fake-timer tests for idle watchdog behavior.

### Phase 9. Simplify UI runtime hook and failure surfacing

- [ ] Change `src/hooks/use-runtime-session.ts` so it no longer writes system notices.
- [ ] Let runtime-command failures bubble to the caller or convert to a typed UI result.
- [ ] In `src/components/chat.tsx`, show `toast.error(...)` for catastrophic client-side runtime failures.
- [ ] Keep console logging with session id for local debugging.
- [ ] Document one limit clearly: if Dexie itself cannot persist, the app can only surface the failure locally.

### Phase 10. Test cleanup and migration cleanup

- [ ] Delete tests that exist only for `bootstrapStatus` behavior.
- [ ] Update mocks that still expect `runtimeClient.send(...)`.
- [ ] Add focused worker-contract tests instead of relying on broad integration smoke only.
- [ ] Remove dead imports, dead helpers, and any now-unused compatibility code.
- [ ] Re-run targeted test set for touched files.

---

## File-Level Change Map

### `src/agent/runtime-worker-types.ts`

- remove `send`
- add `initFromStorage`
- add `initFromSession`
- add `startTurn`

### `src/agent/runtime-client.ts`

- keep per-session worker map
- add `startTurn`
- add `startInitialTurn`
- keep `ensureSession` only if still needed after migration; likely delete

### `src/agent/runtime-worker-api.ts`

- add serialized lifecycle queue
- split init path: storage vs in-memory session
- delegate to `host.startTurn(...)`
- keep worker-side stale reconcile

### `src/agent/agent-host.ts`

- absorb `SessionPersistence`
- own turn start
- own background completion
- own repair
- own notice append
- own watchdog

### `src/agent/session-persistence.ts`

- migrate code into `AgentHost`
- delete file

### `src/sessions/session-actions.ts`

- add pure in-memory session builders or switch existing helpers to pure builders
- stop persisting first-send sessions up front

### `src/sessions/session-service.ts`

- remove `bootstrapStatus` normalization
- keep `buildPersistedSession(...)`
- ensure session persistence works when first durable write is prompt start

### `src/sessions/session-notices.ts`

- reduce to notice-row helpers only, or merge entirely into `AgentHost`
- no repair coupling

### `src/hooks/use-runtime-session.ts`

- stop appending session notices
- return/throw command failure cleanly

### `src/components/chat.tsx`

- remove bootstrap-only branch
- first send uses `startInitialTurn`
- existing send uses `startTurn`
- toast catastrophic client failures

### `src/types/storage.ts`

- remove `BootstrapStatus`
- remove `bootstrapStatus` from `SessionData`

---

## Verification Matrix

### Automated

- [ ] same-session concurrent init from two ports in shared-worker mode
- [ ] `startTurn()` resolves after durable prompt start, before turn completion
- [ ] first send creates no durable empty session shell
- [ ] first send navigates successfully after `startInitialTurn()`
- [ ] repeated same-fingerprint failure still clears streaming state
- [ ] repeated `BusyRuntimeError` does not rely on notice insertion to repair state
- [ ] `handleEvent()` persistence throw still clears streaming state
- [ ] idle watchdog aborts only after no progress threshold
- [ ] init-time stale-stream reconcile repairs orphaned streaming session

### Manual smoke

- [ ] open same session in two tabs with `SharedWorker` support
- [ ] send first prompt from an empty chat and navigate immediately
- [ ] hammer send twice during active streaming
- [ ] switch tabs / background / refocus during a long stream
- [ ] kill network mid-stream
- [ ] simulate worker teardown mid-stream, reload, verify stale repair

---

## Ship Criteria

Ship when all of these are true:

- there is one runtime lifecycle owner: the worker-side host
- there is one send contract: durable-start, not full-turn completion
- there is no persisted provisional bootstrap session
- `bootstrapStatus` is gone
- repeated same-fingerprint failures cannot leave `isStreaming = true`
- UI does not write runtime system notices
- hung turns eventually terminate and repair state
- targeted tests for each diagnosed failure mode pass

---

## Follow-Ups After This Refactor

- idle worker-handle eviction in `RuntimeClient`
- explicit storage-failure UX for Dexie quota/corruption
- stress testing for multi-writer Dexie behavior under tab churn
- possible further simplification of repo/runtime error plumbing after lifecycle ownership is stable
