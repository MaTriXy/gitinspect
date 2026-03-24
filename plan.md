# Agent-In-Web-App Plan

## Goal

Make the agent feel like it is **living inside the web app** the way Sitegeist feels alive in its sidepanel, while still respecting our `SPEC.md` constraints.

In practice, that means:

- one long-lived agent instance owns the active conversation
- the UI subscribes to agent state instead of manually stitching together request state
- streaming updates appear immediately in the thread
- session changes swap the live agent cleanly
- auth is resolved at request time, not copied into ad hoc request helpers
- session history, settings, usage, and costs remain local and durable

## What "Live Like Sitegeist" Means

Sitegeist feels alive because the app does **not** treat chat as isolated HTTP requests. It mounts a stateful `Agent`, subscribes to its events, and keeps app state, model state, auth state, and session persistence connected at the runtime boundary.

For our web app, the equivalent experience is:

1. App boot restores the last session and model.
2. A real agent object is created for that session.
3. The thread UI is driven by the agent's current state.
4. Sending a message uses `agent.prompt(...)`, not a one-off "stream this request" helper.
5. Streaming changes update the UI incrementally.
6. Model changes call `agent.setModel(...)` and persist.
7. Session switching tears down one live agent and mounts the next one.
8. OAuth refresh happens lazily via `getApiKey` right before provider requests.

## Non-Goals

These stay out of scope because `SPEC.md` excludes them:

- active-tab awareness
- navigation messages
- `browserjs`
- REPL
- DOM picking
- native input events
- extension-only tool surfaces
- server-side agent orchestration

So our target is **Sitegeist's local-first agent loop**, not Sitegeist's extension automation layer.

## Current State

The current app already has useful pieces:

- Dexie persistence under `src/db/*`
- session creation and persistence under `src/sessions/*`
- OAuth/provider auth logic under `src/auth/*`
- streaming provider adapters under `src/agent/provider-stream.ts`
- React app shell and chat hook under `src/components/app-shell.tsx` and `src/hooks/use-chat-session.ts`

The main gap is architectural:

- `src/agent/runtime.ts` is still a **stateless request orchestrator**
- `src/hooks/use-chat-session.ts` manages streaming with local hook state
- there is no single long-lived `Agent` object mounted into the app

That is why the app can stream chat, but the agent does not yet feel like a persistent runtime host in the way Sitegeist does.

## Core Decision

Replace the current "call `sendMessage()` and patch React state manually" architecture with a **session-bound agent host** built on:

- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`

The web app should own one `Agent` instance per active session, and everything else should adapt around that.

## Target Architecture

### Runtime Layers

1. `storage`
   - Dexie stores for sessions, metadata, settings, provider keys, daily costs

2. `auth`
   - provider key lookup
   - OAuth refresh
   - request-time auth resolution

3. `agent`
   - model resolution
   - message transformation
   - stream transport adapter
   - session-to-agent state mapping
   - agent host lifecycle

4. `ui`
   - app bootstrap
   - chat thread
   - composer
   - session sidebar
   - model picker
   - provider settings

### New Agent Flow

```text
Dexie session + settings
  -> build Agent initialState
  -> mount Agent host
  -> subscribe to Agent events
  -> reflect agent.state into React
  -> persist finalized session + usage + costs
```

### File-Level Shape

Add:

- `src/agent/agent-host.ts`
- `src/agent/session-adapter.ts`
- `src/agent/live-runtime.ts`

Refactor:

- `src/hooks/use-chat-session.ts`
- `src/hooks/use-app-bootstrap.ts`
- `src/components/app-shell.tsx`
- `src/agent/runtime.ts`
- `src/agent/provider-stream.ts`

Possibly remove or shrink:

- the current imperative logic in `src/agent/runtime.ts`

## Recommended Dependency Changes

We already added:

- `@mariozechner/pi-agent-core`

We should also add a direct dependency on:

- `@mariozechner/pi-ai`

Reason:

- `pi-agent-core` gives us the stateful `Agent`
- `pi-ai` gives us model lookup and message/model types
- Sitegeist depends on both directly

Command:

```bash
bun add @mariozechner/pi-ai
```

## Implementation Plan

## Phase 1: Introduce A Real Agent Host

### Objective

Create a wrapper that owns a single `Agent` instance for the active session and exposes:

- current `SessionData`
- `isStreaming`
- `error`
- `prompt()`
- `abort()`
- `setModel()`
- `replaceSession()`
- `dispose()`

### Why

This is the foundation that makes the agent feel "mounted" in the app instead of recreated per request.

### New File

- `src/agent/agent-host.ts`

### Suggested Shape

```ts
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core"
import { getModel } from "@mariozechner/pi-ai"
import { webMessageTransformer } from "@/agent/message-transformer"
import { streamChatWithPiAgent } from "@/agent/live-runtime"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import {
  buildSessionFromAgentState,
  buildInitialAgentState,
} from "@/agent/session-adapter"
import { persistSession } from "@/sessions/session-service"
import type { SessionData } from "@/types/storage"

export interface AgentHostSnapshot {
  error?: string
  isStreaming: boolean
  session: SessionData
}

export class AgentHost {
  readonly agent: Agent
  private unsubscribe?: () => void

  constructor(
    private session: SessionData,
    private onSnapshot: (snapshot: AgentHostSnapshot) => void
  ) {
    const model = getModel(session.provider, session.model)

    if (!model) {
      throw new Error(`Unknown model: ${session.provider}/${session.model}`)
    }

    this.agent = new Agent({
      initialState: buildInitialAgentState(session, model),
      convertToLlm: webMessageTransformer,
      getApiKey: async (provider) =>
        await resolveApiKeyForProvider(provider as typeof session.provider),
      streamFn: streamChatWithPiAgent,
      toolExecution: "sequential",
    })

    this.agent.sessionId = session.id
    this.unsubscribe = this.agent.subscribe(() => {
      const nextSession = buildSessionFromAgentState(this.session, this.agent.state)
      this.session = nextSession
      this.onSnapshot({
        error: this.agent.state.error,
        isStreaming: this.agent.state.isStreaming,
        session: nextSession,
      })
    })
  }

  async prompt(content: string) {
    await this.agent.prompt(content)
    await persistSession(this.session)
  }

  async setModelSelection(provider: SessionData["provider"], modelId: string) {
    const nextModel = getModel(provider, modelId)

    if (!nextModel) {
      throw new Error(`Unknown model: ${provider}/${modelId}`)
    }

    this.agent.setModel(nextModel)
    this.session = {
      ...this.session,
      model: modelId,
      provider,
    }
    await persistSession(this.session)
  }

  abort() {
    this.agent.abort()
  }

  dispose() {
    this.unsubscribe?.()
  }
}
```

### Notes

- The host should be the only place where React meets the `Agent` directly.
- The React hook should consume host snapshots, not reimplement agent semantics.

## Phase 2: Create Session <-> Agent Adapters

### Objective

Define one place that converts:

- `SessionData` -> `AgentState`
- `AgentState` -> `SessionData`

### Why

This keeps persistence and runtime synchronized without duplicating logic across hooks and components.

### New File

- `src/agent/session-adapter.ts`

### Suggested Shape

```ts
import type { AgentState } from "@mariozechner/pi-agent-core"
import type { Model } from "@mariozechner/pi-ai"
import { buildPersistedSession, updateSessionSummaries } from "@/sessions/session-service"
import type { SessionData } from "@/types/storage"

export function buildInitialAgentState(
  session: SessionData,
  model: Model<any>
): Partial<AgentState> {
  return {
    messages: session.messages,
    model,
    systemPrompt: session.systemPrompt ?? "",
    thinkingLevel: session.thinkingLevel,
    tools: [],
  }
}

export function buildSessionFromAgentState(
  previous: SessionData,
  state: AgentState
): SessionData {
  return buildPersistedSession(
    updateSessionSummaries({
      ...previous,
      messages: state.messages as SessionData["messages"],
      model: state.model.id,
      provider: state.model.provider as SessionData["provider"],
      thinkingLevel: state.thinkingLevel,
    })
  )
}
```

### Rules

- `SessionData` remains our durable storage shape.
- `AgentState` remains transient runtime state.
- We never persist the raw `Agent` object.

## Phase 3: Replace `sendMessage()` With Agent Prompting

### Objective

Move message send logic out of `src/agent/runtime.ts` and into `Agent.prompt(...)`.

### Why

Right now we manually create:

- user message
- assistant draft
- usage merge logic
- streaming patch logic

That duplicates functionality the mounted `Agent` already provides.

### Refactor Target

- shrink `src/agent/runtime.ts`
- move provider transport into a stream adapter used by the agent

### New Stream Adapter

```ts
import type { StreamFn } from "@mariozechner/pi-agent-core"
import { streamSimple } from "@mariozechner/pi-ai"
import { getProxyConfig } from "@/proxy/settings"
import { resolveProviderAuthForProvider } from "@/auth/resolve-api-key"
import { proxyAwareFetch } from "@/proxy/proxy-fetch"

export const streamChatWithPiAgent: StreamFn = async (options) => {
  const proxy = await getProxyConfig()
  const auth = await resolveProviderAuthForProvider(options.model.provider as any)

  return streamSimple({
    ...options,
    apiKey: auth?.apiKey,
    fetch: async (input, init) => {
      return await proxyAwareFetch({
        proxyUrl: proxy.enabled ? proxy.url : undefined,
        requestInit: init,
        targetUrl: typeof input === "string" ? input : input.toString(),
      })
    },
  })
}
```

### Important Caveat

The exact `streamSimple(...)` option names need to match the installed `@mariozechner/pi-ai` API. The snippet above is the intended adapter shape, not the final copy-paste implementation.

### End State

- `src/agent/provider-stream.ts` becomes the low-level transport adapter
- the agent loop becomes the owner of message creation and streaming lifecycle

## Phase 4: Refactor `useChatSession()` Into A Live Agent Hook

### Objective

Stop managing chat lifecycle manually in the hook. Mount an `AgentHost` and subscribe to snapshots.

### Why

This is where the UI starts to feel like Sitegeist: the hook becomes a runtime bridge instead of a request orchestrator.

### Current File

- `src/hooks/use-chat-session.ts`

### Suggested Shape

```ts
import * as React from "react"
import { AgentHost, type AgentHostSnapshot } from "@/agent/agent-host"
import { setSetting } from "@/db/schema"
import type { ProviderId } from "@/types/models"
import type { SessionData } from "@/types/storage"

export function useChatSession(initialSession: SessionData) {
  const hostRef = React.useRef<AgentHost | undefined>(undefined)
  const [snapshot, setSnapshot] = React.useState<AgentHostSnapshot>({
    isStreaming: false,
    session: initialSession,
  })

  React.useEffect(() => {
    hostRef.current?.dispose()

    const host = new AgentHost(initialSession, (next) => {
      setSnapshot(next)
    })

    hostRef.current = host
    setSnapshot({
      isStreaming: false,
      session: initialSession,
    })

    return () => host.dispose()
  }, [initialSession.id])

  const send = React.useEffectEvent(async (content: string) => {
    if (!content.trim()) {
      return
    }

    await hostRef.current?.prompt(content)
    const session = hostRef.current?.agent.state
    if (session) {
      await setSetting("active-session-id", snapshot.session.id)
    }
  })

  const abort = React.useEffectEvent(() => {
    hostRef.current?.abort()
  })

  const setModelSelection = React.useEffectEvent(
    async (provider: ProviderId, model: string) => {
      await hostRef.current?.setModelSelection(provider, model)
      await setSetting("last-used-model", model)
      await setSetting("last-used-provider", provider)
    }
  )

  return {
    abort,
    error: snapshot.error,
    isStreaming: snapshot.isStreaming,
    send,
    session: snapshot.session,
    setModelSelection,
  }
}
```

### Critical Behavior

- switching sessions disposes the old host
- the new host starts from persisted messages immediately
- the hook no longer constructs assistant drafts itself

## Phase 5: Persist During Events, Not Only After Requests

### Objective

Persist session state from agent event flow rather than from the outside after a request completes.

### Why

This gives us:

- more faithful Sitegeist behavior
- better crash resilience
- cleaner runtime ownership

### Event-Driven Persistence Strategy

Persist on:

- `message_end` for finalized message storage
- model changes
- session switch
- abort/error finalization

Record cost aggregates on:

- assistant `message_end`

### Suggested Event Handler

```ts
this.unsubscribe = this.agent.subscribe(async (event) => {
  const nextSession = buildSessionFromAgentState(this.session, this.agent.state)
  this.session = nextSession
  this.onSnapshot({
    error: this.agent.state.error,
    isStreaming: this.agent.state.isStreaming,
    session: nextSession,
  })

  if (event.type === "message_end") {
    await persistSession(nextSession)

    if (event.message.role === "assistant") {
      await recordUsage(
        event.message.usage,
        event.message.provider,
        event.message.model,
        event.message.timestamp
      )
    }
  }
})
```

### Rule

React should not be the source of truth for persisted state. The agent host should be.

## Phase 6: Tighten App Bootstrap Around The Live Agent

### Objective

Make app boot restore a real live session, not just load JSON into local state.

### Current File

- `src/hooks/use-app-bootstrap.ts`

### Required Changes

- keep current session resolution logic
- ensure it always returns the session that should be mounted live
- persist:
  - `active-session-id`
  - `last-used-provider`
  - `last-used-model`
- optionally add a lightweight `runtime-ready` concept so the UI can avoid flashing stale data

### Suggested Direction

```ts
export async function loadInitialSession(): Promise<SessionData> {
  const requestedSessionId =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("session")

  if (requestedSessionId) {
    const requested = await loadSession(requestedSessionId)
    if (requested) return requested
  }

  const recent = await loadMostRecentSession()
  if (recent) return recent

  const defaults = await loadDefaultProviderAndModel()
  return createSession(defaults)
}
```

### Result

App boot becomes:

- resolve session
- mount host
- let host drive UI

## Phase 7: Make Model Selection Agent-Native

### Objective

The selected model should belong to the live agent, not just to component state.

### Current UI

- `src/components/app-shell.tsx`
- `src/components/model-picker.tsx`

### Required Behavior

- `ModelPicker` calls `chat.setModelSelection(...)`
- the host resolves `getModel(provider, modelId)`
- `agent.setModel(...)` updates the live runtime
- the session snapshot updates immediately
- settings are persisted immediately

### UI Integration Snippet

```tsx
<ModelPicker
  model={chat.session.model}
  provider={chat.session.provider}
  onChange={async (provider, modelId) => {
    await chat.setModelSelection(provider, modelId)
    await setSetting("active-session-id", chat.session.id)
  }}
/>
```

This is already close to what we have. The change is that the hook implementation becomes agent-native.

## Phase 8: Keep Auth Lazy And Session-Local

### Objective

Match Sitegeist's most important auth behavior: resolve auth right before streaming, refresh if needed, and never duplicate auth state into transient UI-only structures.

### Current Strength

`src/auth/resolve-api-key.ts` is already close to the right shape:

- reads stored provider key
- detects OAuth JSON
- refreshes if near expiry
- writes refreshed credentials back to Dexie
- returns provider-ready auth material

### Plan

- keep this file as the single source of auth resolution
- inject it into `Agent` via `getApiKey`
- remove any duplicated auth lookup from UI-facing code

### Snippet

```ts
const agent = new Agent({
  initialState,
  convertToLlm: webMessageTransformer,
  getApiKey: async (provider) =>
    await resolveApiKeyForProvider(provider as ProviderId),
  streamFn: streamChatWithPiAgent,
})
```

This is the exact pattern that makes the agent feel mounted and self-sufficient.

## Phase 9: Minimal Message Transformer For Web v0

### Objective

Keep the same separation Sitegeist has between app-level messages and LLM-level messages, but without extension-specific custom message types.

### Why

We do not need navigation messages now, but we do want a clean future seam for:

- UI-only messages
- later browser-safe tools
- later context injection

### Suggested File

- `src/agent/message-transformer.ts`

### Snippet

```ts
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"

export async function webMessageTransformer(
  messages: AgentMessage[]
): Promise<Message[]> {
  return messages.filter((message): message is Message => {
    return (
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "toolResult"
    )
  })
}
```

### Rule

Do not overbuild this for v0. Keep it boring until we actually add browser-safe tools.

## Phase 10: UI Polish That Makes The Agent Feel Present

### Objective

The runtime refactor matters most, but some UI touches will make the "live agent" feeling obvious.

### Required UI Behavior

- header always reflects current provider/model
- streaming state is obvious
- stop button is immediate
- switching sessions swaps the active transcript instantly
- the composer remains bound to the mounted host, not stale async state

### Nice Additions

- subtle "live" presence indicator while streaming
- small provider auth badge near the model picker
- optimistic thread updates that come from agent subscription events

### App Shell Direction

`src/components/app-shell.tsx` is already close. It should remain the composition root, but the state it consumes should come from the mounted host hook rather than manual request bookkeeping.

## Testing Plan

## Unit

- `session-adapter` conversions
- auth resolution and OAuth refresh writeback
- message transformer filtering
- usage/cost aggregation from agent state

## Integration

- bootstrap loads recent session and mounts a host
- sending a message streams into the visible thread
- abort stops an in-flight response
- model change updates the live agent and persisted settings
- session switch disposes old host and mounts new host

## Persistence

- reload after completed chat restores full history
- reload mid-error restores aborted/error assistant message state safely
- daily cost aggregates remain correct after multiple sessions

## Suggested Work Order

1. Add `@mariozechner/pi-ai` directly.
2. Add `src/agent/session-adapter.ts`.
3. Add `src/agent/agent-host.ts`.
4. Convert the provider stream code into an agent-compatible `streamFn`.
5. Refactor `use-chat-session.ts` to mount the host.
6. Wire persistence into agent event handling.
7. Verify `AppShell` and `ModelPicker` behavior.
8. Add tests around host lifecycle and bootstrap.

## Concrete Acceptance Criteria

We are done when all of the following are true:

1. The active conversation is owned by a mounted `Agent`, not a stateless helper.
2. The thread updates from agent subscription events during streaming.
3. Reload restores the most recent session and model automatically.
4. Model switches update the live agent immediately.
5. OAuth refresh happens via `getApiKey` just before provider calls.
6. Sessions, usage, and daily costs persist locally with no backend.
7. No extension-only features were introduced.

## Final Recommendation

The shortest path to "Sitegeist-like, but web-safe" is:

- keep our existing Dexie/session/auth foundation
- stop evolving the current stateless runtime
- introduce a mounted `AgentHost`
- make React subscribe to the host
- use `pi-agent-core` as the stateful conversation engine
- keep tools empty/minimal for now

That gives us the most important Sitegeist property: the agent is no longer something the web app calls. The agent becomes something the web app **hosts**.

## Detailed Todo List

This is the execution checklist for implementing the plan above without drifting away from Sitegeist's runtime shape.

Important working rule:

- if a task references a Sitegeist file, the implementation should read that file first and copy the behavior, adapting only where our web-app constraints require it
- do not read upstream package internals as the primary source of truth for behavior; use the Sitegeist call sites and runtime wiring

## Phase 0: Dependency And Runtime Baseline

- [x] Add `@mariozechner/pi-ai` as a direct root dependency with Bun.
  Sitegeist reference: [docs/sitegeist/package.json](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/package.json)
- [x] Verify the installed `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` versions are compatible and available in `package.json` and `bun.lock`.
  Sitegeist reference: [docs/sitegeist/package.json](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/package.json)
- [x] Re-read the Sitegeist runtime entrypoint and restate the target runtime contract before coding.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Re-read the Sitegeist architecture findings already captured in our research report before implementation starts.
  Research reference: [research.md](/Users/jeremy/Developer/gitoverflow/research.md)

## Phase 1: Define The Agent Host Boundary

- [x] Create `src/agent/agent-host.ts` as the single owner of the live `Agent` instance for the active session.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Define the `AgentHostSnapshot` shape that React will consume.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Implement host constructor behavior:
  - build initial agent state from persisted session
  - resolve model from provider + model id
  - assign `sessionId`
  - attach `convertToLlm`
  - attach `streamFn`
  - attach `getApiKey`
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Implement `prompt(content)` on the host using `agent.prompt(...)`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Implement `abort()` on the host using `agent.abort()`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Implement `setModelSelection(provider, modelId)` on the host using `agent.setModel(...)`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Implement `dispose()` and ensure the host unsubscribes from agent events cleanly.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)

## Phase 2: Build Session <-> Agent State Adapters

- [x] Create `src/agent/session-adapter.ts`.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/storage/stores/sessions-store.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/stores/sessions-store.ts)
- [x] Implement `buildInitialAgentState(session, model)`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Implement `buildSessionFromAgentState(previousSession, agentState)`.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/messages/message-transformer.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/message-transformer.ts)
- [x] Ensure the adapter preserves:
  - session id
  - createdAt
  - provider
  - model
  - thinking level
  - message list
  - preview
  - title
  - accumulated usage
  - cost
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/dialogs/SessionListDialog.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/SessionListDialog.ts)
- [x] Ensure the adapter remains web-safe and does not introduce extension-only message types.
  Sitegeist contrast references:
  [docs/sitegeist/src/messages/NavigationMessage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/NavigationMessage.ts)
  [docs/sitegeist/src/messages/WelcomeMessage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/WelcomeMessage.ts)

## Phase 3: Replace Stateless Runtime Sending With Agent Prompting

- [x] Audit the current `src/agent/runtime.ts` and identify logic that should move into agent event handling versus transport code.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Stop manually constructing assistant drafts in the React hook path once the host is in place.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Reduce `src/agent/runtime.ts` to either:
  - a thin compatibility layer, or
  - remove it entirely if superseded by the host
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Move all "live loop" behavior to the mounted `Agent`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)

## Phase 4: Create An Agent-Compatible Stream Adapter

- [x] Refactor `src/agent/provider-stream.ts` so it can serve as the `streamFn` for `pi-agent-core`.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/docs/proxy.md](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/docs/proxy.md)
- [x] Ensure the stream adapter resolves auth lazily at request time through `getApiKey`, not by preloading provider credentials into UI state.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
- [x] Keep proxy behavior settings-driven and narrow.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/docs/proxy.md](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/docs/proxy.md)
- [x] Ensure provider-specific request differences remain encoded in provider/auth logic, not flattened into one generic policy layer.
  Sitegeist references:
  [docs/sitegeist/src/oauth/anthropic.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/anthropic.ts)
  [docs/sitegeist/src/oauth/openai-codex.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/openai-codex.ts)
  [docs/sitegeist/src/oauth/github-copilot.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/github-copilot.ts)
  [docs/sitegeist/src/oauth/google-gemini-cli.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/google-gemini-cli.ts)
- [x] Verify abort/cancelation is respected by the stream adapter.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)

## Phase 5: Keep Message Transformation Minimal But Explicit

- [x] Audit `src/agent/message-transformer.ts`.
  Sitegeist reference: [docs/sitegeist/src/messages/message-transformer.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/message-transformer.ts)
- [x] Implement a minimal web-safe `convertToLlm` that only forwards:
  - `user`
  - `assistant`
  - `toolResult`
  Sitegeist reference: [docs/sitegeist/src/messages/message-transformer.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/message-transformer.ts)
- [x] Explicitly avoid browser-only injected message types for v0.
  Sitegeist contrast references:
  [docs/sitegeist/src/messages/NavigationMessage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/NavigationMessage.ts)
  [docs/sitegeist/src/messages/custom-messages.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/custom-messages.ts)
- [x] Leave a clean seam for future app-specific message types without implementing them now.
  Sitegeist references:
  [docs/sitegeist/src/messages/NavigationMessage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/NavigationMessage.ts)
  [docs/sitegeist/src/messages/WelcomeMessage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/WelcomeMessage.ts)

## Phase 6: Keep Auth Resolution Sitegeist-Shaped

- [x] Audit `src/auth/resolve-api-key.ts` against Sitegeist's stored auth resolution contract.
  Sitegeist references:
  [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
  [docs/sitegeist/src/oauth/types.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/types.ts)
- [x] Ensure raw API keys remain raw strings in storage and OAuth credentials remain serialized JSON strings.
  Sitegeist references:
  [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
  [docs/sitegeist/src/oauth/types.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/types.ts)
- [x] Ensure near-expiry OAuth refresh still writes refreshed credentials back to Dexie.
  Sitegeist reference: [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
- [x] Preserve provider-specific returned auth material, especially Gemini CLI's JSON `{ token, projectId }` shape.
  Sitegeist references:
  [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
  [docs/sitegeist/src/oauth/google-gemini-cli.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/google-gemini-cli.ts)
- [x] Ensure the mounted host injects auth through `getApiKey` and nowhere else.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)

## Phase 7: Keep Browser OAuth Flows Web-Safe

- [x] Re-read the browser OAuth helper flow before changing web popup/callback logic.
  Sitegeist reference: [docs/sitegeist/src/oauth/browser-oauth.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/browser-oauth.ts)
- [x] Keep PKCE generation and state generation aligned with Sitegeist behavior.
  Sitegeist reference: [docs/sitegeist/src/oauth/browser-oauth.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/browser-oauth.ts)
- [x] Keep provider-specific login/refresh flows separate.
  Sitegeist references:
  [docs/sitegeist/src/oauth/anthropic.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/anthropic.ts)
  [docs/sitegeist/src/oauth/openai-codex.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/openai-codex.ts)
  [docs/sitegeist/src/oauth/github-copilot.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/github-copilot.ts)
  [docs/sitegeist/src/oauth/google-gemini-cli.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/google-gemini-cli.ts)
- [x] Ensure our popup/callback route only replaces the extension transport, not the underlying provider logic.
  Sitegeist references:
  [docs/sitegeist/src/oauth/browser-oauth.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/browser-oauth.ts)
  [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
- [x] Keep device code UI support for GitHub Copilot in the provider settings path.
  Sitegeist references:
  [docs/sitegeist/src/oauth/github-copilot.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/github-copilot.ts)
  [docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts)

## Phase 8: Refactor `useChatSession()` To Mount A Live Host

- [x] Replace the current manual `sendMessage()` orchestration in `src/hooks/use-chat-session.ts`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Mount a new `AgentHost` when `initialSession.id` changes.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Dispose the previous host when switching sessions.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Drive hook state from host snapshots:
  - `session`
  - `isStreaming`
  - `error`
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Route `send()` through `host.prompt(...)`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Route `abort()` through `host.abort()`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Route model changes through `host.setModelSelection(...)`.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Continue persisting `active-session-id`, `last-used-model`, and `last-used-provider` from the hook boundary or host boundary, but keep the source of truth singular.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts)

## Phase 9: Move Persistence To Agent Event Handling

- [x] Subscribe to agent events inside the host and emit updated session snapshots to React on every meaningful change.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Persist sessions on finalized assistant/user message boundaries, not only after the outer request promise returns.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Record cost aggregates from assistant message completion events.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/storage/stores/cost-store.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/stores/cost-store.ts)
- [x] Keep the "don't persist empty conversations" rule.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/storage/stores/sessions-store.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/stores/sessions-store.ts)
- [x] Ensure persisted session metadata still supports the sidebar preview and session list.
  Sitegeist references:
  [docs/sitegeist/src/dialogs/SessionListDialog.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/SessionListDialog.ts)
  [docs/sitegeist/src/storage/app-storage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/app-storage.ts)

## Phase 10: Tighten Bootstrap And Refresh Behavior

- [x] Keep `src/hooks/use-app-bootstrap.ts` responsible for resolving the initial session to mount.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Preserve the current priority order:
  - URL `session` param
  - persisted active session
  - most recent session
  - fresh session with default model/provider
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Confirm that browser refresh destroys only the in-memory host, while persisted sessions restore cleanly on boot.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Ensure the boot flow updates:
  - `active-session-id`
  - `last-used-model`
  - `last-used-provider`
  after choosing the initial session.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)

## Phase 11: Keep The UI Bound To The Live Host

- [x] Audit `src/components/app-shell.tsx` to ensure it remains a composition root, not a runtime owner.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Ensure the header reflects the live session title, provider, and model.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Keep the thread component purely render-driven from `chat.session.messages`.
  Sitegeist references:
  [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
  [docs/sitegeist/src/messages/WelcomeMessage.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/WelcomeMessage.ts)
- [x] Keep the composer bound to the live host methods:
  - send
  - abort
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Keep settings/model interactions routed through the mounted chat hook, not directly through provider request helpers.
  Sitegeist references:
  [docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts)
  [docs/sitegeist/src/dialogs/ApiKeyOrOAuthDialog.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/ApiKeyOrOAuthDialog.ts)

## Phase 12: Keep The Tool Surface Empty Or Minimal

- [x] Ensure the mounted agent starts with `tools: []` or a deliberately tiny web-safe list.
  Sitegeist contrast reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Do not port any of these Sitegeist tools into v0:
  - navigate
  - repl
  - skill
  - debugger
  - browser image extraction
  Sitegeist references:
  [docs/sitegeist/src/tools/navigate.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/tools/navigate.ts)
  [docs/sitegeist/src/tools/repl/repl.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/tools/repl/repl.ts)
  [docs/sitegeist/src/tools/skill.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/tools/skill.ts)
  [docs/sitegeist/src/tools/debugger.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/tools/debugger.ts)
  [docs/sitegeist/src/tools/extract-image.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/tools/extract-image.ts)
- [x] Keep the runtime/tool boundary clean so browser-safe tools can be added later without rewriting the host.
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)

## Phase 13: Testing Checklist

- [x] Add unit tests for session <-> agent adapters.
  Sitegeist references:
  [docs/sitegeist/src/storage/stores/sessions-store.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/stores/sessions-store.ts)
  [docs/sitegeist/src/messages/message-transformer.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/messages/message-transformer.ts)
- [x] Add unit tests for auth resolution:
  - plain API key path
  - OAuth parse path
  - near-expiry refresh path
  - Gemini CLI payload formatting
  Sitegeist references:
  [docs/sitegeist/src/oauth/index.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/index.ts)
  [docs/sitegeist/src/oauth/google-gemini-cli.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/oauth/google-gemini-cli.ts)
- [x] Add integration tests for mounted host lifecycle:
  - bootstrap
  - send
  - stream
  - abort
  - session switch
  - model switch
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Add persistence tests for browser refresh semantics:
  - completed history restored
  - in-memory host replaced on reload
  - active session restored
  Sitegeist reference: [docs/sitegeist/src/sidepanel.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/sidepanel.ts)
- [x] Add cost aggregation tests ensuring assistant completions update daily totals correctly.
  Sitegeist references:
  [docs/sitegeist/src/storage/stores/cost-store.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/storage/stores/cost-store.ts)
  [docs/sitegeist/src/dialogs/SessionCostDialog.ts](/Users/jeremy/Developer/gitoverflow/docs/sitegeist/src/dialogs/SessionCostDialog.ts)

## Phase 14: Verification Checklist Before Starting Implementation

- [x] Confirm the plan still respects `SPEC.md` non-goals.
  Spec reference: [SPEC.md](/Users/jeremy/Developer/gitoverflow/SPEC.md)
- [x] Confirm the plan still does not require:
  - server-side code
  - extension APIs
  - REPL
  - `browserjs`
  - skills registry
  Spec reference: [SPEC.md](/Users/jeremy/Developer/gitoverflow/SPEC.md)
- [x] Confirm every implementation task above is achievable with:
  - Dexie
  - client-side OAuth completion
  - a mounted in-memory `Agent`
  Spec reference: [SPEC.md](/Users/jeremy/Developer/gitoverflow/SPEC.md)

## Definition Of Done

- [x] One mounted `Agent` instance owns the active conversation.
- [x] React renders snapshots from the host instead of manually orchestrating stream state.
- [x] Browser refresh recreates the host from persisted session data.
- [x] Session switching disposes the old host and mounts a new one.
- [x] Model switching updates the live host immediately.
- [x] OAuth refresh is request-time and persisted back to Dexie.
- [x] Session history, usage, and costs are fully local and durable.
- [x] No extension-only Sitegeist features were added.
