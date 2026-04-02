# Refactor Plan

Status: completed
Owner: Jeremy + agent
Goal: execute a pure architectural refactor with zero product regression.

## General guidelines

- End result must be **exactly the same** as the old `~/Developer/gitinspect` app in UI, UX, theme, routes, behavior, persistence, and proxy/runtime behavior.
- This is a **reorganization**, not a redesign.
- `packages/ui` owns reusable visual UI.
- `packages/pi` owns Pi/runtime domain logic.
- `packages/db` owns Dexie persistence.
- `packages/auth` stays and owns **product auth**.
- `packages/pi/src/auth` owns **provider/runtime auth**.
- `apps/web` owns routing, entry wiring, Nitro config, server routes, and web-only bootstrap glue.
- Route-level screens stay in `apps/web`; reusable visual components move to `packages/ui`.
- Preserve old gitinspect route URLs exactly.
- Remove current starter frontend routes/components; keep only the auth API route support that is actually needed.
- Keep Nitro in scope under `apps/web/` so proxy behavior continues to work.
- Keep `streamdown/styles.css` in shared UI globals for now.
- Use **Phosphor** icons; do not normalize to Lucide.
- `packages/ui/src/components/*` stays flat for primitives; grouped families like `ai-elements` stay in subdirectories.
- `navigation/search-state.ts` stays in `apps/web` because URL/search state is routing state.
- `root-guard.tsx` stays in `apps/web`.
- `chat-suggestions.ts` belongs in `packages/ui`.
- `packages/ui/hooks/` is allowed, including Dexie-backed hooks if needed for parity/migration.
- `just-github` remains the canonical GitHub implementation for now.
- Temporary carryover from old `src/lib/github/*` is allowed freely during migration if needed.
- No product-auth screens are part of this refactor.
- Keep `auth-callback-page.tsx` in `apps/web` as dormant web-only code if copied; do not treat it as a required product surface.
- Shared test helpers should live in a top-level shared test utility area.
- Do not blindly copy old Prettier/ESLint config; convert intent to the current Oxlint/Oxfmt setup.
- Do not blindly copy generated files/folders, local env files, or docs/plans as runtime migration steps.
- Use Bun for package/dependency work.
- Another agent should be able to execute from the checklist below without guessing architecture.

## Concrete migration implementation plan

This section is the execution checklist another agent should be able to follow.

Rules for this section:

- commands are the intended copy/move commands to execute during implementation
- directory batches are used when files can move together unchanged
- file-by-file items are used when code must be split or otherwise changed
- do **not** treat these commands as already approved execution; they are the plan only
- if new uncertainty appears during execution, document it explicitly instead of guessing

## Migration order

The order below is intentional:

1. create package scaffolding first
2. lock exact theme/UI foundation next
3. move Dexie into `packages/db`
4. move runtime/domain into `packages/pi`
5. move reusable visual components into `packages/ui`
6. thin `apps/web` last, once package exports exist

Reasoning:

- UI extraction depends on theme and package structure
- Pi runtime depends on storage boundaries
- web should be simplified only after the shared packages can replace it cleanly

## Phase 1 — Package scaffolding and exact visual foundation

### 1.1 Create `packages/pi`

- [x] Create `packages/pi` package skeleton

  ```bash
  mkdir -p packages/pi/src/{agent,auth,hooks,lib,models,navigation,proxy,repo,sessions,tools,types}
  ```

  Notes:
  - use minimal package scripts only
  - keep exports migration-friendly and broad at first

- [x] Create `packages/db` package skeleton

  ```bash
  mkdir -p packages/db/src
  ```

  Notes:
  - use minimal package scripts only
  - keep exports migration-friendly and broad at first

- [x] Keep navigation URL/search-param state in `apps/web`
      Notes:
  - `packages/pi` should not own route URL shape
  - only extract tiny generic helpers later if clearly useful

### 1.2 Copy the exact old theme foundation into `packages/ui`

These files define the exact old visual baseline and should move before feature UI.

- [x] Replace shared globals with the old app visual foundation as the baseline

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/styles.css packages/ui/src/styles/globals.css
  ```

  Notes:
  - this is the fastest way to lock exact visual parity first
  - keep `streamdown/styles.css` in shared UI globals for now
  - later cleanup can revisit extraction only after parity is achieved

- [x] Copy theme provider into shared UI

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/theme-provider.tsx packages/ui/src/components/theme-provider.tsx
  ```

- [x] Copy exact toast implementation into shared UI

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/ui/sonner.tsx packages/ui/src/components/sonner.tsx
  ```

  Notes:
  - keep exact old behavior first
  - standardize on Phosphor for parity
  - do not use Lucide in the target shared UI/runtime stack

- [x] Copy theme toggle into shared UI

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/theme-toggle.tsx packages/ui/src/components/theme-toggle.tsx
  ```

- [x] Copy shared visual identity components into shared UI
  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/icons.tsx packages/ui/src/components/icons.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-logo.tsx packages/ui/src/components/chat-logo.tsx
  ```

## Phase 2 — Move Dexie persistence into `packages/db`

These files should move early and mostly together because they define the storage layer.

- [x] Copy Dexie storage files into `packages/db`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/db/schema.ts packages/db/src/schema.ts
  cp /Users/jeremy/Developer/gitinspect/src/db/session-leases.ts packages/db/src/session-leases.ts
  cp /Users/jeremy/Developer/gitinspect/src/db/session-runtime.ts packages/db/src/session-runtime.ts
  ```

- [x] Copy persistence-owned storage types into `packages/db`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/types/storage.ts packages/db/src/storage-types.ts
  ```

  Notes:
  - this file will likely need splitting into `packages/db` storage types vs `packages/pi` domain types
  - keep the initial copy in `packages/db` because Dexie is the source of truth

- [x] File-by-file split: identify files outside `src/db/*` that currently perform direct Dexie reads/writes and convert them to consume `packages/db`
  - [x] `src/components/app-sidebar.tsx` → replace inline Dexie calls with db-facing selectors/hooks
  - [x] `src/components/chat-model-selector.tsx` → replace inline Dexie calls with db-facing selectors/hooks
  - [x] `src/components/costs-panel.tsx` → replace inline Dexie calls with db-facing selectors/hooks
  - [x] `src/components/data-settings.tsx` → replace inline Dexie mutation logic with db-facing service calls
  - [x] `src/components/provider-settings.tsx` → replace inline Dexie reads/writes with db-facing service calls
  - [x] `src/components/repo-combobox.tsx` → replace inline Dexie reads with db-facing selectors/hooks
  - [x] `src/components/chat.tsx` → replace inline Dexie/runtime persistence access with `packages/db` + `packages/pi`
  - [x] `src/hooks/use-selected-session-summary.ts` → move to `packages/pi` only after storage access goes through `packages/db`
  - [x] `src/hooks/use-session-ownership.ts` → move to `packages/pi` only after storage access goes through `packages/db`

- [x] Allow `packages/ui/hooks/` to contain UI-facing hooks, including Dexie-backed hooks if needed for parity/migration
      Notes:
  - this is an explicit exception to keep the migration practical
  - do not let this turn into a dumping ground for unrelated domain logic

## Phase 3 — Move Pi runtime/domain into `packages/pi`

### 3.1 Batch copy runtime/domain directories that map cleanly

- [x] Copy agent runtime domain into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/agent/*.ts packages/pi/src/agent/
  ```

- [x] Copy provider/runtime auth into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/auth/*.ts packages/pi/src/auth/
  ```

  Notes:
  - this is the provider auth domain, not `packages/auth`

- [x] Copy model domain into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/models/*.ts packages/pi/src/models/
  ```

- [x] Copy proxy domain into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/proxy/*.ts packages/pi/src/proxy/
  ```

- [x] Copy repo domain into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/repo/*.ts packages/pi/src/repo/
  ```

- [x] Copy sessions domain into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/sessions/*.ts packages/pi/src/sessions/
  ```

- [x] Copy tools domain into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/tools/*.ts packages/pi/src/tools/
  ```

- [x] Copy generic runtime/domain types into `packages/pi`
  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/types/auth.ts packages/pi/src/types/auth.ts
  cp /Users/jeremy/Developer/gitinspect/src/types/chat.ts packages/pi/src/types/chat.ts
  cp /Users/jeremy/Developer/gitinspect/src/types/common.ts packages/pi/src/types/common.ts
  cp /Users/jeremy/Developer/gitinspect/src/types/models.ts packages/pi/src/types/models.ts
  ```

### 3.2 File-by-file runtime/domain files that need a judgment call

- [x] Keep `src/navigation/search-state.ts` in the web app

  ```bash
  mkdir -p apps/web/src/navigation
  cp /Users/jeremy/Developer/gitinspect/src/navigation/search-state.ts apps/web/src/navigation/search-state.ts
  ```

  Notes:
  - URL/search-param shape is web-owned routing state

- [x] `src/hooks/use-runtime-session.ts`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/hooks/use-runtime-session.ts packages/pi/src/hooks/use-runtime-session.ts
  ```

  Needs change:
  - may still depend on web-only runtime wiring
  - confirm no route-only assumptions remain

- [x] `src/hooks/use-selected-session-summary.ts`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/hooks/use-selected-session-summary.ts packages/pi/src/hooks/use-selected-session-summary.ts
  ```

  Needs change:
  - should read via `packages/db`, not app-local Dexie imports

- [x] `src/hooks/use-session-ownership.ts`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/hooks/use-session-ownership.ts packages/pi/src/hooks/use-session-ownership.ts
  ```

  Needs change:
  - should read via `packages/db`, not app-local Dexie imports

- [x] `src/hooks/use-github-repo-stargazers.ts`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/hooks/use-github-repo-stargazers.ts packages/pi/src/hooks/use-github-repo-stargazers.ts
  ```

  Notes:
  - keep this in `packages/pi`
  - it is data/domain fetching, not pure UI

- [x] `src/hooks/use-mobile.ts`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/hooks/use-mobile.ts packages/ui/src/hooks/use-mobile.ts
  ```

  Notes:
  - this is UI-only and belongs in `packages/ui`

- [x] Batch copy generic non-product-specific utilities into `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/lib/auth.ts packages/pi/src/lib/auth.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/copy-session-markdown.ts packages/pi/src/lib/copy-session-markdown.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/dates.ts packages/pi/src/lib/dates.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/export-markdown.ts packages/pi/src/lib/export-markdown.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/format-github-stars.ts packages/pi/src/lib/format-github-stars.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/ids.ts packages/pi/src/lib/ids.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/preview.ts packages/pi/src/lib/preview.ts
  cp /Users/jeremy/Developer/gitinspect/src/lib/title.ts packages/pi/src/lib/title.ts
  ```

- [x] Keep `src/lib/utils.ts` in `packages/ui` as the className helper source of truth
  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/lib/utils.ts packages/ui/src/lib/utils.ts
  ```

## Phase 4 — Move reusable visual components into `packages/ui`

### 4.1 Batch copy the primitive UI directory

These are the most straightforward shared files and should overwrite the current smaller set.

- [x] Copy old primitive UI directory into shared UI components root
  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/ui/*.tsx packages/ui/src/components/
  ```
  Notes:
  - this intentionally overwrites current primitives with the exact old versions
  - current files in `packages/ui/src/components/` are only a partial subset
  - primitives should stay flat in `packages/ui/src/components/*`
  - grouped families like `ai-elements` stay in subdirectories

### 4.2 Batch copy AI elements

- [x] Copy AI elements into shared UI
  ```bash
  mkdir -p packages/ui/src/components/ai-elements
  cp /Users/jeremy/Developer/gitinspect/src/components/ai-elements/*.tsx packages/ui/src/components/ai-elements/
  ```
  Notes:
  - this is likely the largest presentation surface to share with the extension later
  - some files may still require domain hook extraction into `packages/pi`

### 4.3 Batch copy visual feature components that are mostly presentation

- [x] Copy shell and reusable feature UI into shared UI
  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/app-header.tsx packages/ui/src/components/app-header.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/app-sidebar.tsx packages/ui/src/components/app-sidebar.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-composer.tsx packages/ui/src/components/chat-composer.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-empty-state.tsx packages/ui/src/components/chat-empty-state.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-footer.tsx packages/ui/src/components/chat-footer.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-message.tsx packages/ui/src/components/chat-message.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-model-selector.tsx packages/ui/src/components/chat-model-selector.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-session-list.tsx packages/ui/src/components/chat-session-list.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/chat.tsx packages/ui/src/components/chat.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/costs-panel.tsx packages/ui/src/components/costs-panel.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/data-settings.tsx packages/ui/src/components/data-settings.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/github-link.tsx packages/ui/src/components/github-link.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/github-repo.tsx packages/ui/src/components/github-repo.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/github-token-settings.tsx packages/ui/src/components/github-token-settings.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/landing-page.tsx packages/ui/src/components/landing-page.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/provider-settings.tsx packages/ui/src/components/provider-settings.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/proxy-settings.tsx packages/ui/src/components/proxy-settings.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/repo-combobox.tsx packages/ui/src/components/repo-combobox.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/settings-dialog.tsx packages/ui/src/components/settings-dialog.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/sidebar-mobile-actions.tsx packages/ui/src/components/sidebar-mobile-actions.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/tool-execution.tsx packages/ui/src/components/tool-execution.tsx
  cp /Users/jeremy/Developer/gitinspect/src/components/tool-result-bubble.tsx packages/ui/src/components/tool-result-bubble.tsx
  ```
  Notes:
  - these are copy-first targets, not guaranteed final untouched files
  - most of them will require replacing direct domain/storage imports with props or hooks from `packages/pi`

### 4.4 File-by-file visual components that should stay out of `packages/ui` or need splitting first

- [x] `src/components/root-guard.tsx`
      Action: keep in `apps/web`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/root-guard.tsx apps/web/src/components/root-guard.tsx
  ```

  Notes:
  - this is web bootstrap glue

- [x] `src/components/analytics.tsx`
      Action: keep in `apps/web`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/analytics.tsx apps/web/src/components/analytics.tsx
  ```

- [x] `src/components/auth-callback-page.tsx`
      Action: keep in `apps/web` as dormant web-only code

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/auth-callback-page.tsx apps/web/src/components/auth-callback-page.tsx
  ```

  Notes:
  - this is not a required product surface for the refactor
  - keep it unwired unless later auth work needs it

- [x] `src/components/chat-adapter.ts`
      Action: move to `packages/pi`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-adapter.ts packages/pi/src/lib/chat-adapter.ts
  ```

  Notes:
  - treat this as message/domain transformation logic by default

- [x] `src/components/chat-suggestions.ts`
      Action: keep in `packages/ui`
  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/components/chat-suggestions.ts packages/ui/src/components/chat-suggestions.ts
  ```

## Phase 5 — Thin `apps/web` down to routing and entry composition

### 5.1 Replace temporary starter app components

These current app-local starter pieces should be removed in favor of shared packages once equivalents exist.

- [x] `apps/web/src/components/header.tsx`
      Action: replace with route-level composition that uses `@gitinspect/ui/components/app-header`

- [x] `apps/web/src/components/loader.tsx`
      Action: keep as a tiny web-local helper

- [x] `apps/web/src/components/sign-in-form.tsx`
      Action: remove starter-only auth UI
      Notes:
  - the old repo does not have product-auth screens to preserve

- [x] `apps/web/src/components/sign-up-form.tsx`
      Action: remove starter-only auth UI
      Notes:
  - the old repo does not have product-auth screens to preserve

- [x] `apps/web/src/components/user-menu.tsx`
      Action: remove starter-only auth UI

### 5.2 Route-level files that remain in web

These should stay in `apps/web` and be rewritten to compose package exports.

- [x] Keep root route in web and wire shared providers/components

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/routes/__root.tsx apps/web/src/routes/__root.tsx
  ```

  Needs change:
  - adapt from old single-app route tree to current monorepo route layout
  - keep route concerns in web
  - compose providers from `packages/ui`, product auth from `packages/auth`, runtime from `packages/pi`

- [x] Keep index route in web and compose shared landing/chat surfaces

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/routes/index.tsx apps/web/src/routes/index.tsx
  ```

- [x] Preserve the old gitinspect route URLs exactly
      Notes:
  - remove current starter frontend routes/components that are not part of the old app
  - keep only the auth API route boilerplate where needed

### 5.3 Web-only files that should remain web-only

- [x] Keep web router bootstrap in web

  ```bash
  # no copy yet; adapt existing apps/web/src/router.tsx during implementation
  ```

- [x] Keep auth middleware in web, backed by `packages/auth`

  ```bash
  # no copy yet; adapt existing apps/web/src/middleware/auth.ts during implementation
  ```

- [x] Keep `apps/web/src/lib/auth-client.ts` in web as thin product-auth glue

- [x] Keep `apps/web/src/functions/get-user.ts` in web as thin product-auth glue

## File-by-file split watchlist

These are the files most likely to require real extraction work instead of direct copy:

- [x] `src/components/app-sidebar.tsx`
      Why: mixes sidebar UI with session lease/state loading

- [x] `src/components/chat.tsx`
      Why: mixes core chat UI with runtime orchestration, persistence, and session actions

- [x] `src/components/chat-model-selector.tsx`
      Why: mixes selector UI with model persistence and catalog logic

- [x] `src/components/provider-settings.tsx`
      Why: mixes settings UI with OAuth/API key persistence and provider registry logic

- [x] `src/components/data-settings.tsx`
      Why: mixes destructive settings UI with storage mutations

- [x] `src/components/repo-combobox.tsx`
      Why: mixes input UI, GitHub fetch logic, local repo history, and repo resolution

- [x] `src/components/settings-dialog.tsx`
      Why: likely becomes a shared shell composed from many shared subpanels, but currently pulls in multiple domain concerns directly

- [x] `src/components/landing-page.tsx`
      Why: mixes visual marketing shell with repo resolution/domain behavior

- [x] `src/components/ai-elements/model-selector.tsx`
      Why: likely presentation + provider/model domain entanglement

- [x] `src/components/ui/sidebar.tsx`
      Why: depends on `use-mobile`; verify it stays UI-only after migration

## Phase 6 — Complete repo audit coverage items

This section closes the gap between “core src migration” and “complete repo plan”.

## 6.1 Route tree coverage

The old repo route set is larger than the current starter web app.

Old routes:

- `src/routes/__root.tsx`
- `src/routes/index.tsx`
- `src/routes/chat.tsx`
- `src/routes/chat.index.tsx`
- `src/routes/chat.$sessionId.tsx`
- `src/routes/$owner.$repo.index.tsx`
- `src/routes/$owner.$repo.$.tsx`

Current starter frontend routes to remove:

- `apps/web/src/routes/dashboard.tsx`
- `apps/web/src/routes/login.tsx`

Final frontend route file set to keep/create:

- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/index.tsx`
- `apps/web/src/routes/chat.tsx`
- `apps/web/src/routes/chat.index.tsx`
- `apps/web/src/routes/chat.$sessionId.tsx`
- `apps/web/src/routes/$owner.$repo.index.tsx`
- `apps/web/src/routes/$owner.$repo.$.tsx`
- `apps/web/src/routes/api/auth/$.ts`

- [x] Lock the exact frontend route file set listed above
      Notes:
  - another agent should not guess route targets
  - preserve the old gitinspect frontend route set exactly
  - keep the existing `api/auth/$.ts` auth route

- [x] Copy the old route files into their exact final locations

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/routes/__root.tsx apps/web/src/routes/__root.tsx
  cp /Users/jeremy/Developer/gitinspect/src/routes/index.tsx apps/web/src/routes/index.tsx
  cp /Users/jeremy/Developer/gitinspect/src/routes/chat.tsx apps/web/src/routes/chat.tsx
  cp /Users/jeremy/Developer/gitinspect/src/routes/chat.index.tsx apps/web/src/routes/chat.index.tsx
  cp /Users/jeremy/Developer/gitinspect/src/routes/chat.$sessionId.tsx apps/web/src/routes/chat.$sessionId.tsx
  cp /Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx apps/web/src/routes/$owner.$repo.index.tsx
  cp /Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx apps/web/src/routes/$owner.$repo.$.tsx
  ```

- [x] Remove starter frontend-only route files that are not part of the old app

  ```bash
  rm -f apps/web/src/routes/dashboard.tsx apps/web/src/routes/login.tsx
  ```

- [x] `src/router.tsx`

  ```bash
  cp /Users/jeremy/Developer/gitinspect/src/router.tsx apps/web/src/router.tsx
  ```

  Needs change:
  - adapt to current app route layout and any route naming changes

- [x] Do **not** copy `src/routeTree.gen.ts`
      Notes:
  - generated file
  - regenerate from the current app after route files are in place

## 6.2 Server / Nitro coverage

This is now explicitly in scope because the deployed TanStack app will still use Nitro so the proxy continues to work.

- [x] Copy Nitro config into the web app/runtime entry strategy

  ```bash
  cp /Users/jeremy/Developer/gitinspect/nitro.config.ts apps/web/nitro.config.ts
  ```

  Notes:
  - Nitro config should live under `apps/web/`
  - user decision: Nitro/proxy behavior should be transferred as-is

- [x] Copy server routes into the web app server area

  ```bash
  mkdir -p apps/web/server/routes/api
  cp /Users/jeremy/Developer/gitinspect/server/routes/api/e.ts apps/web/server/routes/api/e.ts
  cp /Users/jeremy/Developer/gitinspect/server/routes/api/proxy.ts apps/web/server/routes/api/proxy.ts
  ```

  Notes:
  - keep exact old behavior first
  - later cleanup can reconcile path/layout with TanStack Start conventions if needed

- [x] Add server env parity note for Fireworks proxy

  ```bash
  cp /Users/jeremy/Developer/gitinspect/.env.example apps/web/.env.example
  ```

  Notes:
  - copy for reference, then merge with current env conventions during implementation
  - not all old env comments may stay verbatim

- [x] `apps/web/vite.config.ts`
      Action: incrementally merge old gitinspect behavior into the current starter config
      Notes:
  - keep the current `apps/web/vite.config.ts` file as the baseline
  - do **not** replace it wholesale with the old app config
  - merge only the clearly necessary old behavior
  - do **not** require `@tanstack/devtools-vite` or the full old plugin stack/order unless execution proves it necessary
  - merge in old behavior in this order:
    1. add `nitro()` plugin support
    2. add `vite-plugin-comlink`
    3. add the browser alias plugin for `node:zlib`
    4. add worker plugin configuration
    5. add `optimizeDeps.exclude` for `streamdown` packages
    6. preserve current TanStack Start + Tailwind + tsconfig-paths behavior
  - after the merge, `apps/web` should still be the bundler-facing owner of the config, even though runtime/worker code may live in packages

- [x] `src/shims/node-zlib.ts`

  ```bash
  mkdir -p apps/web/src/shims
  cp /Users/jeremy/Developer/gitinspect/src/shims/node-zlib.ts apps/web/src/shims/node-zlib.ts
  ```

  Notes:
  - required because the migrated Vite config should keep the browser alias for `node:zlib`

- [x] Lock worker/comlink bundling ownership
      Notes:
  - worker source lives in `packages/pi`
  - `apps/web` owns the Vite bundling layer and bundles the worker from there
  - do not move the whole worker setup back into `apps/web`

## 6.3 GitHub virtual FS / support library coverage

The old app has two related sources of GitHub runtime code:

- `src/lib/github/*`
- `just-github/*`

Current refactor repo already has `just-github/` present.

- [x] Keep `just-github` as the canonical GitHub implementation for now
      Notes:
  - do not rename or relocate it as part of this refactor plan
  - old `src/lib/github/*` should not remain the long-term source of truth

- [x] Copy old in-app GitHub runtime helpers into `packages/pi`
  ```bash
  mkdir -p packages/pi/src/lib/github
  cp /Users/jeremy/Developer/gitinspect/src/lib/github/*.ts packages/pi/src/lib/github/
  ```
  Notes:
  - do not keep these as the long-term source of truth
  - `just-github` is the canonical implementation for now
  - use this copy only as migration reference if something is still missing during execution

## 6.4 Auth provider coverage

The previous plan copied `src/auth/*.ts`, but the provider subdirectory also exists and must be included.

- [x] Copy provider auth implementations into `packages/pi`
  ```bash
  mkdir -p packages/pi/src/auth/providers
  cp /Users/jeremy/Developer/gitinspect/src/auth/providers/*.ts packages/pi/src/auth/providers/
  ```

## 6.5 Public asset coverage

To preserve exact product identity, public assets must be accounted for.

- [x] Copy old public assets into `apps/web/public`
  ```bash
  cp /Users/jeremy/Developer/gitinspect/public/apple-touch-icon.png apps/web/public/apple-touch-icon.png
  cp /Users/jeremy/Developer/gitinspect/public/favicon-96x96.png apps/web/public/favicon-96x96.png
  cp /Users/jeremy/Developer/gitinspect/public/favicon.ico apps/web/public/favicon.ico
  cp /Users/jeremy/Developer/gitinspect/public/favicon.svg apps/web/public/favicon.svg
  cp /Users/jeremy/Developer/gitinspect/public/manifest.json apps/web/public/manifest.json
  cp /Users/jeremy/Developer/gitinspect/public/robots.txt apps/web/public/robots.txt
  cp /Users/jeremy/Developer/gitinspect/public/site.webmanifest apps/web/public/site.webmanifest
  cp /Users/jeremy/Developer/gitinspect/public/web-app-manifest-192x192.png apps/web/public/web-app-manifest-192x192.png
  cp /Users/jeremy/Developer/gitinspect/public/web-app-manifest-512x512.png apps/web/public/web-app-manifest-512x512.png
  ```
  Notes:
  - current `apps/web/public` only contains `robots.txt`
  - old `public/manifest.json` and `public/site.webmanifest` are both present; verify which one is actually referenced by the new root route

## 6.6 Test coverage migration plan

If another agent executes the plan, they need to know what test coverage must move or be recreated.

### Tests that should move with `packages/db`

- [x] Re-home Dexie/storage tests to package-level tests
  - `tests/db-schema.test.ts`
  - session lease/runtime tests if split out

### Tests that should move with `packages/pi`

- [x] Re-home runtime/domain tests to package-level tests
  - `tests/agent-host-persistence.test.ts`
  - `tests/auth-service.test.ts`
  - `tests/bash-tool.test.ts`
  - `tests/chat-adapter.test.ts`
  - `tests/github-fetch.test.ts`
  - `tests/github-token.test.ts`
  - `tests/message-transformer.test.ts`
  - `tests/models-catalog.test.ts`
  - `tests/oauth-types.test.ts`
  - `tests/openai-codex-oauth.test.ts`
  - `tests/popup-flow.test.ts`
  - `tests/provider-proxy.test.ts`
  - `tests/provider-stream.test.ts`
  - `tests/proxy-settings.test.ts`
  - `tests/proxy.test.ts`
  - `tests/read-tool.test.ts`
  - `tests/ref-resolver.test.ts`
  - `tests/repo-runtime.test.ts`
  - `tests/repo-url.test.ts`
  - `tests/resolve-api-key.test.ts`
  - `tests/runtime-client.test.ts`
  - `tests/runtime-command-errors.test.ts`
  - `tests/runtime-errors.test.ts`
  - `tests/runtime-worker-client.test.ts`
  - `tests/runtime-worker.test.ts`
  - `tests/session-actions.test.ts`
  - `tests/session-notices.test.ts`
  - `tests/session-service.test.ts`
  - `tests/worker-backed-agent-host.test.ts`
  - `tests/lib/github-cache.test.ts`
  - `tests/lib/github-fs.test.ts`

### Tests that should move with `packages/ui`

- [x] Re-home UI/component tests to package-level tests
  - `tests/app-header.test.tsx`
  - `tests/chat-composer.test.tsx`
  - `tests/chat-first-send.test.tsx`
  - `tests/chat-message.test.tsx`
  - `tests/landing-page.test.tsx`
  - `tests/proxy-settings-ui.test.tsx` or equivalent if filename remains `.ts`
  - `tests/settings-dialog.test.tsx`

### Tests that should stay in `apps/web`

- [x] Keep route/bootstrap/integration tests near the web app
  - `tests/chat-routes.test.tsx`
  - `tests/chat-state.test.tsx`
  - `tests/root-guard.test.tsx`
  - `tests/auth-callback.test.ts` if the dormant callback component is retained/tested

### Shared test utilities

- [x] Copy shared render helper into a shared top-level test helpers location

  ```bash
  mkdir -p tests/lib
  cp /Users/jeremy/Developer/gitinspect/src/test/render-with-providers.tsx tests/lib/render-with-providers.tsx
  ```

  Notes:
  - shared test helpers should live in a top-level shared test utility area

- [x] Keep tests mostly top-level during migration
      Notes:
  - prioritize a working migrated suite first
  - do not spend early migration effort on physically relocating every test file into package folders
  - use ownership labels in the plan, but keep the one-root-runner workflow simple

- [x] `tests/setup.ts`
      Action: manually adapt global test setup into the new monorepo test layout
      Notes:
  - not a blind copy
  - paths and package boundaries will change

- [x] `vitest.config.ts`
      Action: introduce/adapt one root Vitest config for the monorepo test layout
      Notes:
  - use one root Vitest config for now
  - not a blind copy
  - package aliases and test include patterns must be updated

## 6.7 Tooling/config adaptation coverage

These are important for a successful execution, but they are not copy-paste tasks.

- [x] `package.json`
      Action: manually merge runtime dependencies needed by the migrated app/packages
      Notes:
  - preserve the current monorepo script/config baseline
  - do not overwrite the current monorepo root package setup
  - use Bun for dependency changes
  - dependency follows code ownership: move each dependency to the package/app that owns the migrated code
  - if a dependency is used in multiple packages/apps, put its version in the root Bun catalog and still declare it in each consuming package/app with `catalog:`
  - use the root catalog for shared version coordination, not as a substitute for package-local dependency declarations
  - treat old package scripts as reference only

- [x] `tsconfig.json`
      Action: manually merge any needed compiler options/paths into the new package-specific tsconfigs
      Notes:
  - keep the current monorepo TS structure
  - do not replace the current monorepo tsconfig structure wholesale
  - merge old single-app TS settings only into the package/app configs that actually need them
  - extend the existing source-path alias pattern during migration so `apps/web` can point at `@gitinspect/ui/*`, `@gitinspect/pi/*`, and `@gitinspect/db/*` package source as needed for live types/dev ergonomics

- [x] `components.json`
      Action: manually reconcile old shadcn config with current `packages/ui/components.json` and `apps/web/components.json`
      Notes:
  - `packages/ui/components.json` is the source of truth
  - `apps/web/components.json` should only mirror/point at shared UI ownership
  - old repo uses `radix-lyra` + phosphor + `src/styles.css`
  - current repo uses shared package aliases already
  - preserve exact visual/runtime outcomes, but keep the monorepo alias strategy

- [x] `.prettierrc` / `.prettierignore`
      Action: convert intent, not file contents
      Notes:
  - current repo standard is Oxlint + Oxfmt
  - do **not** copy Prettier config into the new repo
  - another agent should port only the meaningful style expectations if any are still missing from the current setup
  - tailwind class ordering expectations may need explicit handling elsewhere because `prettier-plugin-tailwindcss` is not the target formatter path here

- [x] `eslint.config.js`
      Action: convert intent, not file contents
      Notes:
  - current repo standard is Oxlint, not ESLint
  - do **not** copy the old ESLint config
  - only preserve rules/expectations if they are still necessary and not already covered by Oxlint/current setup

- [x] `README.md`, planning docs, and old repo metadata files
      Action: treat as reference only during implementation
      Notes:
  - do not block code migration on docs sync
  - docs cleanup can happen at the end

## 6.8 Files intentionally not copied verbatim

These should be documented so another agent does not waste time trying to migrate them directly.

- [x] Do not copy generated output/state folders
  - `.tanstack/`
  - `.turbo/`
  - `dist/`
  - `.output/`

- [x] Do not copy local env files
  - `.env`

- [x] Do not copy route tree generated files
  - `src/routeTree.gen.ts`

- [x] Do not blindly copy old repo-level lint/format configs
  - `.prettierrc`
  - `.prettierignore`
  - `eslint.config.js`

- [x] Do not copy docs/plan files as runtime migration steps
  - `plan.md`
  - `plan-git.md`
  - `research-multirepo.md`
  - `docs/**`

## Repo completeness audit summary

As of this pass, the plan explicitly covers:

- source directories under `src/`
- the exact frontend route set
- Nitro/server files
- auth provider subdirectory
- public assets
- Vite/Nitro/shim concerns
- GitHub runtime support files
- test migration categories
- config/tooling adaptation notes
- intentional non-copy items

Open work is now mostly execution detail, not architecture:

- copying/splitting files into their target packages
- merging Vite/Nitro/testing/tooling config carefully
- regenerating generated files after route/file moves

## Final cleanup step

This file should now be treated as the canonical execution brief for another agent.
