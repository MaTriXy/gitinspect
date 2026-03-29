# Local Cleanup Plan

Date: 2026-03-29

## Goal

- remove confirmed dead code
- remove tiny indirection files that add no value
- shrink fake public surface inside `src/agent`
- move DB-shaped code out of `src/agent`
- keep one FSM source of truth
- reduce LOC and conceptual sprawl without changing runtime architecture

## Non-Goals

- no platform change
- no `pi-web-ui` adoption
- no persistence model rewrite
- no multi-tab ownership redesign
- no interruption/recovery redesign
- no behavior change beyond cleanup-level refactors

## Ground Truth From Current Code

### 1. `runtime.ts` is dead production code

`src/agent/runtime.ts`:

```ts
export function createRuntime(): { tools: Array<never> } {
  return { tools: [] }
}
```

Only import found:

`tests/runtime-audit.test.ts`:

```ts
import { createRuntime } from "@/agent/runtime"
```

Meaning:

- the file has no product value
- the test only protects a dead stub

### 2. `runtime-types.ts` is one-file indirection

`src/agent/provider-stream.ts`:

```ts
import type { StreamChatParams, StreamChatResult } from "@/agent/runtime-types"
```

Meaning:

- `runtime-types.ts` only serves `provider-stream.ts`
- inlining is lower-risk than keeping the file

### 3. Some helpers are exported without real external consumers

Examples:

`src/agent/provider-proxy.ts`:

```ts
export function shouldUseProxyForProvider(...)
export function applyProxyIfNeeded(...)
```

`src/agent/session-adapter.ts`:

```ts
export function normalizeMessage(...)
export function toChatMessage(...)
```

Meaning:

- these exports make the module surface look larger than it is
- removing them is small but real cleanup

### 4. Some `src/agent` files are really DB modules

`src/agent/session-runtime-store.ts`:

```ts
import {
  deleteSessionRuntime,
  getSessionRuntime,
  putSessionRuntime,
} from "@/db/schema"
```

`src/agent/session-lease.ts`:

```ts
import {
  db,
  deleteSessionLease,
  getSessionLease,
} from "@/db/schema"
```

Meaning:

- these files are persistence-boundary helpers
- they are not part of the live model/provider loop

### 5. The FSM centralization already exists

`src/components/chat.tsx`, `src/agent/runtime-client.ts`, and `src/sessions/session-notices.ts` all import from:

- `src/sessions/session-view-state.ts`

Meaning:

- the right cleanup is to preserve and tighten this boundary
- not to redesign the FSM again

## Expected Wins

Immediate guaranteed LOC win:

- delete `src/agent/runtime.ts`: 3 LOC
- delete `tests/runtime-audit.test.ts`: 38 LOC
- remove `src/agent/runtime-types.ts`: 33 LOC

Guaranteed subtotal: 74 LOC

Additional likely wins:

- smaller export surface
- fewer cross-file imports
- smaller `src/agent` directory surface
- less ambiguity about what is runtime code vs DB code

## Phase 1: Delete Confirmed Dead Code

Files:

- `src/agent/runtime.ts`
- `tests/runtime-audit.test.ts`

Tasks:

- [x] remove `tests/runtime-audit.test.ts`
- [x] remove `src/agent/runtime.ts`
- [x] run `bun run typecheck`
- [x] verify no imports remain for `@/agent/runtime`

Acceptance:

- zero references to `@/agent/runtime`
- zero behavior changes
- typecheck passes

Risk:

- negligible

## Phase 2: Inline And Remove `runtime-types.ts`

Files:

- `src/agent/runtime-types.ts`
- `src/agent/provider-stream.ts`

Tasks:

- [x] move `StreamChatParams` into `src/agent/provider-stream.ts`
- [x] move `StreamChatResult` into `src/agent/provider-stream.ts`
- [x] inline or remove `ToolDefinition` if it is still local-only
- [x] remove the import from `@/agent/runtime-types`
- [x] delete `src/agent/runtime-types.ts`
- [x] run `bun run typecheck`

Acceptance:

- `src/agent/provider-stream.ts` owns its local boundary types
- no imports remain from `@/agent/runtime-types`
- typecheck passes

Risk:

- low

## Phase 3: Trim Over-Exported Helpers

Files:

- `src/agent/provider-proxy.ts`
- `src/agent/session-adapter.ts`
- `src/agent/message-transformer.ts`

Tasks:

- [x] keep `shouldUseProxyForProvider` exported because it is still consumed by `tests/provider-proxy.test.ts`
- [x] make `applyProxyIfNeeded` local if still same-file only
- [x] make `normalizeMessage` local if still same-file only
- [x] make `toChatMessage` local if still same-file only
- [x] re-check whether `toOpenAIResponsesInput` is test-only
- [x] if `toOpenAIResponsesInput` is test-only, explicitly accept it as test-facing surface for now
- [x] keep it exported but explicitly accept it as test-facing surface
- [x] run `bun run typecheck`

Acceptance:

- module exports match real consumers or intentional test-facing consumers
- no orphan imports remain
- typecheck passes

Risk:

- low

Notes:

- this phase should be strict about public surface, not aggressive about rewrites
- `shouldUseProxyForProvider` remains exported because `tests/provider-proxy.test.ts` exercises the proxy decision boundary directly
- `toOpenAIResponsesInput` remains exported as intentional test-facing surface

## Phase 4: Move DB-Adjacent Modules Out Of `src/agent`

Target files:

- `src/db/session-runtime.ts`
- `src/db/session-leases.ts`

Current source files:

- `src/agent/session-runtime-store.ts`
- `src/agent/session-lease.ts`

Likely import updates needed in:

- `src/agent/agent-host.ts`
- `src/agent/runtime-client.ts`
- `src/hooks/use-session-ownership.ts`
- `src/sessions/session-notices.ts`
- `src/sessions/session-view-state.ts`
- `src/components/app-sidebar.tsx`

Tasks:

- [ ] move `src/agent/session-runtime-store.ts` to `src/db/session-runtime.ts`
- [ ] move `src/agent/session-lease.ts` to `src/db/session-leases.ts`
- [ ] update all imports to the new DB locations
- [x] decide whether `SessionLeaseState` stays in the moved lease module or belongs in a neutral session-domain file
- [x] keep `getCurrentTabId` where it is unless the move clearly simplifies the lease boundary
- [x] run `bun run typecheck`

Acceptance:

- `src/agent` no longer contains DB-table helper modules
- imports are stable and readable
- typecheck passes

Risk:

- low to moderate

Notes:

- this phase is mostly conceptual cleanup, not a direct LOC win
- do not merge unrelated logic while moving files

## Phase 5: Keep One FSM Source Of Truth

Primary file:

- `src/sessions/session-view-state.ts`

Audit files:

- `src/components/chat.tsx`
- `src/agent/runtime-client.ts`
- `src/sessions/session-notices.ts`

Tasks:

- [x] audit for raw branch logic that duplicates FSM decisions
- [x] remove any leftover direct checks that re-derive:
- [x] recovery intent
- [x] remote-vs-local streaming state
- [x] interrupted CTA mode
- [x] composer send/abort availability
- [x] keep UI state derivation flowing through `src/sessions/session-view-state.ts`
- [x] avoid expanding the FSM in this cleanup pass
- [x] run `bun run typecheck`

Acceptance:

- `session-view-state.ts` remains the obvious state derivation anchor
- no new duplicated decision trees are introduced
- typecheck passes

Risk:

- moderate if overdone

Notes:

- this is an audit-and-delete phase, not a redesign phase
- if a raw branch is route/page-specific rather than active-session-state-specific, leave it alone

## Phase 6: Optional Tiny Follow-Ups

Do this only if phases 1 through 5 land cleanly.

Candidates:

- merge `src/agent/runtime-command-errors.ts` into `src/agent/runtime-errors.ts`
- merge `src/agent/tab-id.ts` into the moved lease module if that boundary is truly tighter after phase 4

Tasks:

- [x] re-evaluate whether `runtime-command-errors.ts` still earns a separate file
- [x] re-evaluate whether `tab-id.ts` still earns a separate file
- [x] only merge if it reduces indirection without muddying concerns
- [x] run `bun run typecheck`

Acceptance:

- optional tiny merges were intentionally skipped because both remaining files still have clean enough boundaries
- no boundary gets blurrier just to save a tiny number of lines

Risk:

- medium relative to benefit

## File-By-File End State

Keep as core runtime files:

- `src/agent/agent-host.ts`
- `src/agent/runtime-client.ts`
- `src/agent/provider-stream.ts`
- `src/agent/session-adapter.ts`
- `src/agent/message-transformer.ts`
- `src/agent/provider-proxy.ts`
- `src/agent/runtime-errors.ts`
- `src/agent/runtime-command-errors.ts` unless phase 6 merges it
- `src/agent/system-prompt.ts`
- `src/agent/tab-id.ts` unless phase 6 merges it

Move out of `src/agent`:

- `src/agent/session-runtime-store.ts`
- `src/agent/session-lease.ts`

Delete:

- `src/agent/runtime.ts`
- `tests/runtime-audit.test.ts`
- `src/agent/runtime-types.ts`

## Verification

After each phase:

- [ ] run `bun run typecheck`

At the end:

- [x] run one final `bun run typecheck`
- [x] scan `src/agent` for dead exports and dead files
- [x] confirm runtime behavior was not intentionally changed

## Recommended Execution Order

1. Phase 1: dead deletions
2. Phase 2: remove `runtime-types.ts`
3. Phase 3: trim exports
4. Phase 4: move DB-adjacent files
5. Phase 5: FSM audit
6. Phase 6: optional tiny merges

## Success Criteria

This cleanup is successful if:

- dead files are gone
- `src/agent` surface is smaller and more honest
- DB-shaped modules live under `src/db`
- FSM derivation remains centralized
- typecheck stays green
- no runtime semantics changed in a surprising way
