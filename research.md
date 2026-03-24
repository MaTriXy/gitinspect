# Toolcalling Research Report

## Scope

This report covers four areas:

1. Sitegeist tool-calling architecture and the folders/files relevant to how tools are defined, executed, rendered, and persisted.
2. The `read` and `bash` tool implementations in `docs/pi-mono/packages/coding-agent`.
3. The local `just-github` checkout at `/Users/jeremy/Developer/just-github`.
4. The installed `just-bash` package in this repo's `node_modules`.

The goal of this report is not to produce the implementation plan yet. The goal is to document the actual contracts, patterns, quirks, and constraints we should plan around.

## Files Reviewed

### Sitegeist

- `docs/sitegeist/src/tools/index.ts`
- `docs/sitegeist/src/tools/navigate.ts`
- `docs/sitegeist/src/tools/ask-user-which-element.ts`
- `docs/sitegeist/src/tools/repl/repl.ts`
- `docs/sitegeist/src/tools/repl/runtime-providers.ts`
- `docs/sitegeist/src/tools/NativeInputEventsRuntimeProvider.ts`
- `docs/sitegeist/src/tools/skill.ts`
- `docs/sitegeist/src/tools/extract-image.ts`
- `docs/sitegeist/src/tools/debugger.ts`
- `docs/sitegeist/src/messages/message-transformer.ts`
- `docs/sitegeist/src/messages/custom-messages.ts`
- `docs/sitegeist/src/sidepanel.ts`
- `docs/sitegeist/src/storage/app-storage.ts`
- `docs/sitegeist/src/storage/stores/sessions-store.ts`
- `docs/sitegeist/docs/tool-renderers.md`
- `docs/sitegeist/docs/storage.md`

### pi-mono

- `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`
- `docs/pi-mono/packages/coding-agent/src/core/tools/bash.ts`
- `docs/pi-mono/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`
- `docs/pi-mono/packages/coding-agent/src/core/tools/truncate.ts`
- `docs/pi-mono/packages/web-ui/src/tools/renderers/BashRenderer.ts`
- `docs/pi-mono/packages/agent/src/types.ts`

### just-github

- `/Users/jeremy/Developer/just-github/README.md`
- `/Users/jeremy/Developer/just-github/playground.ts`
- `/Users/jeremy/Developer/just-github/src/types.ts`
- `/Users/jeremy/Developer/just-github/src/cache.ts`
- `/Users/jeremy/Developer/just-github/src/github-client.ts`
- `/Users/jeremy/Developer/just-github/src/github-fs.ts`
- `/Users/jeremy/Developer/just-github/tests/cache.test.ts`
- `/Users/jeremy/Developer/just-github/tests/github-fs.test.ts`

### just-bash

- `node_modules/just-bash/README.md`
- `node_modules/just-bash/package.json`
- `node_modules/just-bash/dist/browser.d.ts`
- `node_modules/just-bash/dist/index.d.ts`
- `node_modules/just-bash/dist/Bash.d.ts`
- `node_modules/just-bash/dist/types.d.ts`
- `node_modules/just-bash/dist/fs/interface.d.ts`
- `node_modules/just-bash/dist/fs/in-memory-fs/in-memory-fs.d.ts`

## Executive Summary

The strongest pattern across Sitegeist and `pi-mono` is this:

- tool definitions are schema-first
- execution is strongly separated from rendering
- tool output is split into model-facing `content` and UI-facing `details`
- tool results are first-class chat messages and are persisted as such
- the model-facing message transformer is tool-aware, not text-only
- `read` and `bash` are optimized for agent workflows, not human shell fidelity

For GitOverflow specifically:

- Sitegeist's extension-specific tools are not directly reusable, but its tool architecture is.
- `pi-mono`'s `read` and `bash` implementations are directly useful as design references.
- `just-github` is a good substrate for a read-only repo filesystem, but it has important limitations that matter before we put it behind a tool.
- `just-bash/browser` is compatible with a browser-only product and already exposes the exact filesystem abstraction `just-github` implements.

The main architectural implication is that we should not bolt "tool support" onto the current runtime as a stringly typed add-on. We should move to a real executable tool registry with schemas, executors, and explicit rendering/persistence behavior.

## 1. Sitegeist Toolcalling Architecture

### 1.1. Tool definitions are runtime objects, not just metadata

Sitegeist uses `AgentTool` instances from `@mariozechner/pi-agent-core`, not just tool name strings.

Each tool has:

- `name`
- `label`
- `description`
- `parameters` as a TypeBox schema
- `execute(toolCallId, args, signal, onUpdate?)`

This is visible in:

- `docs/sitegeist/src/tools/navigate.ts`
- `docs/sitegeist/src/tools/ask-user-which-element.ts`
- `docs/sitegeist/src/tools/repl/repl.ts`
- `docs/sitegeist/src/tools/skill.ts`
- `docs/sitegeist/src/tools/extract-image.ts`
- `docs/sitegeist/src/tools/debugger.ts`

The tool object is the source of truth. The UI renderer is registered separately.

### 1.2. Sitegeist creates tools from a factory at app runtime

The tool list is not hardcoded at module init time. In `docs/sitegeist/src/sidepanel.ts`, the chat panel receives a `toolsFactory(...)` callback that builds tools using live runtime dependencies:

- active window ID
- proxy settings
- runtime providers from the chat panel
- debug mode flags

This is a strong pattern for us. The tool layer depends on session/runtime context, so it should be created from the active repo/session state, not globally.

### 1.3. Sitegeist cleanly separates model output from UI output

The key execution contract is:

- `content`: concise output for the model
- `details`: richer structured output for the UI

Examples:

- `navigate` returns text plus structured `finalUrl`, `title`, `favicon`, `skills`, and `tabId`.
- `ask_user_which_element` returns text plus detailed element metadata including selector, xpath, bounding box, and computed styles.
- `repl` returns text plus base64-encoded file attachments in `details`.
- `extract_image` returns image/text content plus lightweight details like mode and selector.

This split is the most important Sitegeist pattern to copy.

The model gets only what it needs to continue reasoning.
The UI gets everything needed to render something nice.

### 1.4. Tool renderers are separate from tool executors

Sitegeist registers renderers independently via `registerToolRenderer(...)`.

Relevant files:

- `docs/sitegeist/src/tools/index.ts`
- `docs/sitegeist/docs/tool-renderers.md`

Renderer behavior:

- renderers must support partial parameter streaming, pending execution, success, and error states
- renderers can choose `isCustom: true` or `isCustom: false`
- renderers consume `params`, `result`, and `isStreaming`

This is a clean separation:

- execution concerns stay in the tool
- presentation concerns stay in the renderer

For our app, we do not need Sitegeist's full renderer registry on day one, but we should preserve the conceptual split.

### 1.5. Sitegeist's message transformer is explicitly tool-aware

`docs/sitegeist/src/messages/message-transformer.ts` does two important things:

1. It preserves `toolResult` messages.
2. It reorders messages so an assistant message with tool calls is immediately followed by its matching tool results before unrelated messages like navigation context.

This is not optional polish. It is part of correct tool use.

If the transformer drops `toolResult`, the model cannot continue after a tool call.
If the transformer keeps unrelated messages between a tool call and its result, the next LLM turn gets worse context.

This is directly relevant to GitOverflow because the current app transformer is still text-chat-oriented.

### 1.6. Sitegeist extends the agent message model with custom message types

`docs/sitegeist/src/messages/custom-messages.ts` uses declaration merging to extend `CustomAgentMessages`.

Sitegeist adds non-LLM message types like:

- `navigation`
- `continue`

The implication is that the agent state can contain more than standard LLM messages, and the transformer decides what actually reaches the model.

This is useful for us conceptually. If we later want repo context or repo-switch events to exist in the chat timeline without always being model-visible, this is the pattern.

### 1.7. Tool results are persisted as part of sessions

The Sitegeist session store migration in `docs/sitegeist/src/storage/stores/sessions-store.ts` exists specifically because tool result message shape evolved over time.

That tells us two things:

1. Tool results are stored durably in sessions.
2. Message schema changes will eventually require migrations.

We should plan tool messages as first-class persisted session data, not temporary UI state.

## 2. Concrete Sitegeist Tool Patterns

### 2.1. `navigate`

`docs/sitegeist/src/tools/navigate.ts`

Key characteristics:

- multi-action tool through optional fields in one schema:
  - `url`
  - `newTab`
  - `listTabs`
  - `switchToTab`
- abort-aware
- wraps browser APIs directly
- returns both concise text and structured navigation metadata
- augments its result with matching skills for the destination URL

Notable pattern:

- tools can compose product-specific context enrichment before returning
- the text output is short and model-friendly
- the UI renderer uses `details` to render pills/buttons rather than parsing text

### 2.2. `ask_user_which_element`

`docs/sitegeist/src/tools/ask-user-which-element.ts`

Key characteristics:

- user-interactive tool
- uses `chrome.userScripts.execute` to inject an overlay into the active page
- races execution against an abort signal
- attempts cleanup when aborted
- returns rich structured DOM metadata

Important implementation details:

- it validates protected URLs and refuses execution on internal browser pages
- it is effectively a long-running tool that waits for a user action
- the renderer distinguishes preparation, waiting, success, and error states

This is a useful pattern if we ever want a human-in-the-loop repo picker or branch selector tool, but not immediately relevant for GitOverflow v1.

### 2.3. `repl`

`docs/sitegeist/src/tools/repl/repl.ts`
`docs/sitegeist/src/tools/repl/runtime-providers.ts`

This is the most sophisticated tool in Sitegeist.

Important patterns:

- the tool is created from a factory so it can receive live runtime providers
- the tool description is dynamic and includes provider capabilities
- execution is sandboxed through `SandboxIframe`
- browser-specific helpers like `browserjs()` and `navigate()` are injected through runtime providers
- direct `window.location` navigation is blocked by string pattern checks
- returned files are converted to base64 so they can be serialized into chat state

The big lesson is not "copy the REPL." It is:

- tools can be thin wrappers over a lower-level execution substrate
- that substrate can inject helper capabilities through pluggable providers
- the tool remains stable while providers vary by runtime

For GitOverflow, the analog would be:

- stable `bash` tool
- lower-level execution substrate is `just-bash/browser`
- the active repo filesystem is injected into that substrate

### 2.4. `skill`

`docs/sitegeist/src/tools/skill.ts`

This is a management tool, but it demonstrates several useful patterns:

- one tool can support multiple actions with a single schema
- outputs are deliberately token-efficient for the model
- library code is validated before persistence
- tool execution can mutate local durable state

Most relevant lesson:

- returning the full underlying object in `details` while keeping `content` short is a very effective pattern

### 2.5. `extract_image`

`docs/sitegeist/src/tools/extract-image.ts`

Useful patterns:

- mixed multimodal content output
- text plus image blocks in the same tool result
- details remain small even when content is large

This matters because `pi-mono` `read` uses the same philosophy for image files.

### 2.6. `debugger`

`docs/sitegeist/src/tools/debugger.ts`

Useful pattern:

- tool descriptions are very explicit about when not to use the tool
- it treats the tool as a capability with a narrow trust boundary

This is relevant for our future `bash` description. We should be explicit that it is a virtual read-only repo shell, not real OS bash.

## 3. What Sitegeist Suggests We Should Copy

We should copy these patterns almost exactly:

- tool registry made of executable tool objects, not only tool metadata
- TypeBox parameter schemas
- `content` versus `details`
- separate renderer layer
- tool-aware message transformation
- tool results persisted in session history
- runtime tool factory fed by session-specific context

We should not copy these directly:

- extension APIs
- browser navigation model
- userScripts overlay execution
- debugger/CDP integration
- skills system
- page-world runtime providers

## 4. `pi-mono` `read` Tool Deep Dive

File:

- `docs/pi-mono/packages/coding-agent/src/core/tools/read.ts`

### 4.1. Shape of the tool

Schema:

- `path: string`
- `offset?: number`
- `limit?: number`

The important point is that `read` is intentionally line-oriented, not byte-oriented.
That is the right abstraction for LLMs.

### 4.2. Execution is abstraction-friendly

The `read` tool does not depend directly on local disk APIs. It defines `ReadOperations`:

- `readFile`
- `access`
- optional `detectImageMimeType`

That means the core algorithm is portable.
This is exactly the hook we need for plugging `GitHubFs` in later.

### 4.3. `read` is optimized for model continuation, not raw fidelity

The tool is designed around agent workflows:

- beginning-of-file truncation, not arbitrary raw bytes
- explicit continuation instructions
- `offset` and `limit` are 1-indexed/line-oriented
- when truncated, it tells the model exactly which `offset` to use next

That is much better than dumping text and hoping the model guesses the continuation strategy.

### 4.4. Truncation semantics

Shared truncation utilities live in:

- `docs/pi-mono/packages/coding-agent/src/core/tools/truncate.ts`

Defaults:

- `DEFAULT_MAX_LINES = 2000`
- `DEFAULT_MAX_BYTES = 50 * 1024`

`truncateHead(...)` behavior:

- keeps the earliest lines
- never returns partial lines
- if the first line alone exceeds the byte limit, it returns empty content and flags `firstLineExceedsLimit`

This leads to a subtle but valuable behavior in `read`:

- if a single very long line exceeds the byte limit, the tool does not try to return broken data
- instead it tells the model to use a bash fallback like:
  - `sed -n 'Np' file | head -c ...`

That is a strong agent-oriented design choice.

### 4.5. Image handling

The `read` tool supports image files.

Flow:

- detect image MIME
- read as binary
- base64 encode
- optionally resize before returning

If resize fails, it degrades to text-only output noting the omission.

This is not relevant for GitHub repo Q&A as a day-one requirement, but the pattern is useful if we later want `read` to support repository images like diagrams or screenshots.

### 4.6. Abort behavior

The tool is abort-aware:

- checks `signal.aborted` before starting
- registers an abort listener
- rejects with `Operation aborted`

This is worth preserving in our implementation because tool calls can outlive user patience.

### 4.7. Prompt guidance is embedded in the tool definition

`read` includes both:

- `description`
- `promptSnippet`
- `promptGuidelines`

Important guidance:

- use `read` instead of `cat` or `sed`
- use offset/limit for large files

This embedded guidance is important because it teaches the model tool-specific best practices without relying entirely on the system prompt.

### 4.8. Renderer behavior

The `read` tool also knows how to render itself in the `pi` TUI:

- call formatting includes path and optional line range
- result formatting shows syntax-highlighted snippets
- truncation is surfaced clearly to the user

We do not need to port this renderer logic directly, but the structure is informative: the tool's UI should make pagination and truncation obvious.

### 4.9. Most important `read` takeaways

- portable execution interface
- line-oriented paging
- strict truncation rules
- explicit continuation hints
- optional multimodal image support
- prompt guidance lives with the tool

This is a very strong base design for a repo-reading tool.

## 5. `pi-mono` `bash` Tool Deep Dive

File:

- `docs/pi-mono/packages/coding-agent/src/core/tools/bash.ts`

### 5.1. Shape of the tool

Schema:

- `command: string`
- `timeout?: number`

This is intentionally minimal.

### 5.2. Execution backend is abstracted

Like `read`, `bash` defines an operations interface:

- `exec(command, cwd, { onData, signal, timeout, env })`

The default implementation uses local child processes, but the contract is generic.

This is exactly why the tool is a good design reference for us.
We can preserve the top-level tool contract while swapping the execution substrate to `just-bash/browser`.

### 5.3. Streaming is a first-class part of the tool

The tool supports `onUpdate(...)`.

As output arrives:

- it accumulates output chunks
- it streams partial tail-truncated text
- it emits partial `details`

This is important because Sitegeist's tool-calling UI assumes tools can progress while running.

For GitOverflow, this is optional for day one, but it is a good target because `just-bash` command execution can still produce incremental output.

### 5.4. Tail truncation rather than head truncation

`bash` uses `truncateTail(...)`, not `truncateHead(...)`.

That is correct for command output because:

- errors and conclusions tend to be at the end
- the final lines are usually more relevant than the first lines

This difference between `read` and `bash` is deliberate and should be preserved.

### 5.5. Spill-to-disk strategy for large output

When output exceeds the in-memory threshold:

- the tool creates a temp log file
- streams all buffered data into that file
- keeps only a rolling in-memory tail for display
- returns a `fullOutputPath` in details

This is a strong local-shell design, but it does not translate directly to a browser-only app.

For GitOverflow, we will need a browser-compatible substitute:

- either keep only the rolling tail and drop the rest
- or persist the full output in IndexedDB/session state instead of a temp path

The important pattern is the dual strategy:

- cheap preview for the model/UI
- fuller artifact elsewhere if needed

### 5.6. Exit code and error contract

Behavior:

- exit code `0`: resolve success
- non-zero exit code: reject with buffered output plus exit code note
- timeout: reject with output plus timeout message
- abort: reject with output plus aborted message

This matters because the error channel still contains useful command output.
It does not discard what the process produced before failing.

We should preserve that behavior.

### 5.7. Render behavior

The TUI renderer tracks:

- started time
- ended time
- elapsed time during streaming
- preview collapsing
- truncation/full-output notices

Again, not something we need to port literally, but the design principle is strong:

- long-running shell tools should expose progress and duration

### 5.8. Most important `bash` takeaways

- execution substrate is abstract
- command schema is intentionally tiny
- output is tail-truncated
- incremental updates matter
- failures still return useful text context
- large output requires a second storage strategy

## 6. `tool-definition-wrapper` and Why It Matters

File:

- `docs/pi-mono/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`

This adapter shows an important layering choice in `pi-mono`:

- internal registry is definition-first
- runtime consumes `AgentTool`
- wrapper converts between them

That is useful for us because it suggests a clean internal model:

- richer app-side tool definition
- thin adapter to the agent runtime

This is better than letting the raw agent tool shape leak everywhere in the app.

## 7. `just-github` Deep Dive

Files:

- `/Users/jeremy/Developer/just-github/src/github-client.ts`
- `/Users/jeremy/Developer/just-github/src/github-fs.ts`
- `/Users/jeremy/Developer/just-github/src/cache.ts`
- `/Users/jeremy/Developer/just-github/src/types.ts`

### 7.1. Core idea

`GitHubFs` implements `just-bash`'s `IFileSystem` interface and exposes a repo as a read-only virtual filesystem without cloning.

It is designed to behave enough like a filesystem that `just-bash` can run against it.

### 7.2. Read path and API choices

`GitHubClient` uses:

- GitHub Contents API for file/directory metadata and small-file inline contents
- `raw.githubusercontent.com` for raw text/binary fetches
- Git refs API plus commits API plus trees API for the full repo tree

The advertised "smart API selection" is only partially true in code:

- `readFile` first tries the Contents API
- if `response.content` is present and base64-encoded, it decodes it
- otherwise it falls back to the raw endpoint

That means the practical strategy is:

- Contents API first
- raw endpoint fallback

There is no explicit size threshold check in the implementation itself.

### 7.3. Ref resolution logic

`fetchTree()` resolves `ref` in this order:

1. `git/ref/heads/<ref>`
2. `git/ref/tags/<ref>`
3. `git/commits/<ref>` assuming `ref` is a direct commit SHA

Then:

- if the ref points directly to a commit, fetch commit, then tree
- if the ref points to a tag object, fetch the tag, then fetch the pointed-to commit, then tree

This is more complete than a simple branch-only implementation.

### 7.4. Tree cache behavior

`TreeCache`:

- caches the full tree keyed by path
- stores the tree SHA and load time
- expires by TTL
- supports `get(path)`, `listDir(dirPath)`, and `allPaths()`

Important behavior:

- if the tree is expired, `loaded` becomes false
- directory listing from cache only works for direct children
- root directory listing is synthesized from tree paths without slashes

### 7.5. Content cache behavior

`ContentCache`:

- is keyed by blob SHA
- stores `string | Uint8Array`
- is LRU-ish by using a `Map` and moving entries to the end on access
- limits both bytes and entry count

Important nuance:

- string size is estimated as `length * 2`, which is approximate but reasonable enough for a JS heap cache

### 7.6. Filesystem semantics

`GitHubFs` implements:

- `readFile`
- `readFileBuffer`
- `readdir`
- `readdirWithFileTypes`
- `stat`
- `lstat`
- `exists`
- `realpath`
- `readlink`
- `tree`
- `getAllPaths`
- `resolvePath`

and all write operations throw `EROFS`.

This is the correct overall stance for our use case.

### 7.7. Important implementation details

#### 7.7.1. `stat()` intentionally loads the full tree early

`statInternal()` always calls `loadTree()` for non-root paths before falling back.

The comment explains why:

- `just-bash` stats PATH entries for every command
- loading the full tree once avoids burning API calls on repeated `stat`s

This is a very important design detail. It is the main reason `just-github` is viable behind `just-bash`.

#### 7.7.2. `readFile()` only uses the content cache if the tree is already loaded

That means:

- first file reads still hit the network unless the tree has already been loaded
- once the tree is loaded, repeated reads can use blob-SHA cache hits

This is sensible but means cold reads are still relatively expensive.

#### 7.7.3. `readFileBuffer()` does not use Contents API metadata first

It goes straight to the raw endpoint and only caches by SHA if the tree is already loaded.

That means binary reads depend more heavily on prior tree loading than text reads do.

#### 7.7.4. `readdir()` has a cache fast path only if the path is known as a tree

If tree cache is loaded:

- root is synthesized from cached paths
- subdir listing only uses cache if the requested path exists in the tree as a `tree`

Otherwise it falls back to the Contents API.

#### 7.7.5. submodules are treated as directories in stat/rendering logic

`treeEntryType()` maps:

- tree -> dir
- commit -> submodule
- mode `120000` -> symlink

and `toFsStat()` treats submodules as directories.

This is a reasonable approximation for a browsing shell, but it is not a true submodule implementation.

### 7.8. Read-only behavior

Every mutating operation throws `GitHubFsError("EROFS", "Read-only filesystem")`.

That includes:

- `writeFile`
- `appendFile`
- `mkdir`
- `rm`
- `cp`
- `mv`
- `chmod`
- `symlink`
- `link`

`utimes()` is a no-op.

This is exactly what we want for a first pass.

### 7.9. Error mapping

`GitHubClient` maps HTTP errors to filesystem-style errors:

- `404` -> `ENOENT`
- `401` / `403` -> `EACCES`
- other failures -> `EIO`

Special case:

- if rate limit headers indicate exhaustion, a `403` becomes a rate-limit-specific `EACCES` message

This is good because it gives tool callers shell-like failure semantics.

### 7.10. Specific limitations and quirks

These matter for planning:

#### 7.10.1. `GitHubTreeResponse.truncated` is ignored

The trees API can return a truncated tree for very large repos.
The implementation stores the tree regardless and does not detect or recover from truncation.

Impact:

- `stat`
- `exists`
- `readdir`
- `getAllPaths`
- `tree`

can become silently incomplete on very large repos.

This is a major caveat if GitOverflow is supposed to answer questions about large repositories.

#### 7.10.2. branch/tag refs with slashes may break tree resolution

`fetchTree()` constructs paths like:

- `/git/ref/heads/${this.ref}`
- `/git/ref/tags/${this.ref}`

without URL encoding.

Refs like `feature/foo` are likely problematic against that endpoint path.

#### 7.10.3. raw endpoint is hard-coded

`baseUrl` is configurable for API requests, but raw content always uses:

- `https://raw.githubusercontent.com/...`

Implications:

- GitHub Enterprise support is incomplete
- alternate raw hosts are not supported

#### 7.10.4. `realpath()` is not a true canonicalizer

It just normalizes and prepends `/`.
It does not resolve symlinks.

This is acceptable for a read-only repo browser, but it is not a full POSIX `realpath`.

#### 7.10.5. `lstat()` is identical to `stat()`

The implementation explicitly says GitHub does not distinguish them in this abstraction.
That means symlink behavior is approximate.

#### 7.10.6. `readlink()` is approximate

It implements `readlink(path)` as:

- `await readFile(path)`
- `trim()`

This assumes the file content of the symlink path corresponds to the link target in a useful way.
That is not a robust general symlink model.

#### 7.10.7. tree cache expiry can produce state changes mid-session

After TTL expiry:

- cached tree calls start missing
- future calls refetch

This is correct but means command behavior could change across a long-running session if the repo changes upstream or the tree refetch behaves differently.

### 7.11. Browser suitability

The library is structurally browser-friendly:

- uses `fetch`
- returns `Uint8Array` and strings
- implements `IFileSystem`

Potential caveats:

- large API usage can hit GitHub rate limits quickly without a token
- repo browsing across many files will be bottlenecked by Contents API and Trees API limits
- large repos may expose the tree truncation issue above

### 7.12. Playground behavior

The playground stores current working directory outside `just-bash` itself and prepends:

- `cd <cwd> && ...`

to each interactive command.

That reflects an important `just-bash` behavior:

- each `exec()` call resets env/cwd state
- filesystem is shared

The playground uses `result.env.PWD` to carry cwd across calls manually.

This is directly relevant for our `bash` tool planning.

## 8. `just-bash` Deep Dive

### 8.1. High-level model

`just-bash` is a virtual bash environment with:

- AST-based parsing and interpretation
- shared virtual filesystem
- per-`exec()` isolated shell state

The README is explicit:

- environment variables, functions, and working directory reset between calls
- filesystem is shared across calls

This is one of the most important constraints for our design.

If we want shell `cwd` continuity across tool invocations, we must manage it at the app/tool layer.

### 8.2. Browser entry point

`node_modules/just-bash/dist/browser.d.ts`

The browser build exports:

- `Bash`
- `InMemoryFs`
- type definitions

and excludes Node-only filesystems such as:

- `OverlayFs`
- `ReadWriteFs`
- `Sandbox`

The README also notes:

- gzip-related commands fail in browsers because of `node:zlib`

This is important:

- `just-bash/browser` is viable in our app
- but not every command behaves equally in browser mode

### 8.3. `IFileSystem` contract

`node_modules/just-bash/dist/fs/interface.d.ts`

This is the core integration point.

Required methods include:

- `readFile`
- `readFileBuffer`
- `writeFile`
- `appendFile`
- `exists`
- `stat`
- `mkdir`
- `readdir`
- `rm`
- `cp`
- `mv`
- `resolvePath`
- `getAllPaths`
- `chmod`
- `symlink`
- `link`
- `readlink`
- `lstat`
- `realpath`
- `utimes`

Optional:

- `readdirWithFileTypes`

This explains why `just-github` implements so many write methods even though it is read-only: `just-bash` expects a filesystem, not a read-only reader.

### 8.4. `Bash` API surface

From `node_modules/just-bash/dist/Bash.d.ts`:

- constructor accepts `fs`, `cwd`, `env`, command restrictions, optional network config, Python/JS runtime flags, custom commands, and more
- `exec(commandLine, options?)`
- `readFile(path)`
- `writeFile(path, content)`
- `getCwd()`
- `getEnv()`

`exec()` supports:

- `env`
- `replaceEnv`
- `cwd`
- `stdin`
- `signal`
- `args`
- `rawScript`

This is enough for our virtual repo shell.

### 8.5. Command execution model

Command context includes:

- `fs`
- `cwd`
- `env`
- `stdin`
- optional `exec` for subcommands
- optional `fetch`
- optional `signal`

This is important because built-in commands ultimately operate against the injected `IFileSystem`.

That means if `GitHubFs` implements the contract well enough, commands like:

- `ls`
- `cat`
- `head`
- `tail`
- `grep`
- `sed`
- `find`
- `tree`

can work without us reimplementing them.

### 8.6. Command availability

The installed package supports a wide range of commands, including:

- file operations
- text processing
- shell utilities
- network commands

For our repo shell use case, that is both powerful and risky.

Powerful because:

- we get a rich analysis shell cheaply

Risky because:

- many commands imply write semantics or runtime features we may not want the model to assume are available

Even with a read-only filesystem, commands like `mkdir` or `touch` will exist and fail at runtime.

This suggests we may eventually want to restrict the command set or system-prompt the tool very clearly.

### 8.7. Shared filesystem, reset shell state

This is worth restating because it has planning consequences.

`just-bash` behavior:

- filesystem persists
- shell state does not

Implication:

- if we instantiate one `Bash` per session, the repo filesystem cache and any writes to an overlay/in-memory mount would persist
- but `cd foo` in one tool call would not carry to the next unless we explicitly track `PWD` ourselves

This matches the `just-github` playground behavior.

## 9. Synthesis for GitOverflow

### 9.1. Best architectural patterns to adopt

We should adopt these directly:

- a real executable tool registry
- TypeBox schemas
- a `content` versus `details` result contract
- session-persisted tool results
- tool-aware message transformation
- runtime creation of tools from active session/repo context

### 9.2. Best substrate choices

The most promising stack is:

- repo access: `GitHubFs`
- shell execution: `just-bash/browser`
- tool contract: modeled after `pi-mono` / Sitegeist

This is a coherent stack because:

- `GitHubFs` already implements `IFileSystem`
- `just-bash/browser` already consumes `IFileSystem`
- Sitegeist already demonstrates how tool execution and rendering should be separated

### 9.3. Biggest technical caveats discovered

1. `just-github` ignores truncated Git trees, which can silently break large-repo exploration.
2. `just-github` branch/tag ref resolution likely mishandles refs with slashes.
3. `just-bash` resets cwd/env per `exec()`, so cwd continuity must be managed explicitly.
4. `just-github` is fully read-only, so many shell commands will exist but fail on writes.
5. Our current app runtime is not yet tool-aware end to end, especially in the message transform and stream parsing layers.

### 9.4. Design implications before planning

Based on this research, the implementation plan should explicitly decide:

- whether `bash` should be full `just-bash` or a restricted command subset
- how cwd continuity should work across tool invocations
- whether repo source is session-scoped or global
- how to handle large repos where the Git trees API is truncated
- whether the first version targets one provider first for tool-calling
- how to render tool calls/results in the React UI without overbuilding a full renderer registry

## Bottom Line

The research supports the core idea.

The right pattern is:

- use Sitegeist's tool architecture
- use `pi-mono`'s `read` and `bash` behavior as the behavioral reference
- use `just-github` as the repo filesystem substrate
- use `just-bash/browser` as the virtual repo shell substrate

But we should go into planning with three facts in mind:

- `just-github` is good, not perfect
- `just-bash` gives us command execution, not shell-session persistence
- our current app runtime needs a real tool pipeline, not just tool names in provider payloads
