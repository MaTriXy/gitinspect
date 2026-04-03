# gitinspect

Thin `gitinspect` OAuth CLI for generating raw GitInspect-compatible credentials.

## Install dependencies

```bash
bun install
```

## Run locally

```bash
bun run apps/cli/src/index.ts login
bun run apps/cli/src/index.ts login -p codex
bun run apps/cli/src/index.ts login -p anthropic --print-json
```

## Build

```bash
cd apps/cli
bun run build
node dist/index.js --help
```

## Command

```bash
gitinspect login
gitinspect login -p <provider>
gitinspect login --print-json
```

Provider aliases:

- `codex` → `openai-codex`
- `claude` → `anthropic`
- `gemini` → `google-gemini-cli`
- `copilot` → `github-copilot`

Examples:

```bash
gitinspect login -p codex
gitinspect login -p anthropic
gitinspect login -p gemini
gitinspect login -p copilot
gitinspect login -p gemini --print-json
```

## Output

Default output is a base64url-encoded raw `OAuthCredentials` JSON payload.

```bash
gitinspect login -p codex
```

The CLI copies the sign-in URL to your clipboard when auth starts, then copies the final login code to your clipboard after success. In the default mode it also tells you to paste the last line back into the GitInspect app. For callback-server providers, the manual redirect/code prompt only appears after a short wait if the browser callback does not finish automatically.

`--print-json` prints the raw `OAuthCredentials` object directly.

```bash
gitinspect login -p gemini --print-json
```

## Scope

v1 is output-only:

- no credential persistence
- no hidden writes
- no logout or providers command

GitInspect app import is supported separately by pasting the generated login code into the app.

## Packaging

The published npm package is self-contained and does not depend on unpublished workspace packages at runtime. It builds to normal Node-compatible JavaScript in `dist/` and exposes the `gitinspect` binary for `npx gitinspect ...` and `bunx gitinspect ...`.

## Implementation

The CLI is a thin wrapper over `@mariozechner/pi-ai/oauth` provider login flows.
