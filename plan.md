# Event-sourced turn plan: kill orphaned tool results + stop snapshot reconstruction

## intent

Adopt the **bigger but simpler** design fully.

Do this:

- persist exact `message_end` events into transcript
- persist exact assistant `message_start/message_update` partial into runtime
- stop reconstructing transcript from snapshots
- stop using transcript repair as the steady-state mechanism
- keep Dexie livequery UX
- no UX regression

Legacy exception only:

- do **one-time repair-on-read with write-back** for historical bad rows already in Dexie
- that is migration hygiene, not runtime architecture

---

## hard requirements

1. **no UX regression**
2. **no transcript `streaming` rows** in steady state
3. **one ownership law** for tool results: assistant `toolCall.id`
4. **one view-model selector** for chat UI
5. **runtime phase** becomes primary state truth
6. **legacy repair-on-read** remains, but only as migration cleanup

---

## why this is the right cut. evidence first

## 1. current UI already reads Dexie from more than one place

`packages/ui/src/components/chat.tsx:148-168`

```ts
const loadedSessionState = useLiveQuery(async (): Promise<LoadedSessionState> => {
  const loaded = await loadSessionWithMessages(props.sessionId);
  return {
    kind: "active",
    messages: loaded.messages,
    session: loaded.session,
  };
}, [props.sessionId]);

const sessionRuntime = useLiveQuery(
  async () => (props.sessionId ? await getSessionRuntime(props.sessionId) : undefined),
  [props.sessionId],
);
```

`packages/ui/src/components/chat.tsx:231-259`

```ts
const messages = loadedSessionState?.kind === "active" ? loadedSessionState.messages : [];
...
const activeSessionViewState = React.useMemo(
  () =>
    activeSession
      ? deriveActiveSessionViewState({
          hasLocalRunner: runtimeClient.hasActiveTurn(activeSession.id),
          hasPartialAssistantText,
          lastProgressAt: sessionRuntime?.lastProgressAt,
          leaseState: ownership,
          runtimeStatus: sessionRuntime?.status,
          sessionIsStreaming: activeSession.isStreaming,
        })
      : undefined,
```

Fact:

- UI already depends on transcript + runtime + in-memory local runner.
- So moving streaming state from transcript to runtime is not a new UI concept.

## 2. transcript currently stores in-flight state. this is the architectural smell

`packages/db/src/storage-types.ts:47-71`

```ts
export interface SessionData {
  ...
  isStreaming: boolean;
}

export type MessageStatus = "aborted" | "completed" | "error" | "streaming";

export type MessageRow = ChatMessage & {
  sessionId: string;
  status: MessageStatus;
};
```

`packages/pi/src/agent/agent-turn-persistence.ts:109-128`

```ts
export class AgentTurnPersistence {
  private assignedAssistantIds = new Map<string, string>();
  private persistedMessageIds = new Set<string>();
  private recordedAssistantMessageIds = new Set<string>();
  private currentAssistantMessageId?: string;
  private currentTurnId?: string;
  private lastDraftAssistant?: AssistantMessage;
  private lastTerminalStatus: TerminalAssistantStatus = undefined;
```

Fact:

- transcript persistence is carrying runtime bookkeeping.
- that is why repair/diff/id-rotation logic exists.

## 3. tool-result ownership already disagrees across subsystems

### tool results are born without owner

`packages/pi/src/agent/session-adapter.ts:36-50`

```ts
case "toolResult":
  return {
    ...message,
    id,
    parentAssistantId: "",
  } satisfies ToolResultMessage;
```

### persistence infers owner by position

`packages/pi/src/agent/agent-turn-persistence.ts:398-412`

```ts
if (row.role === "toolResult" && activeAssistantId) {
  row.parentAssistantId = activeAssistantId;
}
```

### replay infers validity by seen `toolCallId`

`packages/pi/src/agent/message-transformer.ts:71-90`

```ts
if (message.role === "toolResult") {
  if (seenToolCallIds.has(message.toolCallId)) {
    result.push(message);
  }
}
```

### UI trusts stored `parentAssistantId`

`packages/pi/src/lib/chat-adapter.ts:39-65`

```ts
if (next.role !== "toolResult" || toolResults.has(next.toolCallId)) {
  continue;
}

if (next.parentAssistantId === message.id) {
  toolResults.set(next.toolCallId, next);
}
```

Fact:

- same relationship. 3 laws.
- orphan bugs are inevitable until this becomes one law.

## 4. current worker protocol is snapshot/repair oriented

`packages/pi/src/agent/runtime-worker-types.ts:7-19`

```ts
export type WorkerSnapshot = {
  error: string | undefined;
  isStreaming: boolean;
  messages: AgentMessage[];
  streamMessage: AgentMessage | null;
};

export type WorkerSnapshotEnvelope = {
  rotateStreamingAssistantDraft?: boolean;
  runtimeErrors?: RuntimeErrorPayload[];
  sessionId: string;
  snapshot: WorkerSnapshot;
  terminalStatus?: "aborted" | "error";
};
```

`packages/pi/src/agent/runtime-worker.ts:229-279`

```ts
if (event.type === "turn_end" && event.toolResults.length > 0) {
  this.rotateStreamingAssistantDraft = true;
}
...
const envelope: WorkerSnapshotEnvelope = {
  rotateStreamingAssistantDraft: this.rotateStreamingAssistantDraft ? true : undefined,
  runtimeErrors: ...,
  sessionId: this.sessionId,
  snapshot,
  terminalStatus: this.latestTerminalStatus,
};
```

`packages/pi/src/agent/worker-backed-agent-host.ts:58-76`

```ts
await this.persistence.applySnapshot({
  snapshot: envelope.snapshot,
  terminalStatus: envelope.terminalStatus,
});

if (envelope.rotateStreamingAssistantDraft) {
  this.persistence.rotateStreamingAssistantDraft();
}
```

Fact:

- runtime emits snapshots
- persistence reconstructs transcript from snapshots
- extra flags exist only to patch state mismatches

## 5. upstream already gives exact event boundaries. we can trust events instead of snapshots

`node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:103-121`

```js
const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
newMessages.push(message);
...
if (hasMoreToolCalls) {
  toolResults.push(...(await executeToolCalls(currentContext, message, config, signal, emit)));
  for (const result of toolResults) {
    currentContext.messages.push(result);
    newMessages.push(result);
  }
}
await emit({ type: "turn_end", message, toolResults });
```

`node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:377-388`

```js
const toolResultMessage = {
  role: "toolResult",
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  content: result.content,
  details: result.details,
  isError,
  timestamp: Date.now(),
};
await emit({ type: "message_start", message: toolResultMessage });
await emit({ type: "message_end", message: toolResultMessage });
```

`node_modules/@mariozechner/pi-agent-core/dist/agent.js:291-300`

```js
case "message_start":
  this._state.streamMessage = event.message;
  break;
case "message_update":
  this._state.streamMessage = event.message;
  break;
case "message_end":
  this._state.streamMessage = null;
  this.appendMessage(event.message);
  break;
```

Fact:

- completed messages arrive exactly at `message_end`
- partial assistant exists exactly at `message_start/message_update`
- tool results already carry stable `toolCallId`

This is enough to go event-sourced for a turn.

---

## no UX regression. explicit guarantees + evidence

## current UX constraints to preserve

### A. streaming placeholder must still show before text appears

`packages/ui/src/components/chat-message.tsx:166-176`

```ts
const isStreamingAssistant = "status" in message && message.status === "streaming";
const showStreamingPlaceholder =
  isStreamingAssistant &&
  view.text.length === 0 &&
  view.reasoning.length === 0 &&
  view.toolExecutions.length === 0;
...
<StatusShimmer duration={1.5}>Assistant is streaming...</StatusShimmer>
```

`tests/chat-message.test.tsx:44-55`

```ts
it("shows a streaming placeholder before the assistant emits text", async () => {
  ...
  expect(screen.getByRole("status").textContent).toContain("Assistant is streaming...");
});
```

### B. whole chat still shows streaming status

`packages/ui/src/components/chat.tsx:572-578`

```ts
{chatPanelMode === "starting" ? (
  <StatusShimmer>Starting session...</StatusShimmer>
) : chatPanelMode === "streaming_pending" ? (
  <StatusShimmer>Assistant is streaming...</StatusShimmer>
```

`tests/chat-state.test.tsx:311-315`

```ts
render(<Chat sessionId="session-1" />);
expect(screen.getByRole("status").textContent).toContain("Assistant is streaming...");
```

### C. tool-result boundaries are expected to flush immediately

`tests/runtime-worker.test.ts:255-286`

```ts
it("flushes tool-result boundaries immediately", async () => {
  ...
  expect(pushSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      rotateStreamingAssistantDraft: true,
      sessionId: "session-1",
    }),
  );
});
```

Current worker also flushes aggressively:
`packages/pi/src/agent/runtime-worker.ts:233-258`

```ts
const force =
  event.type === "message_end" ||
  event.type === "turn_end" ||
  (!snapshot.isStreaming && this.latestTerminalStatus !== undefined);
...
this.flushTimer = setTimeout(() => {
  ...
}, SNAPSHOT_FLUSH_MS);
```

Fact:

- UX depends on low-latency runtime writes, not on transcript snapshots specifically.

## design response

To preserve UX:

1. keep Dexie livequery
2. write partial assistant into `session_runtime.streamMessage` on every `message_start/message_update`
3. append completed rows to `messages` on every `message_end`
4. build a **single session view-model** from `session + transcript + runtime`
5. project `runtime.streamMessage` into display as a synthetic assistant message with `status: "streaming"` for existing component compatibility

So UX stays same or gets better:

- same livequery model
- fewer inconsistent states
- no snapshot diff lag

---

## target steady-state architecture

## 1. transcript = canonical completed history only

`messages` table stores only completed rows:

- `user`
- `assistant`
- `toolResult`
- `system`

Steady-state ban:

- no `status: "streaming"` transcript rows
- no speculative assistant rows
- no tool results with unknown owner

## 2. runtime = in-flight turn buffer only

Use `session_runtime` as the only place for active turn state.

Proposed shape:

```ts
export type RuntimePhase = "idle" | "running" | "interrupted";

export interface SessionRuntimeRow {
  sessionId: string;
  phase: RuntimePhase;
  ownerTabId?: string;
  turnId?: string;
  lastProgressAt?: string;
  lastError?: string;
  updatedAt: string;

  // partial assistant only
  streamMessage?: AssistantMessage;

  // toolCall.id -> assistant.id
  pendingToolCallOwners?: Record<string, string>;

  // compat during migration only
  status?: SessionRuntimeStatus;
  assistantMessageId?: string;
  startedAt?: string;
}
```

Why no `completedDelta`:

- upstream already emits exact `message_end` boundaries for completed rows
- append completed rows directly to transcript
- keep runtime lean

## 3. one linker is the ownership law

Create:

- `packages/pi/src/agent/tool-result-linker.ts`

Rule:

- assistant tool calls register `toolCall.id -> assistant.id`
- toolResult must match a real `toolCall.id`
- if yes: rewrite `parentAssistantId` to owning assistant id
- if no: orphan, drop

Suggested API:

```ts
export interface LinkedToolExecution {
  assistantId: string;
  toolCall: ToolCall;
  toolResult?: ToolResultMessage;
}

export function linkToolResults(messages: readonly ChatMessage[]): {
  messages: ChatMessage[];
  changed: boolean;
  executionsByAssistantId: ReadonlyMap<string, readonly LinkedToolExecution[]>;
} { ... }
```

This helper is used by:

- UI
- replay transformer
- markdown export
- legacy repair-on-read

## 4. one session view-model selector

Create:

- `packages/pi/src/sessions/session-view-model.ts`

Selector reads:

- `session`
- `messages`
- `session_runtime`
- lease/runtime ownership if needed later

Then builds:

- `displayMessages = transcript + projected runtime.streamMessage`
- run linker once
- return final model to UI

Shape:

```ts
export interface SessionViewModel {
  session: SessionData;
  runtime?: SessionRuntimeRow;
  displayMessages: ChatMessage[];
  hasPartialAssistantText: boolean;
  isStreaming: boolean;
}
```

## 5. core FSM shrinks

Primary runtime truth:

- `idle`
- `running`
- `interrupted`

Derived UI states still okay:

- `running-local`
- `running-remote` live/stale
- `recovering`
- `interrupted`
- `ready`

But derive them from:

- runtime `phase`
- lease ownership
- local runner presence

not from `session.isStreaming` + `runtime.status` + memory all at once.

---

## event-sourced write rules. this is the heart of the plan

## rule table

### `message_start(assistant)` / `message_update(assistant)`

Write only runtime:

```ts
await patchSessionRuntime(sessionId, {
  phase: "running",
  lastProgressAt: getIsoNow(),
  ownerTabId: getCurrentTabId(),
  streamMessage: assistantDraft,
  turnId,
});
```

No transcript write.

### `message_end(user)`

Append user row to transcript.
Update runtime phase/progress.

```ts
await putMessage(toMessageRow(sessionId, userMessage, "completed", userMessage.id));
await patchSessionRuntime(sessionId, {
  phase: "running",
  lastProgressAt: getIsoNow(),
  ownerTabId: getCurrentTabId(),
  turnId,
});
```

### `message_end(assistant)`

Append assistant row to transcript.
Clear runtime partial.
Register each tool call owner.

```ts
const pending = { ...(runtime.pendingToolCallOwners ?? {}) };
for (const block of assistant.content) {
  if (block.type === "toolCall") pending[block.id] = assistant.id;
}

await putMessage(toMessageRow(sessionId, assistant, "completed", assistant.id));
await patchSessionRuntime(sessionId, {
  phase: "running",
  lastProgressAt: getIsoNow(),
  ownerTabId: getCurrentTabId(),
  turnId,
  streamMessage: undefined,
  pendingToolCallOwners: pending,
});
```

### `message_end(toolResult)`

Look up owner from runtime `pendingToolCallOwners`.
If found, append linked tool result.
If not, drop as orphan and record runtime/system notice.

```ts
const assistantId = runtime.pendingToolCallOwners?.[toolResult.toolCallId];
if (!assistantId) {
  // orphan. drop from steady-state transcript.
  await patchSessionRuntime(sessionId, {
    phase: "running",
    lastProgressAt: getIsoNow(),
    lastError: `Dropped orphan tool result ${toolResult.toolCallId}`,
  });
  return;
}

const nextPending = { ...(runtime.pendingToolCallOwners ?? {}) };
delete nextPending[toolResult.toolCallId];

await putMessage(
  toMessageRow(
    sessionId,
    { ...toolResult, parentAssistantId: assistantId },
    "completed",
    toolResult.id,
  ),
);
await patchSessionRuntime(sessionId, {
  phase: "running",
  lastProgressAt: getIsoNow(),
  pendingToolCallOwners: nextPending,
});
```

### `turn_end`

Normally no transcript reconstruction. maybe just progress stamp if needed.

### `agent_end` success

Clear runtime. set phase idle.

```ts
await patchSessionRuntime(sessionId, {
  phase: "idle",
  lastProgressAt: getIsoNow(),
  lastError: undefined,
  streamMessage: undefined,
  pendingToolCallOwners: {},
});
```

### abort / provider error / watchdog / crash before clean end

Do **not** rewrite transcript as core behavior.
Set runtime interrupted. keep partial assistant if any.

```ts
await patchSessionRuntime(sessionId, {
  phase: "interrupted",
  lastProgressAt: getIsoNow(),
  lastError: error.message,
  streamMessage: currentDraft ?? runtime.streamMessage,
});
```

This is enough for current resume semantics too.

Note:

- current "continue" is really a follow-up prompt, not upstream `agent.continue()`.
- evidence: `packages/pi/src/agent/runtime-client.ts:374-380`

```ts
await this.startTurn(
  sessionId,
  mode === "continue" ? CONTINUE_INTERRUPTED_PROMPT : RETRY_INTERRUPTED_PROMPT,
);
```

So keeping interrupted partial assistant in runtime is compatible with current UX.

---

## legacy repair-on-read. migration only. not core runtime

Historical bad rows already exist.
Need one-time sanitation when loading old sessions.

Current raw load path:
`packages/pi/src/sessions/session-service.ts:94-104`

```ts
export async function loadSessionWithMessages(id: string) {
  ...
  return {
    messages: await getSessionMessages(id),
    session,
  };
}
```

Change this to:

```ts
const messages = await getSessionMessages(id);
const linked = linkToolResults(messages);

if (linked.changed) {
  await replaceSessionMessages(buildPersistedSession(session, linked.messages), linked.messages);
}

return {
  session,
  messages: linked.messages,
};
```

Important:

- keep this during migration
- once old transcripts are clean, this is just a safety net
- it is **not** the new core correctness mechanism

---

## exact file changes

## new files

### `packages/pi/src/agent/tool-result-linker.ts`

Single ownership law.

### `packages/pi/src/agent/turn-event-store.ts`

Event reducer / write helpers for local + worker paths.

### `packages/pi/src/sessions/session-view-model.ts`

One selector for transcript + runtime + linked display model.

## rewrite heavily

### `packages/pi/src/agent/agent-turn-persistence.ts`

Target: delete or hollow out entirely.

Reason:

- this is the snapshot reconstruction center
- event-sourced write path should replace it

### `packages/pi/src/agent/runtime-worker.ts`

Stop emitting snapshot envelopes as persistence primitive.
Emit reduced event-derived mutations or call shared turn-event-store logic.

### `packages/pi/src/agent/worker-backed-agent-host.ts`

Stop `applySnapshot(...)` + `rotateStreamingAssistantDraft` path.
Apply event-derived mutations.

### `packages/pi/src/agent/agent-host.ts`

Local runtime should use same event-derived write rules as worker path.

## update moderately

### `packages/db/src/storage-types.ts`

Add:

- `RuntimePhase`
- `streamMessage`
- `pendingToolCallOwners`

Keep compat fields for now.

### `packages/db/src/session-runtime.ts`

Replace `markTurnStarted/Progress/Completed/...` shape with generic patch/update helpers around runtime phase.

### `packages/pi/src/sessions/session-service.ts`

Add legacy repair-on-read.

### `packages/pi/src/lib/chat-adapter.ts`

Consume linker output, not raw `parentAssistantId`.

### `packages/pi/src/agent/message-transformer.ts`

Use linker-backed canonicalization. no bespoke orphan pruning law.

### `packages/pi/src/lib/copy-session-markdown.ts`

### `packages/pi/src/lib/export-markdown.ts`

Use linker output.

### `packages/pi/src/sessions/session-view-state.ts`

Switch to runtime `phase` as primary input.

### `packages/ui/src/components/chat.tsx`

Replace multiple livequeries with one `loadSessionViewModel()` livequery.

### `packages/pi/src/agent/runtime-client.ts`

Load state from session view-model/runtime phase. keep current continue/retry semantics.

### `packages/pi/src/sessions/session-notices.ts`

Stop interruption repair from being transcript-rewrite-first. use runtime `phase = interrupted` as primary steady-state behavior.

---

## no UX regression plan

## projection strategy

Keep existing UI component contract by projecting runtime draft into a synthetic streaming assistant row:

```ts
const displayMessages: ChatMessage[] = [...transcript];
if (runtime?.streamMessage?.role === "assistant") {
  displayMessages.push({
    ...runtime.streamMessage,
    status: "streaming",
  } as ChatMessage);
}
```

That preserves:

- `ChatMessage` streaming placeholder behavior
- `Chat` panel streaming state
- reasoning streaming marker on last assistant

## low-latency writes

Keep fast runtime writes:

- partial assistant updates go to `session_runtime`
- completed rows append on `message_end`
- no batching that would make tool-result boundaries slower than today

Current runtime already flushes at high frequency:
`packages/pi/src/agent/runtime-worker.ts:233-258`

```ts
const force =
  event.type === "message_end" ||
  event.type === "turn_end" ||
  (!snapshot.isStreaming && this.latestTerminalStatus !== undefined);
```

Event-sourced version should preserve at least this immediacy.

## remote mirror / ownership UX

Current banners depend on lease + runtime progress, not transcript reconstruction:
`packages/ui/src/components/chat.tsx:561-569`

```ts
Read-only mirror. This session is active in another tab.
...
Read-only mirror. Another tab still owns this streaming session.
```

So keeping `lastProgressAt`, `ownerTabId`, `phase` in runtime row is enough.

---

## migration order. still staged, but destination is full event-sourcing

## stage 1. introduce linker + repair-on-read

- add `tool-result-linker.ts`
- switch UI/replay/export to it
- sanitize old rows on load

## stage 2. extend runtime row

- add `phase`, `streamMessage`, `pendingToolCallOwners`
- keep compat fields mirrored

## stage 3. build event store

- add `turn-event-store.ts`
- define exact per-event writes
- write unit tests first

## stage 4. migrate local host

- `agent-host.ts` writes via event store
- no snapshot reconstruction for local path

## stage 5. migrate worker path

- `runtime-worker.ts` + `worker-backed-agent-host.ts` move to event store
- delete `rotateStreamingAssistantDraft`
- kill snapshot envelope dependence for persistence

## stage 6. unify UI on one selector

- `session-view-model.ts`
- `chat.tsx` consumes one livequery

## stage 7. simplify FSM + recovery

- runtime `phase` drives state
- transcript repair no longer steady-state recovery path
- interrupted turns use runtime row, then explicit continue/retry prompt

## stage 8. remove legacy fields

- delete transcript `streaming` writes
- delete `session.isStreaming` as truth source
- delete obsolete snapshot/diff helpers

---

## tests. these are mandatory

## preserve existing UX tests

Read before edits:

- `tests/chat-message.test.tsx`
- `tests/chat-state.test.tsx`
- `tests/runtime-worker.test.ts`
- `tests/agent-host-persistence.test.ts`
- `tests/message-transformer.test.ts`
- `tests/session-notices.test.ts`
- `tests/chat-adapter.test.ts`
- `tests/copy-session-markdown.test.ts`

## add new tests

### `tests/tool-result-linker.test.ts`

Cover:

- rewrites wrong `parentAssistantId`
- drops orphan tool result
- handles multi-tool assistant
- handles repeated turns safely

### `tests/turn-event-store.test.ts`

Cover:

- `message_update(assistant)` updates runtime only
- `message_end(user)` appends transcript row
- `message_end(assistant)` appends transcript + registers tool owners
- `message_end(toolResult)` appends linked row / drops orphan
- `agent_end` clears runtime to idle
- abort/error sets phase interrupted and preserves partial assistant

### `tests/session-view-model.test.ts`

Cover:

- transcript + runtime.streamMessage projection
- linker applied once in selector
- streaming placeholder still appears
- tool executions fold correctly

## update existing assertions

### replace

- expectations that transcript stores `status: "streaming"`
- expectations around `rotateStreamingAssistantDraft`
- expectations around snapshot-based repair being the normal path

### add

- runtime row carries partial assistant during stream
- transcript only changes on `message_end`
- interrupted state keeps partial assistant in runtime, not transcript
- no orphan `function_call_output`

---

## files an agent must read before implementation

## mandatory

1. `plan.md`
2. `packages/ui/src/components/chat.tsx`
3. `packages/ui/src/components/chat-message.tsx`
4. `packages/pi/src/sessions/session-service.ts`
5. `packages/db/src/storage-types.ts`
6. `packages/db/src/session-runtime.ts`
7. `packages/db/src/schema.ts`
8. `packages/pi/src/agent/session-adapter.ts`
9. `packages/pi/src/lib/chat-adapter.ts`
10. `packages/pi/src/agent/message-transformer.ts`
11. `packages/pi/src/agent/agent-turn-persistence.ts`
12. `packages/pi/src/agent/agent-host.ts`
13. `packages/pi/src/agent/runtime-worker-types.ts`
14. `packages/pi/src/agent/runtime-worker.ts`
15. `packages/pi/src/agent/worker-backed-agent-host.ts`
16. `packages/pi/src/agent/runtime-client.ts`
17. `packages/pi/src/sessions/session-view-state.ts`
18. `packages/pi/src/sessions/session-notices.ts`
19. `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js`
20. `node_modules/@mariozechner/pi-agent-core/dist/agent.js`

## tests

21. `tests/chat-message.test.tsx`
22. `tests/chat-state.test.tsx`
23. `tests/runtime-worker.test.ts`
24. `tests/agent-host-persistence.test.ts`
25. `tests/message-transformer.test.ts`
26. `tests/session-notices.test.ts`
27. `tests/chat-adapter.test.ts`
28. `tests/copy-session-markdown.test.ts`

---

## done criteria

Refactor is done only when all are true:

- no steady-state code path writes transcript rows with `status: "streaming"`
- runtime row owns all partial assistant state
- UI still streams via Dexie livequery
- streaming placeholder tests still pass
- tool-result boundaries appear immediately enough to satisfy existing UX tests
- one linker is used by UI + replay + export + legacy repair
- local host and worker host use event-derived writes, not snapshot reconstruction
- `rotateStreamingAssistantDraft` removed
- `AgentTurnPersistence` reconstruction center removed or reduced to a thin compat adapter pending deletion
- interrupted turns rely on runtime `phase`, not transcript rewrite as primary mechanism
- historical bad rows self-heal on read
- replay emits no orphan `function_call_output`
- multi-tool turns pass

---

## short summary

We are choosing the simpler architecture fully:

- transcript = completed history
- runtime = active turn buffer
- writes driven by exact agent events
- one linker for tool ownership
- one selector for UI

This removes the need for snapshot diffing, transcript reconstruction, and patchy ownership repair logic.
