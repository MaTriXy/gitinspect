# OAuth CLI research

## Scope and method

I started from the folders you pointed at:

- `docs/sitegeist`
- `docs/pi-mono`
- current repo `apps/tui`

### Important note about the local repo state

In **this** checkout, both `docs/sitegeist` and `docs/pi-mono` are empty gitlinks/submodule pointers rather than populated directories.

The gitlinks in this repo point at:

- `sitegeist`: `104788c68e624a9705a9ee90f1d0b0176ad28747`
- `pi-mono`: `576e5e1a2fbe1abbbad96b696f4058cffd8391ca`

So to do the research properly, I fetched those exact upstream commits and read them directly.

I also compared them against the current local implementation in this repo, especially:

- `packages/pi/src/auth/*`
- `packages/ui/src/components/provider-settings.tsx`
- `apps/web/src/components/auth-callback-page.tsx`
- `apps/tui/*`

---

## Executive summary

The core finding is simple:

1. **Sitegeist** supports OAuth without controlling the redirect URI because it is a **browser extension**. It opens the provider auth page in a tab and watches that tab navigate to a known `localhost` callback URL. It does **not** need to own that callback server.
2. **pi-mono** supports OAuth without an app-controlled redirect URI because it is a **CLI**. It spins up a **local HTTP callback server** on the exact `localhost` redirect URI the provider expects, and it also supports **manual paste fallback** of the final redirect URL/code.
3. **Your web app cannot do either of those things cleanly in a normal browser page**:
   - it cannot watch arbitrary browser tab redirects like a Chrome extension can,
   - and it cannot reliably own provider-registered `localhost` callback URIs from a hosted web app.
4. Therefore, **a tiny CLI is the right primitive** for gitinspect if the problem is “we do not control the OAuth redirect URI”.

### The most important design takeaway

If you build a CLI for OAuth, the best architecture is:

- let the **CLI own the provider login flow**,
- let the **CLI receive the callback on localhost** or accept a pasted redirect URL,
- then let the CLI **handoff credentials to the web app** using either:
  - a **one-time handoff code** with backend exchange, or
  - a **copy/paste credential blob**.

I would **not** send raw OAuth credentials back to the app in a query param.

If you absolutely want redirect-back convenience, prefer:

- a **short-lived exchange code**, or
- at worst a URL **fragment** (`#payload=...`) instead of query params.

---

## What Sitegeist actually does

### High-level model

Relevant files:

- `sitegeist/src/oauth/browser-oauth.ts`
- `sitegeist/src/oauth/anthropic.ts`
- `sitegeist/src/oauth/openai-codex.ts`
- `sitegeist/src/oauth/google-gemini-cli.ts`
- `sitegeist/src/oauth/github-copilot.ts`
- `sitegeist/src/oauth/index.ts`
- `sitegeist/src/dialogs/ApiKeysOAuthTab.ts`
- `sitegeist/src/dialogs/ApiKeyOrOAuthDialog.ts`
- `sitegeist/static/manifest.chrome.json`
- `sitegeist/static/cors-rules.json`

Sitegeist has a reusable browser-extension OAuth helper:

- open auth URL in a new tab,
- listen to `chrome.tabs.onUpdated`,
- wait until the tab navigates to a `localhost` URL matching the expected redirect host,
- parse `code` and `state` directly from the tab URL,
- exchange the code for tokens via `fetch`.

That logic lives in `sitegeist/src/oauth/browser-oauth.ts`.

### Why this works for Sitegeist

Because Sitegeist is a browser extension, it has capabilities a normal web app does not have:

- `chrome.tabs.create(...)`
- `chrome.tabs.onUpdated`
- `chrome.tabs.onRemoved`
- broad `host_permissions`
- `declarativeNetRequest` rules to modify CORS headers

The extension manifest explicitly enables this:

- host permissions for `http://*/*`, `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`
- `declarativeNetRequest`
- `webNavigation`

The CORS rules in `sitegeist/static/cors-rules.json` add permissive response headers for domains like:

- `auth.openai.com`
- `platform.claude.com`
- `api.anthropic.com`
- `github.com/login/`

So Sitegeist’s trick is **extension privilege**, not a generic browser-page trick.

### The redirect URI strategy in Sitegeist

Sitegeist uses the same provider-specific registered localhost redirect URIs as the upstream CLIs/providers, for example:

- **Anthropic**: `http://localhost:53692/callback`
- **OpenAI Codex**: `http://localhost:1455/auth/callback`
- **Google Gemini CLI**: `http://localhost:8085/oauth2callback`
- **GitHub Copilot**: no redirect URI issue because it uses **device code flow**

Sitegeist does **not** run a local server for those. Instead, it watches the tab URL change to them.

That means:

- the provider can still redirect to the expected `localhost` URI,
- the page load can fail or never complete,
- but the extension already captured the full URL and extracted the `code`.

### Provider-specific Sitegeist details

#### 1. Anthropic

File: `sitegeist/src/oauth/anthropic.ts`

Pattern:

- PKCE
- `state = verifier`
- opens `https://claude.ai/oauth/authorize`
- expects redirect to `http://localhost:53692/callback`
- exchanges code at `https://platform.claude.com/v1/oauth/token`

Important specifics:

- expiry stored with a 5-minute safety buffer
- refresh token supported
- browser CORS constraints are handled via extension header rewriting

#### 2. OpenAI Codex

File: `sitegeist/src/oauth/openai-codex.ts`

Pattern:

- PKCE + separate random `state`
- opens `https://auth.openai.com/oauth/authorize`
- expects redirect to `http://localhost:1455/auth/callback`
- exchanges code at `https://auth.openai.com/oauth/token`

Important specifics:

- sends `codex_cli_simplified_flow=true`
- sends `id_token_add_organizations=true`
- sends `originator=sitegeist`
- decodes the JWT and extracts `chatgpt_account_id`
- stores that as `accountId`

This `accountId` is not cosmetic; Sitegeist treats it as required.

#### 3. Google Gemini CLI

File: `sitegeist/src/oauth/google-gemini-cli.ts`

Pattern:

- PKCE
- Google auth flow with `offline` access and `prompt=consent`
- expects redirect to `http://localhost:8085/oauth2callback`
- exchanges code at `https://oauth2.googleapis.com/token`

Important specifics:

- after token exchange, it performs **project discovery / onboarding** against Google Cloud Code Assist endpoints
- it stores a `projectId`
- downstream API key resolution for Gemini is **not just the access token**
- instead it returns JSON like:

```json
{
  "token": "...",
  "projectId": "..."
}
```

So Gemini import/export must preserve `projectId`.

#### 4. GitHub Copilot

File: `sitegeist/src/oauth/github-copilot.ts`

Pattern:

- **device authorization flow**, not redirect-based OAuth
- gets a `user_code` and `verification_uri`
- opens verification URL in a tab
- polls GitHub for access token
- then fetches Copilot token from `copilot_internal/v2/token`

Important specifics:

- stored `refresh` is actually the **GitHub access token**
- stored `access` is the **Copilot token**
- refresh means “use GitHub token to get a new Copilot token”

So Copilot is already a strong proof that the product can support OAuth without redirect control if the provider supports a device flow.

### How Sitegeist stores and uses credentials

Files:

- `sitegeist/src/oauth/types.ts`
- `sitegeist/src/oauth/index.ts`
- `sitegeist/src/sidepanel.ts`
- `sitegeist/src/dialogs/ApiKeysOAuthTab.ts`

Credentials are stored as JSON strings in the provider key store.

Shape:

```ts
interface OAuthCredentials {
  providerId: string;
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  projectId?: string;
}
```

Important runtime behavior:

- if stored value starts with `{`, it is treated as OAuth JSON
- expired credentials are refreshed automatically
- refreshed credentials are persisted back into storage
- Gemini CLI is converted to `{ token, projectId }` when resolving the effective API key

### What is Sitegeist-specific and should NOT be copied literally

Do **not** assume these Sitegeist mechanics are portable to your web app:

1. **Watching tab navigation to localhost**
   - requires extension APIs
2. **Rewriting CORS headers with declarativeNetRequest**
   - requires extension permissions
3. **Broad host_permissions**
   - also extension-only

Those are the reason Sitegeist can make the browser flow work.

---

## What pi-mono actually does

### High-level model

Relevant files:

- `pi-mono/packages/ai/src/utils/oauth/types.ts`
- `pi-mono/packages/ai/src/utils/oauth/index.ts`
- `pi-mono/packages/ai/src/utils/oauth/anthropic.ts`
- `pi-mono/packages/ai/src/utils/oauth/openai-codex.ts`
- `pi-mono/packages/ai/src/utils/oauth/google-gemini-cli.ts`
- `pi-mono/packages/ai/src/utils/oauth/github-copilot.ts`
- `pi-mono/packages/coding-agent/src/core/auth-storage.ts`
- `pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `pi-mono/packages/coding-agent/src/modes/interactive/components/login-dialog.ts`
- `pi-mono/packages/coding-agent/docs/custom-provider.md`
- `pi-mono/packages/coding-agent/docs/providers.md`

pi-mono’s solution is the most relevant one for your proposed CLI.

It does **not** depend on a hosted web app redirect URI.

Instead, for providers that require auth-code redirects, it:

- starts a **local HTTP server** on the expected localhost callback port,
- opens the auth URL in the browser,
- waits for the callback,
- and importantly also supports **manual paste fallback** of the final redirect URL/code.

### The abstraction pi-mono exposes

In `packages/ai/src/utils/oauth/types.ts`, the key interface is:

```ts
interface OAuthLoginCallbacks {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  signal?: AbortSignal;
}
```

This is extremely important.

pi-mono explicitly models three UX channels:

1. **open/show an auth URL**
2. **prompt the user for input**
3. **accept a manually pasted callback URL/code while the browser flow is still running**

That third piece is the missing link for your use case.

### The built-in callback-server pattern

For **OpenAI Codex**, **Anthropic**, and **Gemini CLI**, pi-mono sets `usesCallbackServer: true` on the provider.

That means the TUI knows to:

- display the URL,
- open the browser,
- show an immediate input box saying effectively:
  - “paste redirect URL below, or complete login in browser”.

This behavior lives in:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/coding-agent/src/modes/interactive/components/login-dialog.ts`

The flow is:

1. create local server
2. emit auth URL
3. race:
   - local callback server receives `code`
   - user pastes full redirect URL or raw code manually
4. whichever completes first wins
5. exchange code for tokens
6. persist credentials

This is exactly the kind of resilience you want for a tiny terminal auth helper.

### Provider-specific pi-mono details

#### 1. OpenAI Codex

File: `packages/ai/src/utils/oauth/openai-codex.ts`

Important specifics:

- redirect URI: `http://localhost:1455/auth/callback`
- local server listens on that route
- manual input parser accepts:
  - full redirect URL
  - raw `code`
  - `code=...&state=...`
  - `code#state`
- it validates `state`
- it extracts `accountId` from JWT claims
- provider metadata marks `usesCallbackServer: true`

A subtle difference from Sitegeist/current gitinspect:

- pi-mono defaults `originator` to `pi`
- your current repo hardcodes `originator=sitegeist`

This likely is configurable/tolerated, but it is worth noting.

#### 2. Anthropic

File: `packages/ai/src/utils/oauth/anthropic.ts`

Important specifics:

- redirect URI: `http://localhost:53692/callback`
- local callback server
- manual paste fallback supported and raced against callback
- explicit progress messages like “Exchanging authorization code for tokens...”
- refresh flow returns token expiry with a 5-minute buffer
- provider metadata marks `usesCallbackServer: true`

This is much more robust than a browser-only popup approach because it works even if the browser is remote and the user just pastes the final redirect URL.

#### 3. Google Gemini CLI

File: `packages/ai/src/utils/oauth/google-gemini-cli.ts`

Important specifics:

- redirect URI: `http://localhost:8085/oauth2callback`
- local server + manual paste race
- token exchange includes client secret
- fetches user email
- discovers / provisions Google project
- `getApiKey(...)` returns JSON string with token + projectId
- provider metadata marks `usesCallbackServer: true`

Again, if you import/export Gemini credentials, `projectId` is mandatory.

#### 4. GitHub Copilot

File: `packages/ai/src/utils/oauth/github-copilot.ts`

Important specifics:

- device flow, not callback server
- prompts for optional GitHub Enterprise domain
- exposes auth URL + instructions (`Enter code: ...`)
- polls until authorized
- post-login it even tries to enable models automatically
- `modifyModels(...)` can change base URL based on token/domain

This is a good model for providers where redirect URIs are painful or unavailable.

### Auth storage in pi-mono

File: `packages/coding-agent/src/core/auth-storage.ts`

This is another very relevant reference.

pi-mono persists credentials to `~/.pi/agent/auth.json` using structured entries:

```json
{
  "anthropic": { "type": "oauth", ... },
  "openai": { "type": "api_key", "key": "..." }
}
```

Key qualities:

- file permissions locked down (`0600`)
- parent dir created with `0700`
- refresh path is protected with **file locking** via `proper-lockfile`
- if multiple pi instances refresh simultaneously, only one wins cleanly
- token refresh happens centrally in auth storage

For a small standalone auth CLI, you do not need all of this immediately, but the data model and lock discipline are very good references.

### pi-mono docs and examples confirm the intended extensibility

The docs are explicit that custom providers can integrate with `/login` via OAuth.

Relevant docs:

- `packages/coding-agent/docs/custom-provider.md`
- `packages/coding-agent/docs/providers.md`
- `packages/coding-agent/docs/extensions.md`

And the examples prove the patterns:

- `examples/extensions/custom-provider-gitlab-duo/index.ts`
  - auth-code flow with pasted callback URL
- `examples/extensions/custom-provider-qwen-cli/index.ts`
  - device code flow with PKCE and polling

This matters because it shows pi-mono’s OAuth design is not a one-off hack for built-ins; it is a deliberate reusable pattern.

---

## Side-by-side comparison: Sitegeist vs pi-mono vs current gitinspect

| Concern                                    | Sitegeist                                   | pi-mono                                 | current gitinspect                                     |
| ------------------------------------------ | ------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Runtime                                    | Browser extension                           | Local CLI/TUI                           | Web app + browser popup                                |
| How it avoids owning web redirect URI      | Watches tab URL changes to localhost        | Runs local callback server on localhost | Currently assumes same-origin app callback             |
| Works without extension APIs               | No                                          | Yes                                     | Partially, but only if redirect URI points back to app |
| Manual paste fallback                      | Not the main pattern                        | Yes, first-class                        | No                                                     |
| Device flow support                        | Yes (Copilot)                               | Yes (Copilot, extensible)               | Yes (Copilot)                                          |
| CORS escape hatch                          | Extension header rewriting / optional proxy | Node, so no browser CORS problem        | Proxy needed for some cases                            |
| Best fit for your proposed npx auth helper | Medium reference                            | **Best reference**                      | Storage target only                                    |

### My conclusion from this comparison

- **Sitegeist** gives you the browser-extension trick.
- **pi-mono** gives you the CLI trick.
- **Your planned gitinspect auth CLI should copy pi-mono’s model, not Sitegeist’s.**

Sitegeist is valuable mainly for understanding:

- provider-specific redirect URIs
- data shapes
- how the browser-side store/resolution works

pi-mono is valuable for understanding:

- how to build a robust terminal UX for OAuth
- how to survive lack of redirect control
- how to support both automatic and manual completion

---

## What the current gitinspect repo already has

### 1. The web app currently assumes app-controlled callback URLs

Relevant files:

- `packages/pi/src/auth/popup-flow.ts`
- `apps/web/src/components/auth-callback-page.tsx`
- `packages/ui/src/components/provider-settings.tsx`

Current flow:

- build `redirectUri = ${window.location.origin}/auth/callback`
- open popup
- callback page posts `window.location.href` to `window.opener`
- popup closes
- auth provider exchanges code for tokens

So current gitinspect auth depends on **your app owning the redirect URL**.

That is exactly the limitation you called out.

### 2. The provider implementations already mirror Sitegeist’s browser logic

Relevant files:

- `packages/pi/src/auth/providers/anthropic.ts`
- `packages/pi/src/auth/providers/openai-codex.ts`
- `packages/pi/src/auth/providers/google-gemini-cli.ts`
- `packages/pi/src/auth/providers/github-copilot.ts`

These already encode the important provider-specific token semantics:

- Anthropic: access/refresh/expires
- OpenAI Codex: access/refresh/expires + `accountId`
- Gemini CLI: access/refresh/expires + `projectId`
- GitHub Copilot: device flow, `refresh` is GitHub token

So the data model you need for CLI import is already basically present.

### 3. Current storage is already suitable for imported credentials

Relevant files:

- `packages/pi/src/auth/oauth-types.ts`
- `packages/pi/src/auth/resolve-api-key.ts`
- `packages/pi/src/auth/auth-service.ts`

Your current stored OAuth shape is:

```ts
interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  projectId?: string;
  providerId: "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";
  refresh: string;
}
```

That means a CLI can hand the web app a blob that maps almost 1:1 to what the app already knows how to store.

### 4. The current UI has OAuth disabled anyway

File:

- `packages/ui/src/components/provider-settings.tsx`

There is a flag:

```ts
const OAUTH_SUBSCRIPTION_LOGIN_ENABLED = false;
```

So replacing the future browser flow with a CLI-assisted flow is relatively low-risk from a user-facing migration perspective.

### 5. `apps/tui` is currently a stub

Files:

- `apps/tui/package.json`
- `apps/tui/src/index.tsx`

`apps/tui` is just the default OpenTUI scaffold right now.

That means replacing it with:

- a small Node CLI,
- Effect-based orchestration,
- `@clack/prompts`-style terminal UX,

is operationally easy. You are not ripping out meaningful app logic.

---

## The real constraint behind your problem

Your problem is not really “OAuth is hard”.

It is specifically:

> some providers only accept redirect URIs that are already registered with the upstream CLI/app, and our hosted web app does not control those redirect URIs.

From the research, there are only a few real ways around that:

1. **Extension trick**
   - Sitegeist approach
   - only works because of extension APIs
2. **Local callback server**
   - pi-mono approach
   - ideal for a CLI
3. **Device flow**
   - great when the provider supports it
4. **Backend-owned redirect URI**
   - standard web approach, but requires provider/client registration you may not have
5. **Manual paste fallback**
   - robust, low-tech, works surprisingly well

For gitinspect, #2 + #5 is the best fit.

---

## Recommended architecture for gitinspect

## Recommendation: build a tiny auth CLI, not a browser OAuth layer

I would recommend:

- **keep the web app as the place where credentials are stored/used**
- **move OAuth acquisition into a tiny CLI**
- **handoff the resulting credential blob into the app**

### Why this is the right split

Because the CLI can:

- open the system browser
- run a localhost callback server
- avoid browser CORS constraints entirely
- still fall back to pasted redirect URLs/codes

And the web app can:

- validate the imported payload
- persist it to Dexie / providerKeys
- continue using the existing `resolve-api-key` path

---

## Recommended flow design

### Preferred flow: CLI + one-time handoff code

This is the cleanest UX if you have any backend or relay available.

#### Flow

1. User clicks “Connect with CLI” in the web app.
2. App creates a short-lived `handoffId` and shows a command like:

```bash
npx gitinspect-auth login openai-codex --handoff abc123
```

3. CLI runs provider login.
4. CLI obtains credentials.
5. CLI sends credentials to backend/relay keyed by `handoffId`.
6. Web app polls or subscribes for completion.
7. Web app imports credentials locally and deletes the handoff.

#### Why this is best

- no raw tokens in URL
- no copy/paste needed if everything works
- still compatible with localhost callback server pattern
- can support mobile/remote browser if CLI prints fallback instructions

### Good fallback: CLI prints copy/paste blob

If you want the very simplest first version and want to avoid backend work, this is the best fallback.

#### Flow

1. User runs:

```bash
npx gitinspect-auth login openai-codex
```

2. CLI completes OAuth.
3. CLI prints either:
   - raw JSON credentials, or
   - base64url-encoded JSON blob
4. User pastes that into a new “Import OAuth credentials” dialog in the web app.
5. App validates provider + required fields + expiry and stores it.

#### Why this is strong

- no backend required
- easy to debug
- resilient to redirect weirdness
- secure enough if you do not leak it into URLs/logs

### Only-if-you-really-want-it: CLI redirects back to app

If you want browser convenience after CLI auth, do **not** use raw query params.

If you must redirect back to the app, prefer:

```text
https://app.example.com/oauth/import#payload=BASE64URL(...)
```

Better still:

```text
https://app.example.com/oauth/import#handoff=opaque-one-time-code
```

#### Why query params are a bad idea

Raw access/refresh tokens in query params can leak into:

- browser history
- server/access logs
- analytics
- screenshots / copy-paste
- referrer chains in some cases

Fragments are less bad because they stay client-side, but they are still visible locally and still sensitive.

So the ranking is:

1. **opaque one-time code**
2. **copy/paste blob**
3. **URL fragment with payload**
4. **query params with payload** ← avoid

---

## Recommended provider implementation strategy

## Copy pi-mono’s auth acquisition model

For `apps/tui` / new auth CLI, I would copy these pi-mono ideas almost directly:

### For Anthropic / OpenAI Codex / Gemini CLI

- start local server on provider-specific localhost port/path
- open browser to auth URL
- race callback server against manual pasted redirect URL
- if neither succeeds quickly enough, prompt for paste
- exchange code for token in Node
- serialize imported credential payload

### For GitHub Copilot

- use device flow
- show `user_code`
- open verification URL
- poll until success

### For future custom providers

Use the pi-mono extension examples as templates:

- auth-code flow: `custom-provider-gitlab-duo`
- device flow: `custom-provider-qwen-cli`

---

## Provider-specific import requirements for gitinspect

If the web app imports credentials produced by the CLI, validate them per provider.

### Anthropic

Required:

- `providerId: "anthropic"`
- `access`
- `refresh`
- `expires`

### OpenAI Codex

Required:

- `providerId: "openai-codex"`
- `access`
- `refresh`
- `expires`
- `accountId`

`accountId` must be extracted from the JWT and preserved.

### Google Gemini CLI

Required:

- `providerId: "google-gemini-cli"`
- `access`
- `refresh`
- `expires`
- `projectId`

`projectId` is mandatory because the runtime API key is actually:

```json
{
  "token": "...",
  "projectId": "..."
}
```

### GitHub Copilot

Required:

- `providerId: "github-copilot"`
- `access`
- `refresh`
- `expires`

Note:

- `refresh` is the GitHub access token
- `access` is the current Copilot token

### One gap to be aware of

pi-mono’s Copilot flow can carry `enterpriseUrl`, but your current gitinspect `OAuthCredentials` type does **not** include it.

So if GitHub Enterprise support matters later, your local type will need to grow.

---

## Security and operational implications

### 1. CLI auth avoids browser CORS pain

This is especially relevant for Anthropic.

In Sitegeist/browser land, CORS/proxy workarounds are required.
In CLI/Node land, token exchange is a normal server-side HTTP request.

This is a big win.

### 2. But browser refresh may still matter later

Your current web app refreshes imported OAuth credentials inside browser code:

- `packages/pi/src/auth/resolve-api-key.ts`
- `packages/pi/src/auth/oauth-refresh.ts`

For Anthropic, the browser path currently relies on an optional proxy for refresh/token calls.

So even if the CLI acquires the initial credentials, you still have to decide:

- do refreshes continue in-browser using your current proxy strategy?
- or do you eventually want refreshes delegated to some backend/CLI helper too?

My take:

- **initial login via CLI** is already a huge improvement
- **refresh can stay where it is for now**
- especially since your current code already supports Anthropic proxy refresh in the browser

### 3. Copy/paste is safer than URL payloads

If you are backendless, a paste blob is the safest easy thing.

If you do redirect, use:

- opaque handoff codes, or
- fragments, not queries

### 4. Validate imported payloads aggressively

The app-side import path should verify:

- providerId is known
- required fields exist
- expires is a valid number and not already stale
- OpenAI Codex has `accountId`
- Gemini has `projectId`

### 5. Consider short-lived export format

If you do a copy/paste blob, you may want an import envelope like:

```json
{
  "version": 1,
  "createdAt": 1770000000000,
  "provider": "openai-codex",
  "credentials": {
    "providerId": "openai-codex",
    "access": "...",
    "refresh": "...",
    "expires": 1770003600000,
    "accountId": "acct_..."
  }
}
```

This gives you room for migrations later.

---

## Concrete recommendation for `apps/tui`

Since `apps/tui` is currently just OpenTUI scaffolding, I would reshape it into a tiny auth CLI with this rough surface area:

### Proposed commands

```bash
npx gitinspect-auth login anthropic
npx gitinspect-auth login openai-codex
npx gitinspect-auth login google-gemini-cli
npx gitinspect-auth login github-copilot
```

Optional app handoff:

```bash
npx gitinspect-auth login openai-codex --handoff <one-time-code>
```

Optional no-backend import:

```bash
npx gitinspect-auth login openai-codex --print-json
npx gitinspect-auth login openai-codex --print-base64
```

### Proposed runtime behavior

For callback-server providers:

1. print/open auth URL
2. start localhost server on exact provider port/path
3. show “paste redirect URL here if browser completes elsewhere”
4. race both paths
5. exchange tokens
6. print/import payload

For device-code providers:

1. print verification URL and user code
2. optionally auto-open browser
3. poll until success
4. print/import payload

### Suggested implementation style

Your idea of:

- **Effect** for orchestration
- **clack** prompts for UX

makes sense.

Based on the research, the terminal UX you need is actually small:

- select provider
- show URL/instructions
- optionally prompt for paste input
- show progress
- print success + output payload

You do not need a full TUI for this.

---

## What I would explicitly reuse from the existing repo

### Reuse directly or conceptually

- current credential type from `packages/pi/src/auth/oauth-types.ts`
- current storage write path via `setProviderKey(...)`
- current `resolve-api-key.ts` semantics, especially Gemini JSON key behavior
- provider registry names/labels from `packages/pi/src/auth/auth-service.ts`

### Re-implement using pi-mono patterns

- localhost callback server flow
- manual redirect URL/code paste fallback
- provider-specific auth acquisition logic for auth-code providers
- device flow UX

### Do not copy from Sitegeist into web app

- `chrome.tabs` based redirect watching
- manifest-level CORS hacks
- extension-only assumptions

---

## Open questions / follow-ups

These are the main design questions still worth deciding before implementation:

1. **Do you want a backend-assisted handoff, or pure copy/paste?**
   - backend-assisted is cleaner UX
   - copy/paste is simpler and likely enough for v1
2. **Will imported credentials be refreshed in-browser, or only acquired in CLI?**
   - for now, I think “CLI for initial login, existing browser refresh path stays” is fine
3. **Do you care about GitHub Enterprise Copilot support in v1?**
   - if yes, current local credential type likely needs an `enterpriseUrl` field
4. **Do you want redirect-back convenience?**
   - if yes, use one-time code or fragment, not query param payloads

---

## Final recommendation

If the problem is:

> “we do not control the OAuth redirect URI, but we still want users to connect subscription accounts from the app”

then the cleanest solution is:

### Build a tiny CLI auth helper modeled after pi-mono

- **Auth acquisition**: CLI
- **Callback ownership**: localhost server in CLI
- **Fallback**: manual pasted redirect URL / device code
- **Credential consumption**: web app
- **Handoff**: one-time exchange code if you have backend support, otherwise copy/paste blob

### What I would not do

I would **not** try to stretch the current browser popup flow to solve this in the hosted web app.

That current flow fundamentally assumes you own the redirect URL.
Sitegeist only escapes that because it is an extension.

### What I would do first

If you want the smallest possible successful version:

1. replace `apps/tui` with a minimal CLI auth helper
2. implement **OpenAI Codex**, **Anthropic**, **Gemini CLI**, **GitHub Copilot**
3. support:
   - local callback server for auth-code providers
   - device flow for Copilot
   - copy/paste import blob
4. add an “Import OAuth credentials” dialog in the web app
5. optionally add one-time backend handoff later

That gives you a robust solution without needing to control the provider redirect URI from the web app itself.
