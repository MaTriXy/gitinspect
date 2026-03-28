# Runtime State Simplification Plan

Date: 2026-03-27

Goal:

- remove the prompt-beneath error display entirely
- make first-send + stream recovery explicit
- keep the worker model simple
- make errors data-driven, persisted, chat-visible
- fix stuck `isStreaming` without adding a lot of runtime machinery

Non-goal:

- do **not** build a global runtime manager now
- do **not** add heartbeats / leases unless proven necessary
- do **not** keep two user-facing error channels

Core decision:

- add one persisted bootstrap primitive
- keep `isStreaming`
- use one persisted system-notice pipeline for **all** user-visible runtime errors
- reconcile orphaned streaming state on worker init

Why this shape:

- current code already has a good persisted error UI for `system` rows:
  - `src/components/chat-message.tsx`
  - `src/types/chat.ts`
- current code still has a second, ad hoc prompt error channel:
  - `src/components/chat-composer.tsx`
  - `src/hooks/use-runtime-session.ts`
  - `src/components/chat.tsx`
- current code already has the real durability threshold:
  - `AgentHost.prompt()` calls `persistPromptStart(...)` before the model prompt
  - `src/agent/agent-host.ts:107-207`
  - `src/agent/session-persistence.ts:209-221`

So:

- the simplest correct fix is not "more guards"
- the fix is "make session bootstrap explicit, route all user-visible failures into persisted `system` rows, reconcile stale streaming at init"

---

## TL;DR implementation

1. Add `bootstrapStatus: "bootstrap" | "ready" | "failed"` to `SessionData`.
2. Create one persisted notice appender, reusable from UI, worker init, and `AgentHost`.
3. Delete `ChatComposer.error`.
4. Delete `useRuntimeSession().error`.
5. Move first-send orchestration into `bootstrapSessionAndSend(...)`.
6. Promote session to `ready` only after `persistPromptStart(...)` succeeds.
7. On worker init, if persisted session says `isStreaming === true` but there is no live host for that session, reconcile it immediately:
   - clear `isStreaming`
   - convert any streaming assistant row to terminal error
   - append a system notice
8. Retry / delete UX can come after. First pass: always show failure in chat, never under the prompt.

---

## Evidence from code

### 1. We already have two error channels. that is the root UI smell.

Prompt-level error channel:

- `src/components/chat-composer.tsx`
- `src/hooks/use-runtime-session.ts`
- `src/components/chat.tsx`

Current code:

```ts
// src/components/chat-composer.tsx
{props.error ? (
  <div className="text-xs text-destructive">{props.error}</div>
) : null}
```

and:

```ts
// src/hooks/use-runtime-session.ts
const [actionError, setActionError] = React.useState<string | undefined>(undefined)
...
return {
  abort,
  error: actionError,
  send,
  setModelSelection,
  setThinkingLevel,
}
```

Persisted in-chat error channel:

- `src/types/chat.ts`
- `src/components/chat-message.tsx`
- `src/agent/runtime-errors.ts`

Current code:

```ts
export interface SystemMessage {
  id: string
  role: "system"
  timestamp: number
  kind: string
  severity: "error" | "warning" | "info"
  source: "github" | "provider" | "runtime"
  message: string
  action?: "open-github-settings"
}
```

This second channel is the correct one. keep it. expand it. delete the first.

### 2. The true bootstrap boundary already exists.

Current code:

```ts
// src/agent/agent-host.ts
await this.persistence.persistPromptStart(userRow, assistantRow)
await this.agent.prompt(userMessage)
```

and:

```ts
// src/agent/session-persistence.ts
async persistPromptStart(userRow: MessageRow, assistantRow: MessageRow) {
  await this.persistSessionBoundary(
    {
      error: undefined,
      isStreaming: true,
    },
    [userRow, assistantRow],
    [...this.buildCompletedRows(), userRow, assistantRow]
  )
}
```

This is the right promotion point. not session creation.

### 3. Worker ownership is already per-session.

Current code:

```ts
// src/agent/runtime-client.ts
name: `gitinspect-session-${sessionId}`
```

and:

```ts
// src/agent/runtime-worker-api.ts
let host: AgentHost | undefined
let activeSessionId: string | undefined
```

Conclusion:

- one worker per session id
- one host per worker instance
- do not add a global session-map worker now

### 4. Stuck `isStreaming` already exists as a real failure mode.

Current code has a safety net:

```ts
// src/agent/agent-host.ts
if (!this.isDisposed() && this.session.isStreaming) {
  this.session = {
    ...this.session,
    isStreaming: false,
    updatedAt: getIsoNow(),
  }
  await putSession(this.session)
}
```

This is useful, but incomplete:

- it only runs after `prompt()` returns
- it does not help if worker dies
- it does not help if page reloads mid-stream
- it does not help if bootstrap fails before normal runtime settles

Need a data-driven reconcile step at worker init.

---

## Design

### A. Add one bootstrap primitive

Add:

```ts
export type BootstrapStatus = "bootstrap" | "failed" | "ready"
```

to `src/types/storage.ts`:

```ts
export interface SessionData {
  bootstrapStatus: BootstrapStatus
  cost: number
  createdAt: string
  error?: string
  id: string
  isStreaming: boolean
  ...
}
```

Rules:

- `bootstrap`
  - provisional session shell
  - first prompt not durably persisted yet
- `ready`
  - `persistPromptStart(...)` succeeded at least once
  - normal session behavior
- `failed`
  - bootstrap failed before promotion
  - session remains visible
  - user-visible failure appears as a system message in chat

Keep `isStreaming`. do not invent a second streaming state enum.

Why:

- simplest new primitive
- enough to model first-send correctly
- no extra heartbeat / lease state yet

### B. One error surface. persisted `system` rows only.

All user-visible runtime failures should become persisted `system` rows:

- provider failures
- repo failures
- worker init failures
- worker transport failures
- missing session runtime
- busy session mutations
- bootstrap failures
- interrupted stream recovery
- repo default-branch resolution failures

Delete the prompt-level error surface:

- delete `error?: string` from `ChatComposer`
- delete the red text beneath the prompt
- stop feeding `runtime.error ?? activeSession.error` into the prompt area
- stop storing `actionError` in `useRuntimeSession`

User-visible errors go into chat. nowhere else.

### C. Replace `RuntimeNoticeService` with persisted dedupe

Current code:

- `src/agent/runtime-notice-service.ts`

It dedupes in memory per host:

```ts
private readonly fingerprints: Array<string> = []
```

This is too local:

- dedupe resets on reload
- UI-originated errors cannot use the same path
- worker-init recovery cannot use the same path

Simpler long-term:

1. add `fingerprint` to `SystemMessage`
2. persist it
3. dedupe by looking at existing persisted `system` rows for the session
4. delete `RuntimeNoticeService`

Proposed shape:

```ts
export interface SystemMessage {
  id: string
  role: "system"
  timestamp: number
  kind: string
  severity: "error" | "warning" | "info"
  source: "github" | "provider" | "runtime"
  message: string
  fingerprint: string
  action?: "open-github-settings"
}
```

Then introduce one helper:

```ts
async function appendSessionNotice(
  sessionId: string,
  error: unknown,
  options?: {
    clearStreaming?: boolean
    bootstrapStatus?: BootstrapStatus
    rewriteStreamingAssistant?: boolean
  }
): Promise<void>
```

Responsibilities:

- classify error via `classifyRuntimeError(...)`
- build `SystemMessage`
- load session + messages
- no-op if same fingerprint already present in recent/persisted system rows
- optionally rewrite any streaming assistant row to terminal error
- optionally clear `isStreaming`
- optionally update `bootstrapStatus`
- persist everything in one transaction

This becomes the only path for persisted runtime notices.

### D. Reconcile orphaned streaming on worker init. no heartbeat yet.

Do **not** add heartbeat / lease in first pass.

Why:

- too much state
- current runtime is already per-session worker
- worker init is enough to detect the important broken case

Simple invariant:

- if a new worker instance loads a session from Dexie and sees `session.isStreaming === true`, the previous runtime is gone
- therefore streaming is orphaned
- reconcile immediately

This is safe because:

- if the runtime is actually still alive, `runtime-worker-api.init(id)` returns early:

```ts
if (host && activeSessionId === id) {
  return true
}
```

So reconciliation only runs when there is **not** already a live host in this worker.

Implementation in `src/agent/runtime-worker-api.ts`:

```ts
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

  if (!loaded) {
    activeSessionId = undefined
    return false
  }

  if (loaded.session.isStreaming) {
    await reconcileInterruptedSession(id, loaded)
    const reloaded = await loadSessionWithMessages(id)
    if (!reloaded) {
      activeSessionId = undefined
      return false
    }
    loaded = reloaded
  }

  host = new AgentHost(loaded.session, loaded.messages, ...)
  return true
}
```

`reconcileInterruptedSession(...)` should:

- convert any `status: "streaming"` assistant row into terminal `error`
- set `stopReason: "error"`
- set a useful `errorMessage`, ex: `"Stream interrupted. The runtime stopped before completion."`
- clear `session.isStreaming`
- clear `session.error`
- leave `bootstrapStatus` as:
  - `failed` if it was `bootstrap`
  - `ready` otherwise
- append a runtime system message

This fixes:

- page reload during stream
- worker crash / browser kill
- transport disconnect followed by fresh init
- stale `isStreaming` rows from previous broken runs

### E. Introduce `bootstrapSessionAndSend(...)`

Current orchestration is spread across:

- `src/components/chat.tsx`
- `src/sessions/session-actions.ts`
- `src/agent/runtime-client.ts`

Move first-send into one coordinator.

New file:

- `src/sessions/session-bootstrap.ts`

Shape:

```ts
export async function bootstrapSessionAndSend(params: {
  content: string
  draft: SessionCreationBase
  repoTarget?: RepoTarget
}): Promise<SessionData> {
  const repoSource =
    params.repoTarget ? await resolveRepoSource(params.repoTarget) : undefined

  const session = repoSource
    ? await createSessionForRepo({
        base: params.draft,
        owner: repoSource.owner,
        ref: repoSource.ref,
        repo: repoSource.repo,
      })
    : await createSessionForChat(params.draft)

  await persistSessionSnapshot({
    ...session,
    bootstrapStatus: "bootstrap",
  })

  try {
    await runtimeClient.send(session.id, params.content)
    return session
  } catch (error) {
    await appendSessionNotice(session.id, error, {
      bootstrapStatus: "failed",
      clearStreaming: true,
      rewriteStreamingAssistant: true,
    })
    throw error
  }
}
```

But:

- **do not** keep the thrown error for prompt rendering
- UI catches only for control flow, not for user-visible display

Why centralize:

- removes `draftError`
- removes `repoResolutionError`
- removes ad hoc detached-send cleanup logic
- gives one place to own first-send transitions

### F. Promote to `ready` inside `persistPromptStart(...)`

Smallest correct place:

- inside `SessionPersistence.persistPromptStart(...)`

Current code already persists the first durable prompt rows there.

Change:

```ts
async persistPromptStart(userRow: MessageRow, assistantRow: MessageRow): Promise<void> {
  await this.persistSessionBoundary(
    {
      bootstrapStatus: "ready",
      error: undefined,
      isStreaming: true,
    },
    [userRow, assistantRow],
    [...this.buildCompletedRows(), userRow, assistantRow]
  )
}
```

Need to widen `persistSessionBoundary(...)` to accept `bootstrapStatus`.

That keeps promotion close to the real durability event.

### G. UI state rules

Use data from Dexie only.

Do not infer from side effects.

Rules:

- `bootstrapStatus === "bootstrap"`:
  - show "Starting session..."
  - do **not** show the normal empty state
- `bootstrapStatus === "failed"`:
  - show chat transcript with system notice
  - composer remains usable for retry
- `bootstrapStatus === "ready" && messages.length === 0`:
  - normal empty state
- `isStreaming === true`:
  - show streaming controls

Minimal `Chat` change:

```ts
if (activeSession?.bootstrapStatus === "bootstrap") {
  return <LoadingState label="Starting session..." />
}
```

Then delete:

- `draftError`
- `repoResolutionError`
- `currentError`

### H. Transport failure handling in `RuntimeClient`

Need one extra simplification:

- if a cached worker handle throws a transport-level error, drop the handle immediately
- next call will create a fresh worker and `init(...)`
- fresh init will reconcile stale streaming if needed

Add helper:

```ts
function isWorkerTransportError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.includes("disposed") ||
    error.message.includes("closed") ||
    error.message.includes("port") ||
    error.message.includes("Worker")
  )
}
```

Then in `RuntimeClient.call(...)`:

```ts
try {
  return await invoke(handle.api)
} catch (error) {
  if (isWorkerTransportError(error)) {
    this.terminateHandle(handle)
    this.workers.delete(sessionId)
  }

  if (error instanceof Error) {
    throw reviveRuntimeCommandError(error, sessionId)
  }

  throw error
}
```

No retry in first pass. keep simple.

Why enough:

- the handle is dropped
- next action recreates worker
- recreated worker reconciles stale stream state

### I. Extend runtime error classification

Current `runtime-errors.ts` covers:

- GitHub auth / rate limit / not found / permission
- provider connection
- repo network
- unknown runtime

Need new explicit kinds:

```ts
type RuntimeErrorKind =
  | "bootstrap_failed"
  | "missing_session"
  | "runtime_busy"
  | "stream_interrupted"
  | ...existing
```

Map:

- `BusyRuntimeError` -> `runtime_busy`, severity `info` or `warning`
- `MissingSessionRuntimeError` -> `missing_session`, severity `error`
- orphaned streaming reconcile -> `stream_interrupted`, severity `error`
- repo default-branch resolution / first-send bootstrap failures -> `bootstrap_failed`, severity `error`

This keeps chat messages specific and actionable.

---

## File-by-file plan

### 1. `src/types/storage.ts`

Add:

```ts
export type BootstrapStatus = "bootstrap" | "failed" | "ready"
```

Update:

```ts
export interface SessionData {
  bootstrapStatus: BootstrapStatus
  ...
}
```

### 2. `src/types/chat.ts`

Add persisted fingerprint:

```ts
export interface SystemMessage {
  ...
  fingerprint: string
}
```

### 3. `src/sessions/session-service.ts`

Set default on create:

```ts
return {
  bootstrapStatus: "ready",
  ...
}
```

Rationale:

- old/non-bootstrap sessions default to normal
- first-send coordinator explicitly downgrades provisional sessions to `"bootstrap"`

### 4. `src/agent/session-persistence.ts`

Change `persistSessionBoundary(...)` override type from:

```ts
Pick<SessionData, "error" | "isStreaming">
```

to:

```ts
Pick<SessionData, "bootstrapStatus" | "error" | "isStreaming">
```

Use it in:

- `persistPromptStart(...)` -> set `bootstrapStatus: "ready"`
- normal final boundaries -> preserve current status unless explicitly changing

### 5. `src/agent/runtime-errors.ts`

Add missing runtime kinds.

Ensure `buildSystemMessage(...)` includes `fingerprint`.

### 6. `src/sessions/session-notices.ts` or `src/agent/session-notices.ts`

New file. one helper module.

Functions:

- `appendSessionNotice(...)`
- `reconcileInterruptedSession(...)`

Put all persisted error-side effects here.

### 7. `src/agent/runtime-notice-service.ts`

Delete.

Replace `AgentHost.appendSystemNoticeFromError(...)` usage with the new persisted helper.

### 8. `src/agent/agent-host.ts`

Changes:

- no `RuntimeNoticeService`
- call persisted notice helper directly
- keep current safety net
- keep host lean; no bootstrap orchestration here

### 9. `src/agent/runtime-worker-api.ts`

Changes:

- reconcile stale `isStreaming` during `init(...)`
- if bootstrap session loads in broken streaming state, mark failed and append notice before creating host

### 10. `src/agent/runtime-client.ts`

Changes:

- drop broken handles on worker transport error
- keep per-session worker naming
- no global worker refactor

### 11. `src/hooks/use-runtime-session.ts`

Delete `actionError` state.

New shape:

```ts
export function useRuntimeSession(sessionId: string | undefined) {
  const runMutation = React.useEffectEvent(async (...) => {
    if (!sessionId) return
    try {
      await action(sessionId)
    } catch (error) {
      await appendSessionNotice(sessionId, error)
    }
  })
  ...
  return { abort, send, setModelSelection, setThinkingLevel }
}
```

Important:

- model/thinking/runtime errors become chat notices too
- no prompt-local error string anymore

### 12. `src/components/chat-composer.tsx`

Delete:

- `error?: string`
- `submitStatus` error branch
- red error text beneath prompt

Target:

```ts
const submitStatus: ChatStatus =
  props.isStreaming ? "streaming" : "ready"
```

### 13. `src/components/chat.tsx`

Delete:

- `draftError`
- `repoResolutionError`
- `currentError`
- `persistDetachedSendError(...)`

Replace first-send path with `bootstrapSessionAndSend(...)`.

Use persisted `bootstrapStatus` for UI branching.

### 14. `src/sessions/session-bootstrap.ts`

New file.

Own:

- repo resolution
- provisional session creation
- bootstrap state persist
- first send dispatch
- bootstrap failure notice persist

This file is the biggest simplification win.

---

## State transitions

### Session lifecycle

```text
create provisional session
  -> bootstrap / isStreaming=false

runtime send starts, worker init ok
  -> bootstrap / isStreaming=false

persistPromptStart succeeds
  -> ready / isStreaming=true

normal completion
  -> ready / isStreaming=false

normal provider/repo/runtime error after prompt persisted
  -> ready / isStreaming=false + system message

bootstrap failure before persistPromptStart
  -> failed / isStreaming=false + system message

worker reload/crash while persisted session says isStreaming=true
  -> reconcile on next init
  -> ready|failed / isStreaming=false + system message
```

### Why no lease/heartbeat in v1

Because this is enough:

- worker is already per session
- new worker init is already the reconstruct boundary
- `init()` can detect stale persisted streaming

Heartbeat adds more state than needed right now.

---

## Migration + compatibility

Need Dexie version bump for `sessions` store shape if required by existing codepath.

But because `bootstrapStatus` is a field inside the value, not an indexed key, migration can stay simple:

- old sessions load with `bootstrapStatus ?? "ready"`
- normalize on load if missing

Add to session normalization path:

```ts
function normalizeBootstrapStatus(
  session: SessionData
): SessionData {
  return {
    ...session,
    bootstrapStatus: session.bootstrapStatus ?? "ready",
  }
}
```

Apply in:

- `loadSession`
- `loadMostRecentSession`
- `buildPersistedSession`
- any bootstrap/reconcile helper

---

## Tests

### Add / update tests for:

1. bootstrap promotion

```text
create session -> bootstrap
persistPromptStart -> ready + isStreaming=true
```

2. bootstrap failure

```text
session created
runtime send fails before prompt persistence
session becomes failed
system notice appended
no prompt-level error string used
```

3. worker init stale streaming reconcile

```text
persisted session has isStreaming=true
worker init loads it with no existing host
streaming assistant row rewritten to error
system notice appended
session.isStreaming cleared
```

4. transport failure on cached handle

```text
cached worker call throws transport error
client drops handle
next call creates new worker
```

5. no prompt error UI

```text
ChatComposer never renders error text beneath prompt
runtime/user-visible failures only appear as chat system rows
```

6. busy mutation shown in chat

```text
setModelSelection during stream -> system notice row
no prompt-local error
```

---

## Sequence snippets

### First send, success

```ts
const session = await createSessionForRepo(...)

await persistSessionSnapshot({
  ...session,
  bootstrapStatus: "bootstrap",
})

await runtimeClient.send(session.id, content)

// AgentHost.persistPromptStart(...)
await this.persistSessionBoundary(
  {
    bootstrapStatus: "ready",
    error: undefined,
    isStreaming: true,
  },
  [userRow, assistantRow],
  ...
)
```

### First send, bootstrap failure

```ts
try {
  await runtimeClient.send(session.id, content)
} catch (error) {
  await appendSessionNotice(session.id, error, {
    bootstrapStatus: "failed",
    clearStreaming: true,
    rewriteStreamingAssistant: true,
  })
}
```

### Worker init stale stream reconcile

```ts
if (loaded.session.isStreaming) {
  await reconcileInterruptedSession(id, loaded)
  loaded = await loadSessionWithMessages(id)
}
```

---

## Explicit simplifications. keep these.

Do:

- add `bootstrapStatus`
- keep `isStreaming`
- one persisted notice helper
- reconcile on worker init
- delete prompt-local errors
- keep per-session worker model

Do **not** do now:

- global worker host map
- background daemon semantics
- heartbeat / lease tables
- multi-step retry orchestration in v1
- extra UI error surfaces

---

## End state

After this plan:

- every user-visible runtime failure is a persisted chat message
- prompt area has no error banner
- first-send lifecycle is explicit
- stuck `isStreaming` is reconciled data-first
- worker model stays simple
- LOC goes down in UI/runtime glue

This is the smallest plan that fixes the real state-transition bugs, instead of layering more watchdogs on top.

---

## TODO checklist

Legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` done

### Phase 0. lock the target behavior

- [x] confirm final invariants in code comments at top of the implementation PR / patch:
  - [x] no prompt-beneath error UI
  - [x] all user-visible runtime failures become persisted chat rows
  - [x] bootstrap session is not treated like a normal empty chat
  - [x] stuck `isStreaming` is reconciled on worker init
  - [x] keep per-session worker model
- [x] re-read current call sites before edits:
  - [x] `src/components/chat.tsx`
  - [x] `src/components/chat-composer.tsx`
  - [x] `src/hooks/use-runtime-session.ts`
  - [x] `src/agent/runtime-client.ts`
  - [x] `src/agent/runtime-worker-api.ts`
  - [x] `src/agent/agent-host.ts`
  - [x] `src/agent/session-persistence.ts`

### Phase 1. add the new persisted primitives

- [x] update `src/types/storage.ts`
  - [x] add `BootstrapStatus = "bootstrap" | "failed" | "ready"`
  - [x] add `bootstrapStatus` to `SessionData`
- [x] update `src/types/chat.ts`
  - [x] add `fingerprint` to `SystemMessage`
- [x] update session normalization so old rows remain valid
  - [x] add helper to default missing `bootstrapStatus` to `"ready"`
  - [x] use helper in `src/sessions/session-service.ts`
  - [x] use helper in any session read/normalize path
- [x] verify Dexie schema impact
  - [x] confirm `bootstrapStatus` is not needed as an index
  - [x] confirm no store version bump is required for a non-indexed field

### Phase 2. make bootstrap explicit in session creation

- [x] update `src/sessions/session-service.ts`
  - [x] ensure newly created normal sessions default to `bootstrapStatus: "ready"`
- [x] create new orchestration module
  - [x] add `src/sessions/session-bootstrap.ts`
  - [x] define `bootstrapSessionAndSend(...)`
  - [x] move repo resolution into the coordinator
  - [x] move provisional session creation into the coordinator
  - [x] persist `bootstrapStatus: "bootstrap"` before first send
  - [x] call `runtimeClient.send(...)` from the coordinator
  - [x] on bootstrap failure, persist failure notice + state transition
- [x] update `src/components/chat.tsx`
  - [x] replace first-send orchestration with `bootstrapSessionAndSend(...)`
  - [x] remove old detached first-send cleanup path
  - [x] remove bootstrap-specific local error bookkeeping

### Phase 3. promote bootstrap only at the real durability boundary

- [x] update `src/agent/session-persistence.ts`
  - [x] widen `persistSessionBoundary(...)` override type to include `bootstrapStatus`
  - [x] update internal merge logic to preserve / override bootstrap state correctly
  - [x] change `persistPromptStart(...)` to set `bootstrapStatus: "ready"`
  - [x] make sure later persistence paths do not accidentally reset `"failed"` to `"ready"`
- [x] update `src/agent/agent-host.ts`
  - [x] verify no direct session writes bypass the new bootstrap semantics
  - [x] verify prompt-start path is still the first durable conversation boundary

### Phase 4. delete the prompt-level error channel

- [x] update `src/components/chat-composer.tsx`
  - [x] remove `error?: string` prop
  - [x] remove prompt error rendering under the input
  - [x] simplify submit status to `ready | streaming`
- [x] update `src/hooks/use-runtime-session.ts`
  - [x] remove `actionError` state
  - [x] remove `error` from the returned hook object
  - [x] on mutation failure, route through persisted session-notice path instead
- [x] update `src/components/chat.tsx`
  - [x] remove `currentError`
  - [x] remove `draftError`
  - [x] remove `repoResolutionError` as a prompt-surface concern
  - [x] ensure repo resolution failures also become persisted notices when tied to a session
- [x] search for remaining prompt-level error consumers
  - [x] `rg -n "error\\?: string|runtime.error|draftError|currentError|actionError" src tests`
  - [x] remove or rewrite them

### Phase 5. unify runtime notices into one persisted path

- [x] create new helper module
  - [x] add `src/agent/session-notices.ts` or `src/sessions/session-notices.ts`
  - [x] implement `appendSessionNotice(sessionId, error, options?)`
  - [x] load session + messages inside helper
  - [x] classify with `classifyRuntimeError(...)`
  - [x] build persisted `SystemMessage`
  - [x] dedupe by persisted `fingerprint`
  - [x] optionally clear `isStreaming`
  - [x] optionally rewrite streaming assistant row
  - [x] optionally update `bootstrapStatus`
  - [x] persist in one transaction
- [x] delete `src/agent/runtime-notice-service.ts`
- [x] update `src/agent/agent-host.ts`
  - [x] remove `RuntimeNoticeService` dependency
  - [x] replace `appendSystemNoticeFromError(...)` implementation with call into persisted helper
  - [x] verify repo tool errors still land in chat as `system` rows
- [x] update any UI-side runtime failure path
  - [x] `useRuntimeSession`
  - [x] bootstrap coordinator
  - [x] worker-init reconciliation

### Phase 6. extend runtime error classification

- [x] update `src/agent/runtime-errors.ts`
  - [x] add `bootstrap_failed`
  - [x] add `missing_session`
  - [x] add `runtime_busy`
  - [x] add `stream_interrupted`
  - [x] decide severity for each new kind
  - [x] decide `source` for each new kind
  - [x] decide CTA behavior, if any
- [x] update `buildSystemMessage(...)`
  - [x] include `fingerprint`
- [x] update tests in `tests/runtime-errors.test.ts`
  - [x] add coverage for `BusyRuntimeError`
  - [x] add coverage for `MissingSessionRuntimeError`
  - [x] add coverage for stream interruption classification
  - [x] add coverage for bootstrap failure classification

### Phase 7. reconcile stale `isStreaming` at worker init

- [x] update `src/agent/runtime-worker-api.ts`
  - [x] add `reconcileInterruptedSession(...)` helper or import it
  - [x] after `loadSessionWithMessages(id)`, check `loaded.session.isStreaming`
  - [x] if true and no existing live host for this session, reconcile before constructing `AgentHost`
  - [x] reload session/messages after reconciliation
  - [x] keep existing early-return behavior for already-live host
- [x] define exact reconcile behavior
  - [x] clear `session.isStreaming`
  - [x] if `bootstrapStatus === "bootstrap"`, set to `"failed"`
  - [x] otherwise leave / normalize to `"ready"`
  - [x] rewrite any assistant row with `status: "streaming"` to terminal `error`
  - [x] attach a useful `errorMessage`
  - [x] append a persisted `stream_interrupted` system notice
- [x] verify reconcile path is idempotent
  - [x] repeated init should not append duplicate notices
  - [x] repeated init should not keep rewriting rows unnecessarily

### Phase 8. harden worker client lifecycle with minimal logic

- [x] update `src/agent/runtime-client.ts`
  - [x] add worker transport error detection helper
  - [x] on transport failure, terminate handle
  - [x] remove broken handle from cache
  - [x] keep thrown error semantics unchanged for callers
- [x] verify no retry loop in first pass
  - [x] next user action should recreate worker naturally
- [x] verify `releaseSession(...)` behavior still works
  - [x] delete flow
  - [x] session switch flow

### Phase 9. make UI rendering fully data-driven

- [x] update `src/components/chat.tsx`
  - [x] if `bootstrapStatus === "bootstrap"`, show startup loading state
  - [x] if `bootstrapStatus === "failed"`, show transcript + composer, not the normal empty state
  - [x] if `bootstrapStatus === "ready"` and no messages, show normal empty state
  - [x] preserve streaming UI from persisted `isStreaming`
- [x] verify `src/components/chat-message.tsx` already handles new `system` rows without extra branches
- [x] verify no fallback UI depends on ephemeral hook error state anymore

### Phase 10. remove dead code and old assumptions

- [x] delete `persistDetachedSendError(...)` if obsolete
- [x] remove old runtime error plumbing in `src/components/chat.tsx`
- [x] remove `RuntimeNoticeService` references
- [x] remove dead tests for prompt-level error rendering, if any
- [x] search for stale state assumptions
  - [x] `rg -n "isStreaming.*false|session.error|draftError|RuntimeNoticeService|persistDetachedSendError|bootstrapStatus" src tests`
  - [x] clean up any now-invalid branches

### Phase 11. tests

- [x] update existing tests for `SessionData` shape
  - [x] `tests/session-actions.test.ts`
  - [x] `tests/chat-first-send.test.tsx`
  - [x] `tests/agent-host-persistence.test.ts`
  - [x] `tests/runtime-client.test.ts`
- [x] add unit tests for bootstrap transitions
  - [x] create session -> bootstrap
  - [x] `persistPromptStart(...)` -> ready
  - [x] bootstrap failure -> failed + system row
- [x] add unit tests for persisted notice helper
  - [x] dedupe by fingerprint
  - [x] clear `isStreaming`
  - [x] rewrite streaming assistant row
  - [x] preserve existing completed rows
- [x] add worker-init reconciliation tests
  - [x] stale `isStreaming` session is repaired on `init(...)`
  - [x] no duplicate notice on repeated `init(...)`
  - [x] bootstrap session interrupted before ready becomes failed
- [x] add UI tests
  - [x] no prompt-beneath error text
  - [x] `bootstrap` shows startup state
  - [x] `failed` shows in-chat system notice
  - [x] normal empty chat only when `ready` and empty
- [x] add runtime transport failure test
  - [x] broken cached worker handle gets dropped
  - [x] subsequent send re-inits worker

### Phase 12. verification

- [x] run targeted tests:
  - [x] `bun run test tests/runtime-client.test.ts tests/agent-host-persistence.test.ts`
  - [x] bootstrap / chat tests added in this change
- [x] run broader tests if stable
  - [x] runtime-related
  - [x] chat-related
- [x] run `bun run typecheck`
- [x] note any pre-existing unrelated typecheck failures separately
- [x] manually inspect the final UX behavior in code:
  - [x] no prompt-level error rendering path remains
  - [x] all failure paths write to chat
  - [x] bootstrap is explicit in session state
  - [x] stale streaming is repaired on re-entry

### Phase 13. optional follow-ups, explicitly deferred

- [ ] retry CTA for failed bootstrap sessions
- [ ] delete/discard CTA for failed bootstrap sessions
- [ ] idle worker release policy on session switch
- [ ] global runtime manager worker with `Map<sessionId, AgentHost>`
- [ ] heartbeat / lease if worker-init reconciliation proves insufficient
