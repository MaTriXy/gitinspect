# `pi-web-ui` Research

## Executive summary

`@mariozechner/pi-web-ui` is not a full Sitegeist app runtime. It is a **web-component UI kit + IndexedDB storage layer + a few browser helpers** around `pi-agent-core` and `pi-ai`.

If you want to compose something very close to Sitegeist with far less local code, the package gives you a real simplification path:

- use `ChatPanel` or `AgentInterface` for the chat UI
- use `SessionsStore` + `ProviderKeysStore` + `SettingsStore` + `IndexedDBStorageBackend`
- persist **raw `AgentState` / `AgentMessage[]`**, not a custom split `SessionData + MessageRow + session_runtime + session_leases` model
- subscribe to the `Agent` and save session snapshots on each event, like Sitegeist does

But it does **not** give you:

- React primitives
- Dexie integration
- interruption recovery / resumability model
- session ownership / leases
- durable incremental assistant rows
- OAuth refresh resolution
- a generic tool-result reorder helper for your current custom message model

So the real simplification decision is:

1. move much closer to Sitegeist / `pi-web-ui` and delete a lot of custom runtime code
2. or keep the current React + Dexie architecture and only cherry-pick a few helpers

The package is best when you accept the **Sitegeist architecture**, not when you try to bolt it onto the current architecture unchanged.

## Sources inspected

### `pi-web-ui`

- `/Users/jeremy/Developer/pi-mono/packages/web-ui/package.json`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/README.md`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/index.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/ChatPanel.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/components/AgentInterface.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/components/Messages.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/types.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/store.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/app-storage.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/stores/provider-keys-store.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/stores/settings-store.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/backends/indexeddb-storage-backend.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/dialogs/ModelSelector.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/dialogs/SettingsDialog.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/dialogs/SessionListDialog.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/utils/proxy-utils.ts`

### Sitegeist

- `/Users/jeremy/Developer/sitegeist/src/sidepanel.ts`
- `/Users/jeremy/Developer/sitegeist/src/background.ts`
- `/Users/jeremy/Developer/sitegeist/src/messages/message-transformer.ts`
- `/Users/jeremy/Developer/sitegeist/src/storage/app-storage.ts`
- `/Users/jeremy/Developer/sitegeist/src/storage/stores/sessions-store.ts`

### Current app for comparison

- `/Users/jeremy/Developer/gitinspect/src/agent/*`
- `/Users/jeremy/Developer/gitinspect/src/db/schema.ts`
- `/Users/jeremy/Developer/gitinspect/src/types/chat.ts`
- `/Users/jeremy/Developer/gitinspect/src/types/storage.ts`

## Important high-level findings

### 1. `pi-web-ui` is opinionated in 3 ways

#### 1.1 It is **Lit web components**, not React

The core exports are:

```ts
export { ChatPanel } from "./ChatPanel.js";
export { AgentInterface } from "./components/AgentInterface.js";
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/index.ts`

That means the package wants you to compose with:

- `document.createElement("agent-interface")`
- `new ChatPanel()`
- `appendChild`
- global `setAppStorage(...)`

Not hooks, not React context, not TanStack query/router state.

#### 1.2 It is **raw IndexedDB abstraction**, not Dexie

The storage model is:

- `StorageBackend`
- `IndexedDBStorageBackend`
- `Store`
- `AppStorage`

Key types:

```ts
export interface StorageBackend {
  get(...)
  set(...)
  delete(...)
  keys(...)
  getAllFromIndex(...)
  clear(...)
  has(...)
  transaction(...)
  getQuotaInfo()
  requestPersistence()
}
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/types.ts`

So if you adopt it fully, you are not using Dexie anymore.

That directly conflicts with the current repo rule in `AGENTS.md`:

- "No ad hoc storage wrappers; use Dexie for durable state."

#### 1.3 It persists **whole sessions**, not runtime metadata

Its session store shape is:

```ts
export interface SessionData {
  id: string;
  title: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  createdAt: string;
  lastModified: string;
}
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/types.ts`

And metadata is separate:

```ts
export interface SessionMetadata {
  id: string;
  title: string;
  createdAt: string;
  lastModified: string;
  messageCount: number;
  usage: ...
  thinkingLevel: ThinkingLevel;
  preview: string;
}
```

This is much simpler than the current app’s split model:

- `sessions`
- `messages`
- `session_leases`
- `session_runtime`

But it also means it has no native concept of:

- partially persisted assistant rows
- runtime liveness
- ownership
- interruption reconciliation

## What `pi-web-ui` actually gives you

## 2. UI layer

### 2.1 `ChatPanel`

`ChatPanel` is the high-level prebuilt UI shell:

```ts
@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
  async setAgent(agent: Agent, config?: { ... }) { ... }
}
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/ChatPanel.ts`

What it does:

- creates an `AgentInterface`
- creates an `ArtifactsPanel`
- wires artifact rendering
- gathers attachment/artifact runtime providers
- calls `agent.setTools(...)`
- switches between single-column and split artifacts layout

Important specificity:

```ts
const tools = [this.artifactsPanel.tool, ...additionalTools];
this.agent.setTools(tools);
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/ChatPanel.ts`

That means `ChatPanel` **always injects an artifacts tool**.

For gitinspect, that matters because current repo constraints say:

- no tools UI / no custom tools UI in v0

So `ChatPanel` is not a neutral chat wrapper. It is a **tool+artifact-enabled** chat shell.

### 2.2 `AgentInterface`

`AgentInterface` is the lower-level helper.

It takes an `Agent` and renders:

- messages
- streaming assistant container
- composer
- model selector
- thinking selector
- attachment support
- abort
- usage/cost footer

Key properties:

```ts
@property({ attribute: false }) session?: Agent;
@property({ type: Boolean }) enableAttachments = true;
@property({ type: Boolean }) enableModelSelector = true;
@property({ type: Boolean }) enableThinkingSelector = true;
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/components/AgentInterface.ts`

Important specificity:

If the `Agent` still has the default `streamSimple`, `AgentInterface` silently upgrades it to proxy-aware streaming:

```ts
if (this.session.streamFn === streamSimple) {
  this.session.streamFn = createStreamFn(async () => { ... });
}
```

It also supplies a default `getApiKey` from `AppStorage` if missing:

```ts
if (!this.session.getApiKey) {
  this.session.getApiKey = async (provider: string) => {
    const key = await getAppStorage().providerKeys.get(provider);
    return key ?? undefined;
  };
}
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/components/AgentInterface.ts`

This is a strong simplification hook.

But it is only enough if:

- API keys are plain stored strings
- proxy rules from `createStreamFn` are enough

It is **not enough** for current gitinspect auth needs:

- OAuth credentials
- refresh
- provider-specific token resolution

Sitegeist also overrides this and passes a custom `getApiKey`.

### 2.3 `Messages.ts`

This file does 2 jobs:

1. message rendering web components
2. default `convertToLlm`

The default transformer is:

```ts
export function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .filter((m) => !isArtifactMessage(m))
    .map(...)
}
```

It handles:

- `user-with-attachments` -> normal `user` with content blocks
- `artifact` -> filtered out
- standard `user/assistant/toolResult` passthrough

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/components/Messages.ts`

Important specificity:

It does **not** do Sitegeist/gitinspect-style tool-result reordering.

That is why Sitegeist still has its own custom transformer in:

- `/Users/jeremy/Developer/sitegeist/src/messages/message-transformer.ts`

And that transformer includes:

```ts
function reorderMessages(messages: Message[]): Message[] { ... }
```

So `defaultConvertToLlm` is enough for:

- attachments
- filtering artifact-only messages

It is **not** the full answer for custom message semantics or ordering-sensitive tool UX.

## 3. Storage layer

### 3.1 `Store` + `AppStorage`

The package wants one global app storage instance:

```ts
let globalAppStorage: AppStorage | null = null;

export function setAppStorage(storage: AppStorage): void {
  globalAppStorage = storage;
}
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/app-storage.ts`

This is very different from current gitinspect:

- current app imports concrete Dexie functions directly
- no single storage service object

### 3.2 `SessionsStore`

`SessionsStore` stores:

- full session blob in `sessions`
- lightweight metadata in `sessions-metadata`

Key methods:

```ts
async save(data: SessionData, metadata: SessionMetadata): Promise<void>
async get(id: string): Promise<SessionData | null>
async getAllMetadata(): Promise<SessionMetadata[]>
async updateTitle(id: string, title: string): Promise<void>
async saveSession(id: string, state: AgentState, metadata?: SessionMetadata, title?: string)
async loadSession(id: string): Promise<SessionData | null>
```

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/storage/stores/sessions-store.ts`

Important specificity:

`SessionsStore.saveSession(...)` does **not** derive rich metadata for you beyond minimal defaults. Sitegeist still computes:

- cumulative usage
- preview text
- createdAt preservation
- title generation

before calling:

```ts
await storage.sessions.saveSession(currentSessionId, state, metadata, currentTitle);
```

Source: `/Users/jeremy/Developer/sitegeist/src/sidepanel.ts`

So `pi-web-ui` gives you the storage container, not the whole session policy.

### 3.3 `IndexedDBStorageBackend`

This is a generic multi-store IndexedDB wrapper with:

- store config
- indexes
- transactions
- quota info
- persistence request

That is how Sitegeist avoids Dexie while still keeping typed stores.

It is clean.

But in gitinspect, adopting it would mean **replacing** current DB architecture, not complementing it.

## 4. Helper dialogs / package conveniences

The package gives reusable dialogs/components for:

- `ModelSelector`
- `SettingsDialog`
- `SessionListDialog`
- `ApiKeyPromptDialog`
- `ProviderKeyInput`

These are real value.

Examples:

```ts
ModelSelector.open(currentModel, onSelect)
SettingsDialog.open([new ApiKeysTab(), new ProxyTab(), ...])
SessionListDialog.open(onSelect, onDelete)
```

Sources:

- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/dialogs/ModelSelector.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/dialogs/SettingsDialog.ts`
- `/Users/jeremy/Developer/pi-mono/packages/web-ui/src/dialogs/SessionListDialog.ts`

These are some of the easiest helpers to reuse conceptually.

## How Sitegeist actually composes the package

## 5. Storage bootstrap

Sitegeist extends `AppStorage`:

```ts
export class SitegeistAppStorage extends BaseAppStorage {
  readonly skills: SkillsStore;
  readonly costs: CostStore;
}
```

Source: `/Users/jeremy/Developer/sitegeist/src/storage/app-storage.ts`

Construction pattern:

1. create store instances
2. gather configs
3. create one `IndexedDBStorageBackend`
4. call `setBackend(...)` on each store
5. call `super(...)`
6. `setAppStorage(storage)`

This is the canonical `pi-web-ui` composition pattern.

## 6. Agent creation

Sitegeist still creates the `Agent` itself:

```ts
agent = new Agent({
  initialState: ...,
  convertToLlm: browserMessageTransformer,
  toolExecution: "sequential",
  streamFn: createStreamFn(async () => { ... }),
  getApiKey: async (provider: string) => { ... },
});
```

Source: `/Users/jeremy/Developer/sitegeist/src/sidepanel.ts`

Important specifics:

- Sitegeist does **not** use `defaultConvertToLlm`
- Sitegeist does **not** rely on default `getApiKey`
- Sitegeist does use `createStreamFn(...)`
- Sitegeist still customizes the agent heavily

So even in Sitegeist, `pi-web-ui` is not “the whole runtime.”

## 7. Session persistence

Sitegeist persists sessions from an `agent.subscribe(...)` handler.

It still manually handles:

- save last used model
- update auth label
- record per-assistant cost
- generate title
- lazily create session id
- acquire ownership lock
- save session blob + metadata

This block lives in:

- `/Users/jeremy/Developer/sitegeist/src/sidepanel.ts`

So `pi-web-ui` reduces code, but Sitegeist still owns **app policy**.

## 8. UI composition

Sitegeist creates the UI like this:

```ts
chatPanel = new ChatPanel();
await chatPanel.setAgent(agent, {
  sandboxUrlProvider: ...,
  onApiKeyRequired: ...,
  onBeforeSend: ...,
  onCostClick: ...,
  toolsFactory: ...,
});
```

Then it renders `chatPanel` into its own outer shell.

That is the exact “compose the UI” move the package is optimized for.

## 9. Session loading

Sitegeist loads sessions by:

1. loading a full stored `SessionData`
2. acquiring ownership lock in background
3. constructing a fresh `Agent`
4. injecting stored `messages`, `model`, `thinkingLevel`
5. calling `chatPanel.setAgent(agent, ...)`

This is much simpler than current gitinspect because it rebuilds from one persisted blob:

- `SessionData.messages`

Not from:

- session row
- message rows
- runtime row
- lease row
- local runner state

## What `pi-web-ui` does not solve

## 10. No interruption recovery model

There is no built-in concept of:

- `session_runtime`
- `lastProgressAt`
- `interrupted`
- `resume`
- per-turn watchdog
- ownership transfer

Sitegeist solves “single owner” with extension background locks:

```ts
if (msg.type === "acquireLock") { ... }
```

Source: `/Users/jeremy/Developer/sitegeist/src/background.ts`

That is extension-specific. `pi-web-ui` itself does not provide that.

## 11. No durable incremental assistant transcript

The package persists `AgentState.messages` snapshots, not per-row incremental session history like current gitinspect.

That means if a page dies mid-stream, you only get whatever snapshot the app happened to save.

Current gitinspect is more complex precisely because it wants stronger recovery semantics.

## 12. No React integration

This package is:

- Lit
- mini-lit
- web components

If you use it in gitinspect as-is, you are choosing:

- React app shell
- embedded web-component chat island

That is possible.

But it is not a “native React helper package.”

## 13. No OAuth refresh layer

Default `AgentInterface` behavior only reads `providerKeys` strings.

Sitegeist still passes a custom `getApiKey` resolver.

So for gitinspect requirements:

- local OAuth credentials
- refresh
- provider-group resolution

you would still need custom auth code.

## 14. Version skew risk

Current gitinspect uses:

- `@mariozechner/pi-agent-core` `^0.62.0`
- `@mariozechner/pi-ai` `^0.62.0`

Source: `/Users/jeremy/Developer/gitinspect/package.json`

The `pi-web-ui` source I inspected is:

- `@mariozechner/pi-web-ui` `0.57.0`

Source: `/Users/jeremy/Developer/pi-mono/packages/web-ui/package.json`

That means a direct adoption path needs one of:

1. use a matching older `pi-ai` / `pi-agent-core`
2. upgrade `pi-web-ui`
3. vendor/copy the needed helpers and adapt them

This is a real adoption constraint.

## Mapping to current gitinspect

## 15. What current gitinspect rebuilt locally

### 15.1 Current app-local replacements for `pi-web-ui` concerns

- custom proxy helper:
  - `src/agent/provider-proxy.ts`
- custom provider stream wrapper:
  - `src/agent/provider-stream.ts`
- custom message transformer:
  - `src/agent/message-transformer.ts`
- custom session adapter:
  - `src/agent/session-adapter.ts`
- custom runtime/session ownership:
  - `src/agent/runtime-client.ts`
  - `src/agent/agent-host.ts`
  - `src/agent/session-lease.ts`
  - `src/agent/session-runtime-store.ts`
- custom Dexie tables:
  - `src/db/schema.ts`

### 15.2 Why this happened

Because gitinspect chose all of these at once:

- React instead of Lit
- Dexie instead of `IndexedDBStorageBackend`
- custom persisted transcript schema instead of `SessionData.messages`
- stronger interruption recovery model
- no extension runtime / no background port locks

Each one is defensible.

Together, they force a lot of glue code.

## 16. Which current files could disappear in a true `pi-web-ui`-style rewrite

If gitinspect moved much closer to Sitegeist + `pi-web-ui`, these files or responsibilities likely disappear or shrink dramatically:

- `src/agent/runtime-client.ts`
- `src/agent/agent-host.ts`
- `src/agent/session-runtime-store.ts`
- `src/agent/session-lease.ts`
- `src/agent/session-adapter.ts`
- `src/agent/runtime-types.ts`
- large parts of `src/agent/provider-stream.ts`
- large parts of `src/components/chat.tsx`
- large parts of settings/session list UI

But only because you would also give up / replace:

- current resumability model
- current Dexie schema
- current React-native chat rendering

## Concrete simplification paths

## 17. Option A: Full Sitegeist-style composition

This is the largest simplification and the largest architectural change.

### Shape

- install/use `pi-web-ui`
- create a global `AppStorage`
- store raw `AgentState` sessions in `SessionsStore`
- create one `Agent`
- use `ChatPanel` or `AgentInterface`
- subscribe to agent events and call `storage.sessions.saveSession(...)`

### Result

Very little local UI/runtime glue.

### Cost

- lose current Dexie-centric runtime model
- lose current fine-grained interruption semantics
- introduce Lit web components into a React app
- need version alignment

### Best fit

Only if you are willing to **rebase the app around Sitegeist’s architecture**.

## 18. Option B: Hybrid, recommended if you want package help without full rewrite

Use `pi-web-ui` for **UI composition**, but keep current storage/runtime.

### Best candidate

Use `AgentInterface`, not `ChatPanel`.

Why:

- `ChatPanel` always installs artifact tooling
- `AgentInterface` is just the chat surface
- easier to wrap inside React

### What you get

- prebuilt streaming chat UI
- message rendering
- composer
- abort button
- model selector
- thinking selector
- attachment support

### What you still keep

- current Dexie schema
- current runtime ownership/recovery model
- current auth resolution
- current session list/settings shell

### Tradeoff

You do **not** get the full code deletion of Option A, because runtime complexity remains.

## 19. Option C: Cherry-pick patterns, not package

If you want the least disruption:

- copy the `SessionsStore` idea:
  - one full session blob + one metadata store
- copy the `createStreamFn` shape
- copy the `setAppStorage` style only conceptually
- maybe reuse `defaultConvertToLlm` logic for attachments/artifacts if needed

This is lower leverage, but avoids the React/Lit mismatch.

## Specific recommendations for gitinspect

## 20. What I would do if the goal is “much simpler, still browser-only”

I would not try to partially graft `ChatPanel` into the current runtime stack and pretend that solves the complexity.

I would choose between 2 honest directions:

### Direction 1. Go much closer to Sitegeist

Use:

- `AgentInterface` or `ChatPanel`
- `AppStorage`
- `SessionsStore`
- raw `AgentState` session persistence

And accept:

- less elaborate resumability
- simpler snapshot-based restore
- web-component island in React

This is the real “delete a lot of files” path.

### Direction 2. Keep the current runtime architecture, but stop pretending `pi-web-ui` will remove it

In this direction, only reuse:

- maybe `createStreamFn`
- maybe dialogs/patterns
- maybe some message UI ideas

But keep:

- `RuntimeClient`
- `AgentHost`
- `session_runtime`
- leases/recovery

That is not a big simplification.

## 21. For current repo constraints, `AgentInterface` is the cleanest reuse point

If you want maximum simplification without fully surrendering the app architecture:

- wrap `agent-interface` inside one React component
- feed it a real `Agent`
- keep your own persistence/recovery
- do **not** use `ChatPanel` unless you want artifacts/tools panel

Reason:

- `AgentInterface` is the actual reusable chat UI surface
- `ChatPanel` is already opinionated toward Sitegeist’s artifact/tool experience

## 22. Biggest blocker to direct adoption: storage model mismatch

The biggest mismatch is not styling. it is persistence shape.

`pi-web-ui` assumes:

- `SessionData.messages: AgentMessage[]`

Current gitinspect assumes:

- summary session row
- persisted message rows
- derived usage/preview/title
- runtime row
- lease row

As long as that mismatch remains, you will keep needing:

- adapters
- derived state
- recovery code

That is the real reason current local code exists.

## 23. Biggest blocker to “same UI, same reliability”: `pi-web-ui` has no interruption engine

If your bar is:

- no stuck streaming
- explicit interrupted state
- resume / retry
- ownership semantics

then `pi-web-ui` does not currently replace that.

It simplifies the **chat product surface**.
It does not replace the **runtime reliability model**.

## Final recommendation

If the goal is **compose nearly the same Sitegeist UI with much less local code**, the cleanest path is:

1. use `AgentInterface` or `ChatPanel`
2. use `SessionsStore`-style raw `AgentState` persistence
3. simplify the app around snapshot restore, not per-message/runtime rows

If the goal is **keep current reliability architecture**, `pi-web-ui` will only help at the margins.

So the hard conclusion is:

- `pi-web-ui` is a good answer to “how do I stop hand-building the chat UI + IndexedDB store + selectors/dialogs?”
- it is **not** the answer to “how do I keep the current custom recovery model but delete most of the runtime code?”

Those are different bets.

## Concrete next-step proposal

If we pursue this further, the best next research artifact would be:

1. a spike plan for `AgentInterface` embedded in React
2. a second spike plan for full `SessionsStore`-style snapshot persistence
3. a deletion map: exactly which current files disappear under each option

