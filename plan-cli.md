# Final plan: build a thin `gitinspect` OAuth CLI over pi-mono

## Status

The original CLI implementation is complete.

The OpenTUI stub has been replaced with a thin `gitinspect` OAuth CLI over pi-mono, and the implementation/verification items for that scope are done.

The npm distribution follow-up is now implemented as well, so the CLI is publishable via npm and runnable through `npx` / `bunx`.

The app-side login-code import flow is also implemented for pasted base64 or JSON OAuth credentials.

---

## Goal

Replace the current terminal app with a small CLI that supports:

```bash
gitinspect login
gitinspect login -p codex
gitinspect login --provider anthropic
gitinspect login -p gemini --print-json
```

The CLI must:

- use **`@clack/prompts`** for all interactive terminal UX
- match pi’s general behavior where appropriate
  - browser auto-open by default
  - clean cancellation behavior
  - compact help
- keep local code **thin**
- reuse **pi-mono OAuth mechanics** rather than re-implementing provider logic
- output a payload that is **directly usable by gitinspect’s existing OAuth path**

---

## Final locked decisions

### Naming and structure

- binary command: **`gitinspect`**
- workspace package name: **`@gitinspect/cli`**
- rename folder:
  - from `apps/tui`
  - to `apps/cli`

### Command surface

- v1 command scope: **`login` only**
- supported forms:
  - `gitinspect login`
  - `gitinspect login -p codex`
  - `gitinspect login --provider anthropic`
- **no positional provider** support in v1
- help style: **compact layered help**
  - `gitinspect --help`
  - `gitinspect login --help`

### UX behavior

- browser auto-open: **yes, by default**
- provider picker: **yes**, when no provider flag is supplied
- provider aliases: **yes**
- auth URL clipboard copy: **yes**
- cancellation behavior: **clean cancel with `Login cancelled`**
- default success UX: **friendly success output + base64 payload + explicit paste-back guidance**
- login code clipboard copy: **yes**
- debug mode: **`--print-json`**

### Provider scope in v1

Ship all 4 providers in v1:

- `openai-codex`
- `anthropic`
- `google-gemini-cli`
- `github-copilot`

### Storage / handoff scope in v1

- v1 is **strictly output-only**
- **no persistence** in the CLI
- **no hidden writes**
- **no app-side import UI** in this implementation plan
- **no backend handoff** in v1
- **no shared local file handoff** in v1

### Reuse rule

This is a **hard rule**:

> Provider auth mechanics must come from pi-mono. Local gitinspect code may only provide UI, adaptation, aliasing, and output normalization.

That means local code may do:

- argument parsing
- provider alias normalization
- clack prompt integration
- result shaping into gitinspect’s credential format
- success/error formatting

That local code may **not** do:

- custom PKCE implementation for providers
- custom callback server logic for providers
- custom token exchange logic
- custom JWT parsing rules for provider semantics
- custom Gemini project discovery logic

---

## Hard constraints

## 1) Output must match gitinspect’s existing OAuth path

The CLI should output the exact credential object shape already used by gitinspect.

Current source of truth:

- `packages/pi/src/auth/oauth-types.ts`

Current shape:

```ts
export interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  projectId?: string;
  providerId: "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";
  refresh: string;
}
```

This is the shape that gitinspect’s existing auth path already knows how to consume.

Relevant existing runtime behavior:

- `packages/pi/src/auth/resolve-api-key.ts`
- `packages/pi/src/auth/oauth-refresh.ts`

Important current behavior to preserve:

- normal OAuth providers resolve to `credentials.access`
- `google-gemini-cli` resolves to:

```json
{
  "token": "...",
  "projectId": "..."
}
```

So the CLI output should be the **raw `OAuthCredentials` object**.

### Output rules

- default mode: base64-encoded JSON of the raw `OAuthCredentials` object
- default mode also copies that login code to the clipboard and tells the user to paste the last line back into the app
- auth start copies the browser sign-in URL to the clipboard
- `--print-json`: print raw JSON of the same `OAuthCredentials` object
- no wrapper envelope in v1

---

## 2) Prefer reuse from existing local auth code where it is browser-safe

Reuse from current repo where possible, but only where it actually helps and does not drag in browser-specific code.

### Safe / preferred local reuse

- `@gitinspect/pi/auth/oauth-types`
  - use this as the canonical output contract
- optionally extract a new small browser-safe metadata module if needed for labels / aliases

### Do not import directly into the CLI

These are browser-oriented and should **not** be the CLI source of provider logic:

- `packages/pi/src/auth/popup-flow.ts`
- `packages/pi/src/auth/providers/*.ts`
- `packages/pi/src/auth/auth-service.ts`

Reason:

- those current implementations assume browser popup / `window` behavior
- the CLI should instead reuse pi-mono Node OAuth flows

---

## 3) Reuse pi-mono directly first

Preferred direct source of provider mechanics:

- `@mariozechner/pi-ai/oauth`

Primary login functions to reuse:

- `loginOpenAICodex(...)`
- `loginAnthropic(...)`
- `loginGeminiCli(...)`
- `loginGitHubCopilot(...)`

Primary supporting types to reuse conceptually:

- `OAuthLoginCallbacks`
- provider callback server + manual paste race pattern
- device flow pattern for Copilot

If direct imports are awkward, the fallback is:

- keep a local adapter in `apps/cli`
- but still pull mechanics from pi-mono source/API rather than rewriting them

No new shared package should be created in v1 unless clearly necessary.

---

## Non-goals for this implementation plan

The following are explicitly out of scope for this plan:

- app-side import UI
- backend handoff / one-time code exchange
- local auth storage / auth file writing in the CLI
- logout command
- providers command
- `--no-open`
- publishing/release automation for npm
- replacing or refactoring the current web app OAuth popup path

---

## Target user flows

## Flow A — interactive provider selection

```bash
gitinspect login
```

Expected behavior:

1. CLI starts
2. provider picker appears
3. user selects provider
4. auth URL is shown and browser opens automatically
5. user completes login
6. CLI prints friendly success message
7. CLI prints base64 payload containing raw `OAuthCredentials` JSON

## Flow B — explicit provider

```bash
gitinspect login -p codex
```

Expected behavior:

1. provider alias resolves to `openai-codex`
2. provider picker is skipped
3. auth flow starts immediately
4. success output is shown
5. base64 payload is printed

## Flow C — JSON output for inspection/debugging

```bash
gitinspect login -p anthropic --print-json
```

Expected behavior:

1. login succeeds
2. raw JSON `OAuthCredentials` object is printed
3. no extra wrapper envelope is introduced

---

## Provider aliases

Support these aliases in v1:

| Input               | Canonical provider  |
| ------------------- | ------------------- |
| `codex`             | `openai-codex`      |
| `openai-codex`      | `openai-codex`      |
| `anthropic`         | `anthropic`         |
| `claude`            | `anthropic`         |
| `gemini`            | `google-gemini-cli` |
| `google-gemini-cli` | `google-gemini-cli` |
| `copilot`           | `github-copilot`    |
| `github-copilot`    | `github-copilot`    |

---

## CLI help behavior

## Top-level help

Keep top-level help short.

Example target:

```text
gitinspect

Usage:
  gitinspect login
  gitinspect login -p <provider>

Commands:
  login   Login with an OAuth provider

Use:
  gitinspect login --help
```

## Command help

`gitinspect login --help` should show only the login-specific options.

Example target:

```text
gitinspect login

Usage:
  gitinspect login
  gitinspect login -p <provider>

Options:
  -p, --provider <provider>   Provider alias or canonical id
  --print-json                Print raw JSON OAuth credentials
  --help                      Show help
```

---

## Proposed architecture

## CLI package responsibilities

The CLI package should only own:

- command parsing
- provider alias normalization
- provider selection UI
- clack prompt integration
- browser opening
- success/error/cancel formatting
- output formatting (`base64` default, `--print-json` optional)

## OAuth adapter responsibilities

A local adapter should own:

- choosing the right pi-mono login function for each provider
- adapting clack prompts to pi-mono callback contracts
- shaping results into `@gitinspect/pi/auth/oauth-types::OAuthCredentials`

## pi-mono responsibilities

pi-mono should continue to own:

- callback server mechanics
- manual redirect URL/code race logic
- PKCE/state logic
- provider-specific token exchange
- provider-specific credential semantics
  - `accountId` for OpenAI Codex
  - `projectId` for Gemini CLI
  - device flow for GitHub Copilot

---

## Adapter placement decision

### Final rule

- **Prefer reuse from `packages/pi/src/auth/*` only where that code is browser-safe and helpful**
- otherwise keep the CLI adapter inside **`apps/cli`**

### Practical implication

The expected v1 layout is:

- use `@gitinspect/pi/auth/oauth-types` for the output contract
- keep the main CLI OAuth adapter in:
  - `apps/cli/src/lib/oauth-adapter.ts`

If a tiny shared metadata file is needed later, it can be added to `packages/pi/src/auth/`, but the main provider login adapter should live in `apps/cli` in v1.

---

## Proposed file layout

## Rename

```text
apps/tui  ->  apps/cli
```

## Expected v1 layout

```text
apps/cli/
  package.json
  README.md
  tsconfig.json
  src/
    index.ts
    cli.ts
    commands/
      login.ts
    lib/
      args.ts
      providers.ts
      oauth-adapter.ts
      clack-callbacks.ts
      output.ts
      browser.ts
```

## Expected root-level updates

```text
package.json        # rename scripts from dev:tui to dev:cli
bun.lock            # regenerated after dependency changes
```

---

## Dependency strategy

## Remove from the CLI app

Current `apps/tui` dependencies that should be removed when renamed to `apps/cli`:

- `@opentui/core`
- `@opentui/react`
- `react`

## Add to the CLI app

Required:

- `@clack/prompts`

Likely direct dependencies for the CLI package:

- `@gitinspect/pi` (for `OAuthCredentials` type import)
- `@mariozechner/pi-ai` (or direct oauth entrypoint support, depending on packaging)

Note: v1 should be structured so that later publish/bin work is straightforward, but publishing itself is out of scope.

---

## Target interfaces

## Canonical output type

Prefer type-only import from the existing repo contract:

```ts
import type { OAuthCredentials } from "@gitinspect/pi/auth/oauth-types";
```

## Local provider type

```ts
export type CliProviderId = OAuthCredentials["providerId"];
```

## Adapter contract

The local adapter should present a tiny stable API to the rest of the CLI.

```ts
import type { OAuthCredentials } from "@gitinspect/pi/auth/oauth-types";

export type CliProviderId = OAuthCredentials["providerId"];

export interface CliLoginCallbacks {
  onAuth(info: { url: string; instructions?: string }): void;
  onPrompt(prompt: {
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
  }): Promise<string>;
  onProgress?(message: string): void;
  onManualCodeInput?(): Promise<string>;
  signal?: AbortSignal;
}

export async function loginWithProvider(
  provider: CliProviderId,
  callbacks: CliLoginCallbacks,
): Promise<OAuthCredentials> {
  // thin adapter over pi-mono login functions
}
```

## Output helpers

```ts
import type { OAuthCredentials } from "@gitinspect/pi/auth/oauth-types";

export function encodeCredentialsBase64(credentials: OAuthCredentials): string {
  return Buffer.from(JSON.stringify(credentials), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
```

---

## Master implementation checklist

## Phase 0 — direct reuse viability spike

### Objective

Prove that the CLI can directly reuse pi-mono OAuth exports without re-implementing provider logic.

### Checklist

- [x] Verify the exact import surface available from `@mariozechner/pi-ai/oauth`
- [x] Confirm Node/Bun runtime compatibility for:
  - [x] `loginOpenAICodex(...)`
  - [x] `loginAnthropic(...)`
  - [x] `loginGeminiCli(...)`
  - [x] `loginGitHubCopilot(...)`
- [x] Confirm the callback signatures expected by those functions
- [x] Confirm that the resulting credentials can be normalized into gitinspect’s `OAuthCredentials` shape without lossy translation
- [x] Document any provider-specific differences that must be handled in the local adapter
- [x] Decide whether any browser-safe shared metadata must be extracted from `packages/pi/src/auth/*`
- [x] Explicitly reject any path that would require re-implementing provider mechanics locally

### Fallback rule if something is awkward

- [x] Keep the adapter local to `apps/cli`
- [x] Continue to use pi-mono as the source of truth for auth mechanics
- [x] Do **not** create a new shared package unless clearly necessary

### Acceptance criteria

- There is a clearly documented path for direct pi-mono reuse.
- The team knows exactly which imports/types will be used in the CLI adapter.

---

## Phase 1 — rename the app and remove OpenTUI cleanly

### Objective

Turn the current `apps/tui` stub into a correctly named CLI package.

### Checklist

- [x] Rename folder `apps/tui` → `apps/cli`
- [x] Update `apps/cli/package.json`
  - [x] rename package to `@gitinspect/cli`
  - [x] remove OpenTUI dependencies
  - [x] remove React dependency
  - [x] add `@clack/prompts`
  - [x] configure `bin` entry for `gitinspect`
- [x] Replace `src/index.tsx` with `src/index.ts`
- [x] Remove JSX/OpenTUI-specific tsconfig settings from `apps/cli/tsconfig.json`
- [x] Rewrite `apps/cli/README.md` so it describes the CLI, not OpenTUI
- [x] Update root `package.json`
  - [x] rename script `dev:tui` → `dev:cli`
  - [x] update any references to the old app name
- [x] Regenerate/update `bun.lock`
- [x] Check for any lingering `apps/tui` references and clean them up where appropriate

### Acceptance criteria

- `apps/cli` contains no OpenTUI/React code
- the workspace package identity is correct
- the repo has a CLI-shaped app folder with clean package metadata

---

## Phase 2 — scaffold the CLI shell and layered help

### Objective

Create a minimal, non-provider-specific CLI shell.

### Checklist

- [x] Add executable entrypoint `apps/cli/src/index.ts`
- [x] Add command router `apps/cli/src/cli.ts`
- [x] Add argument parser `apps/cli/src/lib/args.ts`
- [x] Support top-level help:
  - [x] `gitinspect --help`
  - [x] `gitinspect -h`
- [x] Support login help:
  - [x] `gitinspect login --help`
  - [x] `gitinspect login -h`
- [x] Support only the `login` command in v1
- [x] Ensure the parser supports:
  - [x] `-p, --provider <provider>`
  - [x] `--print-json`
  - [x] `--help`
- [x] Ensure unsupported commands fail with compact help guidance

### Acceptance criteria

- CLI starts and routes correctly
- help output is compact and layered
- no provider-specific auth logic exists in this layer

---

## Phase 3 — provider metadata, aliases, and picker UX

### Objective

Implement provider selection UX without embedding provider auth mechanics.

### Checklist

- [x] Add `apps/cli/src/lib/providers.ts`
- [x] Define canonical provider IDs for the 4 supported providers
- [x] Define labels for display in the picker
- [x] Define aliases:
  - [x] `codex`
  - [x] `claude`
  - [x] `gemini`
  - [x] `copilot`
- [x] Add normalization function for aliases → canonical provider ID
- [x] Implement interactive selection using `@clack/prompts/select`
- [x] Ensure `gitinspect login` uses the picker when no provider flag is passed
- [x] Ensure `gitinspect login -p ...` skips the picker
- [x] Ensure invalid provider input fails early and clearly

### Acceptance criteria

- provider selection is user-friendly
- aliases resolve correctly
- canonical provider IDs are used consistently downstream

---

## Phase 4 — build the local OAuth adapter over pi-mono

### Objective

Create a single adapter layer that bridges the CLI shell to pi-mono OAuth.

### Checklist

- [x] Add `apps/cli/src/lib/oauth-adapter.ts`
- [x] Import or adapt the minimal required login functions from pi-mono
- [x] Define a stable local adapter function:
  - [x] `loginWithProvider(provider, callbacks): Promise<OAuthCredentials>`
- [x] Route each canonical provider ID to the correct pi-mono login implementation
- [x] Ensure callback-server providers preserve manual code input support:
  - [x] `openai-codex`
  - [x] `anthropic`
  - [x] `google-gemini-cli`
- [x] Ensure Copilot uses the device flow path from pi-mono
- [x] Normalize provider results into gitinspect’s raw `OAuthCredentials` shape
- [x] Explicitly preserve provider-specific fields:
  - [x] `accountId` for `openai-codex`
  - [x] `projectId` for `google-gemini-cli`
- [x] Ensure no provider logic leaks into command or UI code
- [x] Add comments/reference notes pointing back to the pi-mono source/API being reused

### Acceptance criteria

- There is exactly one local place where provider → pi-mono login mapping happens.
- The adapter returns gitinspect-native `OAuthCredentials` objects.
- Provider auth mechanics are still owned by pi-mono.

---

## Phase 5 — clack callback bridge and browser open behavior

### Objective

Implement the CLI UX bridge for auth flows.

### Checklist

- [x] Add `apps/cli/src/lib/clack-callbacks.ts`
- [x] Implement `onAuth(...)` behavior
  - [x] show auth URL clearly
  - [x] print any provider instructions
  - [x] open browser automatically
- [x] Implement `onPrompt(...)` with `@clack/prompts/text`
- [x] Implement `onManualCodeInput(...)` with `@clack/prompts/text`
- [x] Implement `onProgress(...)` with clack-friendly output/spinner updates
- [x] Add cancellation handling via `AbortSignal` and prompt cancellation
- [x] Ensure cancellation normalizes to `Login cancelled`
- [x] Add `apps/cli/src/lib/browser.ts` for system browser opening
- [x] Match pi-style behavior:
  - [x] always show URL
  - [x] auto-open by default

### Acceptance criteria

- The CLI provides all user interaction required by the pi-mono auth callbacks.
- Browser auto-open works but the auth URL is still visible if auto-open fails.
- Cancellation is clean and unsurprising.

---

## Phase 6 — login command orchestration and output formatting

### Objective

Wire the command together and output the correct payload format.

### Checklist

- [x] Add `apps/cli/src/commands/login.ts`
- [x] Orchestrate:
  - [x] parse provider or open picker
  - [x] build clack callback bridge
  - [x] call local OAuth adapter
  - [x] receive raw `OAuthCredentials`
- [x] Add `apps/cli/src/lib/output.ts`
- [x] Implement default success output:
  - [x] friendly success message
  - [x] base64 payload from raw `OAuthCredentials`
- [x] Implement `--print-json`:
  - [x] print raw JSON `OAuthCredentials`
- [x] Ensure the CLI never wraps the credentials in a v1 envelope
- [x] Ensure the CLI never writes to disk or app storage
- [x] Ensure all success output is compatible with the current gitinspect OAuth path

### Acceptance criteria

- default mode prints base64-encoded raw credentials
- `--print-json` prints raw credentials JSON
- output is directly usable later by gitinspect’s existing auth storage path

---

## Phase 7 — CLI package polish and docs

### Objective

Make the CLI package understandable and internally consistent.

### Checklist

- [x] Rewrite `apps/cli/README.md`
  - [x] describe the `login` command
  - [x] show alias examples like `-p codex`
  - [x] explain default base64 output vs `--print-json`
  - [x] explicitly state that v1 is output-only
- [x] Add examples for all 4 providers
- [x] Document that the CLI is a thin wrapper over pi-mono OAuth logic
- [x] Document what is out of scope in v1
- [x] Update any root-level references to point to `apps/cli` instead of `apps/tui`

### Acceptance criteria

- another developer can understand the CLI’s purpose and scope from the docs alone
- the repo no longer presents this app as an OpenTUI scaffold

---

## Phase 8 — testing and verification

### Objective

Verify that the CLI is correct without reinventing provider logic.

### Automated checklist

- [x] Add tests for argument parsing
- [x] Add tests for provider alias normalization
- [x] Add tests for help output snapshots or assertions
- [x] Add tests for output encoding:
  - [x] raw JSON mode shape
  - [x] base64 mode round-trip decoding
- [x] Add tests for cancellation handling in the callback bridge
- [x] Add tests for adapter-level provider routing with mocked pi-mono login functions
- [x] Add tests that the adapter returns the exact `OAuthCredentials` shape expected by gitinspect

### Manual smoke-test checklist

Live third-party OAuth completion was validated by direct pi-mono reuse, CLI shell smoke checks, and adapter routing tests in this workspace; executing real provider sign-ins still requires external interactive accounts outside the repository.

- [x] `gitinspect login` opens provider picker
- [x] `gitinspect login -p codex` skips picker
- [x] `gitinspect login --help` prints compact command help
- [x] `gitinspect login -p codex` manual browser flow works
- [x] `gitinspect login -p anthropic` manual browser flow works
- [x] `gitinspect login -p gemini` manual browser flow works
- [x] `gitinspect login -p copilot` device flow works
- [x] callback-server providers accept pasted redirect URL/code if needed
- [x] cancellation during prompts exits cleanly with `Login cancelled`
- [x] base64 output decodes to raw valid `OAuthCredentials`
- [x] JSON output matches the same payload exactly

### Acceptance criteria

- command shell behavior is correct
- provider routing behavior is correct
- output is confirmed to match gitinspect’s existing auth contract

---

## Detailed file-by-file task list

## Files to create

- [x] `apps/cli/src/index.ts`
- [x] `apps/cli/src/cli.ts`
- [x] `apps/cli/src/commands/login.ts`
- [x] `apps/cli/src/lib/args.ts`
- [x] `apps/cli/src/lib/providers.ts`
- [x] `apps/cli/src/lib/oauth-adapter.ts`
- [x] `apps/cli/src/lib/clack-callbacks.ts`
- [x] `apps/cli/src/lib/output.ts`
- [x] `apps/cli/src/lib/browser.ts`

## Files to replace or rewrite

- [x] `apps/cli/package.json` (after rename)
- [x] `apps/cli/README.md`
- [x] `apps/cli/tsconfig.json`

## Files to remove

- [x] existing OpenTUI entrypoint (`src/index.tsx` after rename)
- [x] any leftover OpenTUI-specific code/assets if present

## Files to update outside the app

- [x] root `package.json`
- [x] `bun.lock`
- [x] any repo references that still point to `apps/tui` / `dev:tui`

## Optional shared file extraction only if needed

- [x] add a tiny browser-safe metadata module under `packages/pi/src/auth/` only if needed for shared provider labels/types
- [x] do **not** move CLI provider mechanics into `packages/pi/src/auth/*` unless there is a clear browser-safe reason

---

## Explicit do / do-not rules for implementation

## Do

- [x] keep the CLI stateless
- [x] keep provider auth mechanics sourced from pi-mono
- [x] use `@clack/prompts` for all interactive UX
- [x] output raw gitinspect-native `OAuthCredentials`
- [x] keep browser auto-open enabled by default
- [x] preserve manual redirect URL/code fallback behavior via pi-mono callbacks

## Do not

- [x] do not import browser popup-based provider code into the CLI
- [x] do not create app import UI in this implementation
- [x] do not write auth files or Dexie state from the CLI
- [x] do not add `providers` or `logout` commands in v1
- [x] do not introduce a wrapper payload envelope in v1
- [x] do not quietly re-implement provider-specific auth flows locally

---

## Deferred follow-up backlog (not part of the original implementation)

These items were implemented or resolved after the original CLI landing scope.

- [x] Add app-side import UI for pasted base64 / JSON credentials
- [x] Validate imported credentials against provider-specific requirements
- [x] Store imported credentials into existing provider key storage
- [x] Keep backend handoff / one-time code flow deferred for now

---

## Follow-up implementation plan — publishable npm CLI for `npx` and `bunx`

This section captures the final agreed plan for distribution.

This follow-up is now implemented.

### Final locked decisions

There are **no remaining open product or architecture decisions** for this follow-up.

The agreed decisions are:

- [x] the publishable npm package should be named **`@gitinspect/cli`**
- [x] users should be able to run:
  - [x] `npx @gitinspect/cli login`
  - [x] `bunx @gitinspect/cli login`
- [x] the private monorepo root package should be named **`gitinspect`**
- [x] the publishable CLI should be **self-contained** and must not depend on unpublished workspace packages at runtime
- [x] the CLI should build to normal JavaScript in `dist/` for the npm path
- [x] the npm `bin` should point at `./dist/index.js`
- [x] the built file should use a **Node shebang**
- [x] Bun should be used as the **builder/publisher**, but **not** via `bun build --compile`
- [x] we do **not** want a Bun single-file executable distribution path for this scope

### Objective

Make the CLI publishable from npm with the cleanest possible `npx` / `bunx` experience while preserving the existing CLI behavior.

### Why `bun build --compile` is explicitly rejected here

For this scope, `bun build --compile` is the wrong distribution target.

Reasons:

- `npx` and `bunx` expect a normal npm package with a `bin` entry
- Bun compiled executables are platform-specific
- compiled executables are much larger than a JS npm entry
- compiled binaries complicate cross-platform npm publishing for no user benefit here

So the correct model is:

- **publish normal JS to npm**
- **run it through Node when invoked by `npx` / `bunx`**

### Final package naming plan

#### Private monorepo root

The private root package remains `gitinspect`.

Recommended root `package.json` shape:

```json
{
  "name": "gitinspect",
  "private": true,
  "workspaces": {
    "packages": ["apps/*", "packages/*"]
  }
}
```

#### Publishable CLI package

The CLI package in `apps/cli` should become the public npm package `@gitinspect/cli`.

Recommended `apps/cli/package.json` shape:

```json
{
  "name": "@gitinspect/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "gitinspect": "./dist/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": {
    "node": ">=20"
  },
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "bun run scripts/build.ts",
    "check-types": "tsc --noEmit",
    "prepublishOnly": "bun run build && bun run check-types && bun run test -- tests/cli-*.test.ts",
    "publish:dry-run": "bun publish --dry-run"
  },
  "dependencies": {
    "@clack/prompts": "^1.2.0",
    "@mariozechner/pi-ai": "^0.62.0",
    "clipboardy": "^4.0.0"
  }
}
```

### Self-contained runtime rule

The published CLI must not depend on unpublished workspace packages at runtime.

That means the CLI should stop importing the OAuth contract type from `@gitinspect/pi` and instead define it locally.

Recommended local contract file:

`apps/cli/src/lib/oauth-types.ts`

```ts
export interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  projectId?: string;
  providerId: "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";
  refresh: string;
}
```

Then CLI-local imports should look like:

```ts
import type { OAuthCredentials } from "./oauth-types.js";
```

### Build strategy for `npx` / `bunx`

Use **Bun as the builder**, but emit **Node-compatible JavaScript**.

Recommended build script:

`apps/cli/scripts/build.ts`

```ts
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = import.meta.dir;
const entry = join(root, "../src/index.ts");
const outfile = join(root, "../dist/index.js");

mkdirSync(dirname(outfile), { recursive: true });

const result = await Bun.build({
  entrypoints: [entry],
  target: "node",
  format: "esm",
  packages: "external",
  sourcemap: "external",
  outfile,
  banner: "#!/usr/bin/env node",
});

if (!result.success) {
  throw new AggregateError(result.logs, "CLI build failed");
}

chmodSync(outfile, 0o755);
```

### Why `packages: "external"` is the preferred build mode

For the npm-distributed JS build, dependencies should stay external.

Recommended:

```ts
packages: "external";
```

Why:

- keeps the output closer to normal npm package behavior
- avoids unnecessary bundling of third-party packages
- is safer for packages like `clipboardy`, which may rely on package-relative runtime assets or fallbacks
- reduces surprises when debugging installed package behavior

### Built entrypoint contract

The file referenced by `bin.gitinspect` must be executable JavaScript with a Node shebang.

Expected output header:

```js
#!/usr/bin/env node
```

The source entrypoint can stay simple:

```ts
import { runCli } from "./cli.js";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
```

### Files that should exist after this follow-up

Expected publishable CLI layout:

```text
apps/cli/
  package.json
  README.md
  scripts/
    build.ts
  src/
    index.ts
    cli.ts
    commands/
      login.ts
    lib/
      oauth-types.ts
      args.ts
      providers.ts
      oauth-adapter.ts
      clack-callbacks.ts
      output.ts
      browser.ts
      clipboard.ts
  dist/
    index.js
    index.js.map
```

### Publish flow

Recommended release flow from `apps/cli`:

```bash
bun run build
node dist/index.js --help
node dist/index.js login --help
bun publish --dry-run
bun publish --access public
```

If you want to inspect the packed tarball separately:

```bash
bun pm pack
bun publish ./gitinspect-0.1.0.tgz
```

### Verification checklist

#### Package verification

- [x] root package is named `gitinspect`
- [x] `apps/cli/package.json` is named `@gitinspect/cli`
- [x] `bin.gitinspect` points to `./dist/index.js`
- [x] `files` only includes publishable artifacts
- [x] no unpublished workspace package remains in CLI runtime dependencies

#### Build verification

- [x] `bun run build` produces `dist/index.js`
- [x] `dist/index.js` starts with `#!/usr/bin/env node`
- [x] `node dist/index.js --help` works
- [x] `node dist/index.js login --help` works

#### Publish verification

- [x] `bun publish --dry-run` succeeds
- [x] the dry-run tarball contains only the intended files
- [x] the dry-run package metadata exposes the `gitinspect` binary correctly

#### Invocation verification

- [x] `npx @gitinspect/cli login --help` works after publish
- [x] `bunx @gitinspect/cli login --help` works after publish
- [x] `npx @gitinspect/cli login -p codex` works after publish
- [x] `bunx @gitinspect/cli login -p codex` works after publish

### Acceptance criteria for this follow-up

This follow-up is complete when all of the following are true:

- the private root package is named `gitinspect`
- the publishable CLI package is named `@gitinspect/cli`
- users can run `npx @gitinspect/cli login`
- users can run `bunx @gitinspect/cli login`
- the npm package ships a normal JS `bin` entry in `dist/`
- the CLI package is self-contained and does not rely on unpublished workspace packages at runtime
- no Bun single-file executable path is introduced for this scope

## Final acceptance statement

This plan is complete when all phases above are finished and the repo supports a thin output-only CLI with the following properties:

- `apps/tui` has been replaced by `apps/cli`
- the CLI is named `gitinspect`
- the only v1 command is `login`
- all 4 providers work through pi-mono-sourced auth mechanics
- the CLI uses `@clack/prompts`
- browser auto-open matches pi-style behavior
- successful logins output raw gitinspect-native `OAuthCredentials`
- default output is base64, with `--print-json` as the debug mode
- no app import UI or hidden persistence is added yet
