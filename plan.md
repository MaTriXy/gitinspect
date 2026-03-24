# AI Elements Chat UI Plan

## Goal

Build the inner chat UI that replaces the current `ChatThread` + `Composer` fallback inside the already-implemented `ChatShell`, using the `ai-elements` primitives from the example you shared, but wired to this app’s real persistence/runtime layer.

This plan is only about the inner chat surface. `ChatShell`, sidebar, header, session list, and settings dialog already exist and should remain the owners of shell-level state.

The main component should be named `Chat`.

---

## Current Implementation Grounding

### What is already done

The new shell is already implemented in [src/components/new/chat-shell.tsx](/Users/jeremy/Developer/gitoverflow/src/components/new/chat-shell.tsx).

It already owns:

- bootstrap/loading/error handling
- active session selection
- sidebar actions
- create/delete/select session flows
- URL sync via `?session=...`
- settings dialog
- `useSessionData(selectedSessionId)`
- `useSessionMessages(selectedSessionId)`
- `useRuntimeSession(selectedSessionId)`

Today, the shell renders:

- `ChatThread` + `Composer` when no child is provided
- `props.children` inside `<main>` when a child is provided

That means the simplest path is:

1. keep `ChatShell` as the owner of active session/runtime state
2. mount a child `Chat`
3. pass the already-resolved session/messages/runtime into `Chat`

### What should change in the route

`ChatPage` should mount the shell with the new inner component:

```tsx
import { ChatShell } from "@/components/new/chat-shell"
import { Chat } from "@/components/new/chat"

export function ChatPage() {
  return (
    <ChatShell>
      <Chat />
    </ChatShell>
  )
}
```

### Recommended shell change

Right now `ChatShell` accepts generic `children`. That makes the child blind to the active session state the shell already owns.

The simplest design is to let the shell pass resolved props into `Chat`, either by:

- render prop
- React context
- or direct composition inside `ReadyChatShell`

Recommendation: direct composition with explicit props. It is the least abstract option and matches the current codebase.

---

## What Must Stay True

- No separate chat state machine in React.
- No `useChat()` / AI SDK transport as source of truth.
- No fake local streaming loop like the demo.
- No bypass around the SharedWorker runtime.
- Dexie remains the durable source of truth for messages/sessions.
- Proxy behavior stays untouched.

Runtime boundary stays:

```text
Chat
  -> useRuntimeSession(sessionId) via ChatShell-owned state
  -> runtimeClient
  -> SharedWorker runtime
  -> AgentHost
  -> Dexie
  -> useLiveQuery hooks
```

The key difference from the previous draft is that `Chat` does **not** need to be independently query-param-driven anymore. `ChatShell` already owns that concern.

---

## Real Schema vs Demo Shape

The demo uses a presentation-specific message shape. This repo does not.

### Current persisted message model

```ts
export type ChatMessage = AssistantMessage | ToolResultMessage | UserMessage
```

### Current assistant content blocks

```ts
export type AssistantContent = TextContent | ThinkingContent | ToolCall
```

### Consequences

- `reasoning` exists, but as `thinking` content blocks inside assistant messages
- `tools` exist, but as:
  - assistant `toolCall` blocks
  - separate `toolResult` messages
- `versions` do not exist
- `sources` do not exist
- attachments exist in the input primitives, but the runtime currently only accepts `string` input
- search toggle has no runtime/session contract

So `Chat` needs a small adapter layer. It should not try to store demo-style message objects.

---

## Scope

### In scope

- ai-elements conversation rendering
- ai-elements prompt input
- ai-elements model selector
- reasoning rendering
- tool call/result rendering
- empty-state suggestions
- streaming state from Dexie/runtime
- text send/abort

### Explicitly out of scope for the first pass

- message branching/version UI
- source citations UI
- attachment sending
- search toggle with real effect

If any unsupported demo feature is rendered, it should be clearly disabled, adapter-backed, or hidden only when there is no honest way to represent it.

---

## Visual Target

The end result should read as the same overall interface shape as the example you provided, even if it is implemented through multiple smaller components and backed by the real persistence/runtime layer.

### Required visual structure

`Chat` should still compose into this overall layout:

```tsx
<div className="relative flex size-full flex-col divide-y overflow-hidden">
  <Conversation>
    <ConversationContent>{/* mapped messages */}</ConversationContent>
    <ConversationScrollButton />
  </Conversation>

  <div className="grid shrink-0 gap-4 pt-4">
    <Suggestions />
    <div className="w-full px-4 pb-4">
      <PromptInput>
        <PromptInputHeader>{/* attachments area */}</PromptInputHeader>
        <PromptInputBody>{/* textarea */}</PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {/* attachment menu */}
            {/* speech input */}
            {/* search button */}
            {/* model selector */}
          </PromptInputTools>
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    </div>
  </div>
</div>
```

### Visual parity requirements

- Keep the split layout:
  - scrolling conversation on top
  - suggestion strip above the prompt
  - prompt input footer fixed at the bottom of the inner pane
- Use the same ai-elements families as the example:
  - `attachments`
  - `conversation`
  - `message`
  - `model-selector`
  - `prompt-input`
  - `reasoning`
  - `sources`
  - `speech-input`
  - `suggestion`
- Preserve the same control ordering in the footer:
  - attachment menu
  - speech input
  - search toggle/button
  - model selector
  - submit button
- Preserve the same message presentation hierarchy:
  - sources first
  - reasoning second
  - message content third
  - branch selector after message content when applicable

### Feature-shape guidance

- `MessageBranch*` should remain part of the design surface, but only render controls when a message actually has more than one version.
- `Sources*` should stay in the message composition, but render only when source data exists.
- attachment UI should remain visible in the prompt surface even if actual attachment submission is disabled in v1.
- `SpeechInput` should stay in the footer if it can safely append text without changing the runtime contract.
- search toggle/button should remain in the footer for shape parity, but may be disabled or no-op until there is a real runtime flag behind it.

---

## Proposed Files

```text
src/components/new/
  chat.tsx
  chat-message.tsx
  chat-composer.tsx
  chat-model-selector.tsx
  chat-adapter.ts
```

### Responsibilities

- `chat.tsx`
  - top-level inner surface
  - receives active session/messages/runtime from `ChatShell`
  - composes conversation + suggestions + composer
- `chat-message.tsx`
  - renders one persisted message with ai-elements components
- `chat-composer.tsx`
  - prompt input + submit/stop + optional suggestions/model selector composition
- `chat-model-selector.tsx`
  - ai-elements model picker backed by the catalog/runtime
- `chat-adapter.ts`
  - pure helpers for converting persisted messages into renderable pieces

---

## Phase 1: Let `ChatShell` Render `Chat`

### Objective

Stop treating the child as opaque content and instead wire it to the session/runtime state the shell already has.

### Recommended shape

Add a dedicated render path in `ReadyChatShell`:

```tsx
import { Chat } from "@/components/new/chat"

<main className="min-h-0 flex-1">
  {activeSession ? (
    <Chat
      error={runtime.error ?? activeSession.error}
      messages={messages}
      runtime={runtime}
      session={activeSession}
    />
  ) : (
    <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
      Loading session...
    </div>
  )}
</main>
```

### Why this is simpler

- no duplicate URL/session resolution logic
- no custom event plumbing
- no prop-drilling through unrelated layers
- no confusion about whether the shell or child owns the active session

`ChatShell` already has the correct data. Reuse it.

### Detailed todo list

- [ ] Decide whether `ChatShell` will render `Chat` directly or pass it via a typed child composition path.
- [ ] Add a stable prop contract for `Chat`:
  - `session`
  - `messages`
  - `runtime`
  - `error`
- [ ] Replace the current fallback branch in `ReadyChatShell` that renders `ChatThread` + `Composer`.
- [ ] Keep the existing loading state in `ChatShell` unchanged when `activeSession` is missing.
- [ ] Verify that `ChatHeader` title behavior does not need any changes after replacing the inner pane.
- [ ] Verify that `SettingsDialog` and sidebar actions remain untouched after the swap.
- [ ] Leave the old `ChatThread` + `Composer` in place until the new `Chat` is complete, then remove the fallback path only when parity is reached.

---

## Phase 2: Add A Pure Adapter Layer For Persisted Messages

### Objective

Convert the persisted `ChatMessage` union into the parts needed by the ai-elements renderer.

### Suggested helpers

```ts
import type {
  AssistantMessage,
  ChatMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@/types/chat"

export function getUserText(message: UserMessage): string {
  if (typeof message.content === "string") {
    return message.content
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function getAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("\n")
}

export function getAssistantToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter(
    (part): part is ToolCall => part.type === "toolCall"
  )
}

export function isToolResultMessage(
  message: ChatMessage
): message is ToolResultMessage {
  return message.role === "toolResult"
}
```

### Important rule

Do not reshape persisted messages into the demo’s `versions/sources/tools` object model. The adapter should stay read-only and local to the renderer.

### Detailed todo list

- [ ] Create `src/components/new/chat-adapter.ts`.
- [ ] Add helper for extracting user text from the persisted union.
- [ ] Add helper for extracting assistant markdown text.
- [ ] Add helper for extracting assistant thinking blocks.
- [ ] Add helper for extracting assistant tool calls.
- [ ] Add helper for locating tool results associated with tool calls if grouped rendering becomes necessary.
- [ ] Add helper for deriving a UI-facing message shape with fields like:
  - `from`
  - `content`
  - `reasoning`
  - `sources`
  - `versions`
  - `toolCalls`
  - `toolResults`
- [ ] Decide whether message versions should always be a one-item array in v1 for schema parity with the visual design.
- [ ] Add tests for empty text, mixed content blocks, and assistant messages that contain both thinking and tool calls.

---

## Phase 3: Build `Chat`

### Objective

Create the top-level inner surface using the same high-level composition as the demo:

- conversation area
- optional suggestions
- prompt input footer

### Suggested props

```ts
import type { ChatMessage } from "@/types/chat"
import type { SessionData } from "@/types/storage"
import type { useRuntimeSession } from "@/hooks/use-runtime-session"

export interface ChatProps {
  error?: string
  messages: ChatMessage[]
  runtime: ReturnType<typeof useRuntimeSession>
  session: SessionData
}
```

### Component skeleton

```tsx
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion"
import { ChatComposer } from "./chat-composer"
import { ChatMessage } from "./chat-message"

const suggestions = [
  "Summarize this repository",
  "Explain the current runtime architecture",
  "Find the session persistence flow",
  "How does model switching work here?",
]

export function Chat(props: ChatProps) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-4xl px-4 py-6">
          {props.messages.map((message) => (
            <ChatMessage
              isStreaming={props.session.isStreaming}
              key={message.id}
              message={message}
            />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t">
        {props.messages.length === 0 ? (
          <Suggestions className="px-4 pt-4">
            {suggestions.map((suggestion) => (
              <Suggestion
                key={suggestion}
                onClick={() => void props.runtime.send(suggestion)}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
        ) : null}

        <ChatComposer
          error={props.error}
          isStreaming={props.session.isStreaming}
          model={props.session.model}
          onAbort={props.runtime.abort}
          onSelectModel={props.runtime.setModelSelection}
          onSend={props.runtime.send}
          providerGroup={props.session.providerGroup ?? props.session.provider}
        />
      </div>
    </div>
  )
}
```

### Detailed todo list

- [ ] Create `src/components/new/chat.tsx`.
- [ ] Make the root wrapper match the example’s `relative flex size-full flex-col divide-y overflow-hidden`.
- [ ] Ensure the top region is a `Conversation` surface and the bottom region is a prompt/suggestions grid.
- [ ] Keep the conversation region `min-h-0` so it scrolls correctly inside `ChatShell`.
- [ ] Add empty-state suggestions above the prompt, not inside the scrollable conversation body.
- [ ] Ensure suggestions disappear after the first persisted message exists, or decide to keep them visible if that better matches the target look.
- [ ] Pass `session.isStreaming` through to all subcomponents that need it.
- [ ] Keep `runtime.send`, `runtime.abort`, and `runtime.setModelSelection` as the only mutation entry points.
- [ ] Surface runtime/session errors below or within the prompt area in a way that does not break the example’s vertical rhythm.

---

## Phase 4: Render Messages With `ai-elements`

### Objective

Use the actual `ai-elements` primitives that match the example:

- `Conversation`
- `Message`
- `MessageContent`
- `MessageResponse`
- `Reasoning`
- `ReasoningTrigger`
- `ReasoningContent`

### Message renderer

```tsx
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { ToolCallBubble } from "@/components/tool-call-bubble"
import { ToolResultBubble } from "@/components/tool-result-bubble"
import type { ChatMessage } from "@/types/chat"
import {
  getAssistantText,
  getAssistantThinking,
  getAssistantToolCalls,
  getUserText,
} from "./chat-adapter"

export function ChatMessage(props: {
  isStreaming: boolean
  message: ChatMessage
}) {
  const { message } = props

  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>
          <MessageResponse>{getUserText(message)}</MessageResponse>
        </MessageContent>
      </Message>
    )
  }

  if (message.role === "toolResult") {
    return <ToolResultBubble message={message} />
  }

  const text = getAssistantText(message)
  const thinking = getAssistantThinking(message)
  const toolCalls = getAssistantToolCalls(message)

  return (
    <Message from="assistant">
      <div>
        {thinking ? (
          <Reasoning isStreaming={props.isStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>{thinking}</ReasoningContent>
          </Reasoning>
        ) : null}

        <MessageContent>
          <MessageResponse>{text}</MessageResponse>
        </MessageContent>

        {toolCalls.map((toolCall) => (
          <ToolCallBubble key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>
    </Message>
  )
}
```

### Notes

- The current schema does not support `MessageBranch*`, so do not render branch controls.
- The current schema does not support `Sources`, so do not render source controls.
- Keep tool results as separate rows. That matches the runtime’s persisted structure.

### Detailed todo list

- [ ] Create `src/components/new/chat-message.tsx`.
- [ ] Render user messages with `Message` + `MessageContent` + `MessageResponse`.
- [ ] Render assistant messages with the example’s nested order:
  - sources
  - reasoning
  - message content
  - branch selector
- [ ] Add a branch wrapper shape using `MessageBranch` and `MessageBranchContent`.
- [ ] Represent v1 persisted messages as a single version by default.
- [ ] Only show `MessageBranchSelector` when the derived versions array length is greater than 1.
- [ ] Add `Sources`, `SourcesTrigger`, `SourcesContent`, and `Source` rendering hooks even if source arrays are empty in v1.
- [ ] Decide whether tool calls live inside the assistant message body or immediately below it in the same message cell.
- [ ] Replace or wrap `ToolCallBubble` if needed so it better matches the example’s inline tool presentation.
- [ ] Replace or wrap `ToolResultBubble` if needed so tool outputs visually harmonize with the ai-elements message stack.
- [ ] Confirm markdown/code rendering still works through `MessageResponse`.
- [ ] Confirm reasoning duration handling:
  - use real duration if available
  - otherwise fall back safely without lying
- [ ] Add tests for:
  - user message
  - assistant text-only message
  - assistant message with thinking
  - assistant message with tool calls
  - tool result message
  - single-version vs multi-version rendering

---

## Phase 5: Build The ai-elements Composer

### Objective

Replace the old plain `Composer` with the richer prompt surface from the example.

### First-pass behavior

- text send
- stop while streaming
- model selector
- optional suggestions
- attachment UI present but not fully wired for submission
- search toggle visually present but not functionally wired

### Composer skeleton

```tsx
import * as React from "react"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import type { ProviderGroupId } from "@/types/models"
import { ChatModelSelector } from "./chat-model-selector"

export function ChatComposer(props: {
  error?: string
  isStreaming: boolean
  model: string
  onAbort: () => void
  onSelectModel: (providerGroup: ProviderGroupId, modelId: string) => Promise<void> | void
  onSend: (value: string) => Promise<void> | void
  providerGroup: ProviderGroupId
}) {
  const [text, setText] = React.useState("")

  const handleSubmit = React.useEffectEvent(async (message: PromptInputMessage) => {
    const next = message.text.trim()

    if (!next || props.isStreaming) {
      return
    }

    await props.onSend(next)
    setText("")
  })

  return (
    <div className="px-4 py-4">
      <div className="mx-auto grid w-full max-w-4xl gap-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(event) => setText(event.target.value)}
              value={text}
            />
          </PromptInputBody>

          <PromptInputFooter>
            <PromptInputTools>
              <ChatModelSelector
                disabled={props.isStreaming}
                model={props.model}
                onSelect={props.onSelectModel}
                providerGroup={props.providerGroup}
              />
            </PromptInputTools>

            <PromptInputSubmit
              disabled={!text.trim()}
              status={props.isStreaming ? "streaming" : "ready"}
            />
          </PromptInputFooter>
        </PromptInput>

        {props.error ? (
          <div className="text-xs text-destructive">{props.error}</div>
        ) : null}
      </div>
    </div>
  )
}
```

### Stop behavior

If `PromptInputSubmit` is too limited to expose stop behavior cleanly, add an explicit stop button next to it and wire it to `props.onAbort`. Keep abort support even if the final UI differs slightly from the demo.

### Detailed todo list

- [ ] Create `src/components/new/chat-composer.tsx`.
- [ ] Reproduce the example’s vertical structure:
  - `PromptInputHeader`
  - `PromptInputBody`
  - `PromptInputFooter`
- [ ] Keep the footer tool ordering identical to the example.
- [ ] Add local text state for the textarea value.
- [ ] Map submit status from real app state:
  - `submitted`
  - `streaming`
  - `ready`
  - `error`
- [ ] Decide whether `submitted` should be a transient local state or whether `ready/streaming/error` is sufficient from real runtime state.
- [ ] Add the attachment header display surface using `usePromptInputAttachments()`.
- [ ] Add the attachment action menu with `PromptInputActionMenu*`.
- [ ] Decide v1 attachment behavior:
  - disabled control
  - local-only previews
  - or allow selection but prevent submit
- [ ] Add `SpeechInput` in the footer if it can safely append transcript text into the textarea.
- [ ] Add the search toggle button with `GlobeIcon`.
- [ ] Decide the v1 search button behavior:
  - disabled
  - cosmetic local toggle only
  - or hidden behind feature flag
- [ ] Ensure `PromptInputSubmit` visually reflects streaming/ready/error state.
- [ ] Add explicit stop behavior if submit cannot switch into a stop affordance cleanly.
- [ ] Ensure the prompt area remains anchored and non-jumpy while messages stream.
- [ ] Add error display in the prompt area without breaking the example’s spacing.
- [ ] Add tests for:
  - text submit
  - empty submit ignored
  - streaming disables or changes submit action
  - model selector remains interactive only when allowed
  - attachment UI presence
  - optional speech input text append flow if enabled

---

## Phase 6: Adapt The Model Selector To The Real Catalog

### Objective

Use the example’s `ModelSelector` composition, but feed it from the app’s real model/provider catalog.

### Real data source

- `getProviderGroups()`
- `getProviderGroupMetadata()`
- `getModelsForGroup(providerGroup)`
- `runtime.setModelSelection(providerGroup, modelId)`

### Suggested component

```tsx
import type { ProviderGroupId } from "@/types/models"
import {
  getModelsForGroup,
  getProviderGroupMetadata,
  getProviderGroups,
} from "@/models/catalog"
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector"
import { PromptInputButton } from "@/components/ai-elements/prompt-input"

export function ChatModelSelector(props: {
  disabled?: boolean
  model: string
  onSelect: (providerGroup: ProviderGroupId, modelId: string) => void
  providerGroup: ProviderGroupId
}) {
  const providerGroups = getProviderGroups()

  return (
    <ModelSelector>
      <ModelSelectorTrigger asChild>
        <PromptInputButton disabled={props.disabled}>
          <ModelSelectorName>{props.model}</ModelSelectorName>
        </PromptInputButton>
      </ModelSelectorTrigger>

      <ModelSelectorContent>
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          {providerGroups.map((providerGroup) => (
            <ModelSelectorGroup
              heading={getProviderGroupMetadata(providerGroup).label}
              key={providerGroup}
            >
              {getModelsForGroup(providerGroup).map((model) => (
                <ModelSelectorItem
                  key={`${providerGroup}:${model.id}`}
                  onSelect={() => props.onSelect(providerGroup, model.id)}
                  value={`${providerGroup}:${model.id}`}
                >
                  <ModelSelectorLogo provider={model.provider} />
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}
```

### Persistence

Let `ChatShell` and the runtime continue owning persistence. `Chat` only calls the runtime mutation.

### Detailed todo list

- [ ] Create `src/components/new/chat-model-selector.tsx`.
- [ ] Group models visually the same way as the example:
  - provider family heading
  - rows inside each group
- [ ] Decide the displayed provider grouping vocabulary:
  - use provider group labels from catalog
  - or derive “chef” groupings that better match the example
- [ ] Show the selected model in the trigger with logo + name.
- [ ] Add trailing selected-state affordance matching the example’s checkmark pattern.
- [ ] Add provider logo grouping if multiple providers for one model should be shown.
- [ ] Ensure selecting a model closes the selector.
- [ ] Ensure model changes go through `runtime.setModelSelection(...)`.
- [ ] Decide whether additional settings persistence is needed in the shell after runtime mutation succeeds.
- [ ] Add tests for:
  - trigger rendering
  - grouped list rendering
  - selected-state marker
  - mutation callback arguments

---

## Phase 7: Suggestions And Empty State

### Objective

Mirror the example’s suggestions section, but keep it as a UI convenience layer only.

### Recommendation

Only show suggestions when the conversation is empty.

```tsx
const suggestions = [
  "Summarize this repository",
  "Explain the current runtime architecture",
  "Find the session persistence flow",
  "How does model switching work here?",
]
```

Then wire them directly to `runtime.send(...)`.

These should not be persisted separately.

### Detailed todo list

- [ ] Decide the initial suggestion set for this product instead of the demo topic set.
- [ ] Create a dedicated suggestions constant or helper.
- [ ] Render suggestions in the same area as the example: above the prompt, below the conversation.
- [ ] Ensure clicking a suggestion routes through the normal send flow.
- [ ] Decide whether suggestions should be hidden after the first message or remain available throughout the session.
- [ ] Add tests for suggestion rendering and click-to-send behavior.

---

## Phase 8: Unsupported Demo Features

### Attachments

Current blocker:

- `useRuntimeSession.send()` only accepts `string`
- `runtimeClient.send()` only accepts `string`
- `AgentHost.prompt()` only creates string user messages

Recommendation:

- keep the affordance visible for shape parity
- if sending is unsupported in v1, show the control as disabled or local-only with clear UX feedback

### Search toggle

Current blocker:

- no session field
- no runtime flag
- no provider execution path

Recommendation:

- keep the button visible for shape parity, but disable or local-toggle it until a runtime flag exists

### Sources

Current blocker:

- no citation/source metadata in the persisted assistant schema

Recommendation:

- keep the rendering slot in place, but render nothing until source data exists

### Branching / versions

Current blocker:

- no message version model

Recommendation:

- keep the wrapper shape in the message renderer, but only render controls when versions are present

### Detailed todo list

- [ ] Document which example elements are fully functional in v1.
- [ ] Document which example elements are present-but-disabled in v1.
- [ ] Decide the exact UX copy/tooltips for disabled attachment/search controls.
- [ ] Ensure no disabled control implies functionality that does not exist.
- [ ] Confirm that unsupported features do not leak into persisted session state accidentally.

---

## Test Plan

### Unit tests

- adapter helpers
  - text extraction
  - thinking extraction
  - tool-call extraction
- composer
  - trims input
  - disables send while streaming
- model selector
  - selecting a model calls the right runtime mutation

### Integration tests

- `ChatShell` renders `Chat` instead of the fallback thread/composer
- changing sessions in the shell updates `Chat` props
- sending a prompt through the ai-elements composer persists a user message
- assistant streaming updates the visible conversation
- model selection mutates the active session

### Manual QA

- switch sessions from the sidebar and confirm `Chat` updates immediately
- reload a deep link like `/chat?session=abc`
- stop a streaming response
- change model mid-session
- confirm tool calls and tool results still render

### Detailed todo list

- [ ] Add adapter unit tests.
- [ ] Add message renderer unit tests.
- [ ] Add composer unit tests.
- [ ] Add model selector unit tests.
- [ ] Add shell-to-chat integration tests.
- [ ] Add visual/manual QA checklist for:
  - empty session
  - active streaming session
  - session with tool calls/results
  - session switched from sidebar
  - long markdown response
  - reasoning block present
  - disabled attachment/search controls visible
  - mobile-width layout

---

## Detailed Todo List

### Phase 1: Shell integration

- [ ] Define the final `ChatProps` contract.
- [ ] Decide exact composition point inside `ReadyChatShell`.
- [ ] Wire `ChatShell` to render `Chat` with resolved props.
- [ ] Update `ChatPage` to mount the shell + `Chat`.
- [ ] Keep the old fallback until parity is complete.

### Phase 2: Adapter and message view model

- [ ] Create `chat-adapter.ts`.
- [ ] Implement text extraction helpers.
- [ ] Implement thinking extraction helpers.
- [ ] Implement tool-call extraction helpers.
- [ ] Implement optional version/source placeholders in the derived UI shape.
- [ ] Add adapter tests.

### Phase 3: Conversation surface

- [ ] Create `chat.tsx`.
- [ ] Implement top-level flex/divide-y layout to match the example.
- [ ] Implement `Conversation` + `ConversationContent` + `ConversationScrollButton`.
- [ ] Add mapped message rendering loop.
- [ ] Add suggestion strip region.
- [ ] Add prompt region container.

### Phase 4: Message renderer

- [ ] Create `chat-message.tsx`.
- [ ] Implement user message rendering.
- [ ] Implement assistant message rendering.
- [ ] Implement reasoning rendering.
- [ ] Implement source rendering slot.
- [ ] Implement single-version `MessageBranch` wrapper.
- [ ] Implement conditional branch selector rendering.
- [ ] Integrate tool call rendering.
- [ ] Integrate tool result rendering.
- [ ] Add message renderer tests.

### Phase 5: Composer

- [ ] Create `chat-composer.tsx`.
- [ ] Implement textarea state.
- [ ] Implement submit handling.
- [ ] Implement status mapping.
- [ ] Implement attachments header display.
- [ ] Implement attachment action menu.
- [ ] Implement speech input.
- [ ] Implement search button.
- [ ] Implement submit/stop affordance.
- [ ] Implement error display.
- [ ] Add composer tests.

### Phase 6: Model selector

- [ ] Create `chat-model-selector.tsx`.
- [ ] Map catalog data into grouped ai-elements items.
- [ ] Implement selected-state indicator.
- [ ] Implement trigger with logo + name.
- [ ] Implement mutation callback wiring.
- [ ] Add selector tests.

### Phase 7: Unsupported feature handling

- [ ] Decide disabled vs local-only behavior for attachments.
- [ ] Decide disabled vs cosmetic-toggle behavior for search.
- [ ] Decide whether speech input ships in v1 or is gated.
- [ ] Keep source and branch rendering slots in place.
- [ ] Ensure unsupported features do not mutate persisted state.

### Phase 8: Verification

- [ ] Run unit tests for adapter, messages, composer, selector.
- [ ] Run integration tests for shell-to-chat handoff.
- [ ] Perform manual QA for all major states.
- [ ] Compare the final inner surface visually against the reference example.
- [ ] Remove the old fallback once parity is acceptable.

---

## Final Recommendation

Use `ChatShell` as the owner of active session/runtime state and build `Chat` as the inner ai-elements surface on top of that.

That is the simplest design now that the shell already exists:

- one owner for session state
- one owner for runtime mutations
- no duplicate query-param logic
- no custom event bridge
- no ambiguity about responsibility

The ai-elements migration should stay focused on presentation and input UX, not on re-solving shell/session coordination that is already implemented.
