# Auth Resolution Research

## Scope

This document compares:

- Our app auth implementation in `src/auth/*`
- Sitegeist browser-extension auth implementation in `docs/sitegeist/src/oauth/*`
- The underlying `pi-ai` OAuth implementations in `docs/pi-mono/packages/ai/src/utils/oauth/*`

The goal was to understand:

- how auth resolution works end-to-end
- how login and refresh differ by provider
- how redirect URIs are chosen
- what `localhost:1455` is and whether redirect ports differ by provider
- where our implementation diverges from Sitegeist in meaningful ways

---

## Executive Summary

The biggest architectural difference is this:

- Sitegeist preserves the provider-specific OAuth shape from `pi-ai`, including provider-specific localhost redirect URIs.
- Our app collapsed browser OAuth into a single same-origin popup callback route: `window.location.origin + /auth/callback`.

That simplification made the UI flow easier to implement, but it moved us away from how Sitegeist and `pi-ai` are designed.

The second major difference is auth resolution structure:

- Sitegeist has a thinner, more centralized OAuth layer.
- Our app splits auth behavior across `auth-service.ts`, `resolve-api-key.ts`, popup helpers, provider-specific modules, settings UI, and DB persistence helpers.

The third important difference is extension vs web constraints:

- Sitegeist is a Chrome extension and can watch tabs redirecting to localhost.
- We are a normal browser app, so we cannot rely on `chrome.tabs` and instead use a popup + same-origin callback page.
- Because of that, some of our divergence is intentional and necessary.

Still, the redirect strategy is the clearest place where our implementation is materially different from Sitegeist.

---

## End-to-End Flow In Our App

### 1. Provider settings UI starts auth

`src/components/provider-settings.tsx`

Behavior:

- Builds a single redirect URI:
  - `http(s)://<current-origin>/auth/callback`
- For OAuth-capable providers, calls:
  - `oauthLogin(provider, redirectUri, onDeviceCode?, options?)`
- For Anthropic only, login may receive proxy settings
- On success, credentials are serialized as JSON and stored via `setProviderApiKey()`

Important detail:

- We use one redirect URI strategy for Anthropic, OpenAI Codex, and Gemini CLI
- GitHub Copilot does not use redirect URIs at all because it is a device-code flow

### 2. Popup callback transport

`src/auth/popup-flow.ts`
`src/routes/auth.callback.tsx`

Behavior:

- Opens a popup to the provider auth URL
- Waits for a `postMessage()` from the callback page
- Callback page posts `{ type: "oauth-callback", url: window.location.href }` back to `window.opener`
- Parent verifies same-origin and parses the final redirect URL

This means our OAuth flow assumes:

- the provider can redirect back to our app origin
- that exact origin is registered and accepted by the provider client

### 3. Auth service dispatch

`src/auth/auth-service.ts`

Behavior:

- Maintains a hardcoded set of OAuth providers:
  - `anthropic`
  - `github-copilot`
  - `google-gemini-cli`
  - `openai-codex`
- Dispatches login and refresh through `switch` statements
- Stores serialized credentials as provider-key values

This is a simple coordinator, but it is not a provider registry like `pi-ai`’s OAuth module.

### 4. Runtime auth resolution

`src/auth/resolve-api-key.ts`

Behavior:

- Reads the stored provider key
- If it is plain text, returns it directly
- If it looks like JSON, parses it as OAuth credentials
- Refreshes if expiry is within 60 seconds
- Persists refreshed credentials back into Dexie
- Special-cases Gemini CLI:
  - returned runtime API key is JSON: `{ token, projectId }`
- Falls back to a bundled public key for `providerGroup === "opencode-free"`

This is where runtime auth resolution actually happens in our app.

---

## End-to-End Flow In Sitegeist

### 1. UI / Agent setup

`docs/sitegeist/src/sidepanel.ts`

Sitegeist sets up the agent with:

- `streamFn: createStreamFn(...)`
- `getApiKey: async (provider) => ...`

The important auth part:

- provider keys are read from storage
- if the stored value is OAuth JSON, it is resolved centrally through the OAuth layer

### 2. Centralized OAuth entrypoint

`docs/sitegeist/src/oauth/index.ts`

Sitegeist’s OAuth module is thinner than ours:

- `oauthLogin(provider, _proxyUrl?, onDeviceCode?)`
- `oauthRefresh(credentials, _proxyUrl?)`
- `resolveApiKey(storedValue, provider, storage, proxyUrl?)`

Compared to our app:

- Sitegeist keeps the OAuth-specific logic much closer to one central module
- Our app split equivalent behavior into:
  - `auth-service.ts`
  - `resolve-api-key.ts`
  - provider modules
  - popup helpers

### 3. Browser extension redirect capture

`docs/sitegeist/src/oauth/browser-oauth.ts`

Sitegeist does not use a same-origin callback page.

Instead it:

- opens the provider auth URL in a Chrome tab
- watches `chrome.tabs.onUpdated`
- waits until the tab hits a localhost redirect URL
- extracts code/state from that URL
- closes the tab

This is the key difference from our app.

Sitegeist keeps the OAuth client’s expected localhost redirect URI, but replaces the local callback server with tab URL watching.

---

## How `pi-ai` Does It

The `pi-ai` implementations are the base design that Sitegeist adapts.

Relevant files:

- `docs/pi-mono/packages/ai/src/utils/oauth/anthropic.ts`
- `docs/pi-mono/packages/ai/src/utils/oauth/openai-codex.ts`
- `docs/pi-mono/packages/ai/src/utils/oauth/google-gemini-cli.ts`
- `docs/pi-mono/packages/ai/src/utils/oauth/github-copilot.ts`

`pi-ai` assumes a Node/CLI environment for browser-based authorization-code providers:

- starts a local HTTP server on a provider-specific port
- opens the browser
- waits for the redirect to localhost
- optionally supports manual pasted redirect input if callback handling fails

Sitegeist keeps the same provider URLs and redirect URIs, but swaps:

- local HTTP server callback handling

for:

- Chrome tab redirect watching

Our app swaps both:

- callback transport
- redirect URI strategy

That makes us the furthest from the original provider contract.

---

## Provider-by-Provider Analysis

## Anthropic

### `pi-ai`

File:

- `docs/pi-mono/packages/ai/src/utils/oauth/anthropic.ts`

Redirect URI:

- `http://localhost:53692/callback`

Behavior:

- PKCE flow
- `state` is set to the verifier
- token endpoint is JSON POST
- refresh token flow uses the same token endpoint
- supports manual input and callback-server fallback behavior in CLI

### Sitegeist

File:

- `docs/sitegeist/src/oauth/anthropic.ts`

Redirect URI:

- `http://localhost:53692/callback`

Behavior:

- same client ID
- same scopes
- same redirect URI
- no callback server
- watches browser tab for redirect to `localhost:53692`
- token exchange and refresh preserved

### Our app

File:

- `src/auth/providers/anthropic.ts`

Redirect URI:

- dynamic, passed in from UI
- today this is `window.location.origin + "/auth/callback"`

Behavior:

- same client ID
- same scopes
- popup-based redirect handling
- token exchange uses JSON POST via `postTokenRequest()`
- refresh may use proxy when enabled

Important difference:

- Sitegeist preserves Anthropic’s localhost redirect contract
- we replace it with a same-origin web-app callback

Important practical implication:

- if the Anthropic OAuth app is only configured for the localhost callback URI used by CLI/Sitegeist, our flow will not be equivalent
- if our current flow works, it means Anthropic’s registered app accepts our deployed origin callback too, or the app is configured differently than the vendored code suggests

### Proxy behavior

This is another real divergence:

- Sitegeist browser extension relies on extension capabilities / manifest rules for Anthropic CORS
- our web app explicitly proxies token exchange and refresh for Anthropic when proxy is enabled

This divergence is justified by environment differences.

---

## OpenAI Codex

### `pi-ai`

File:

- `docs/pi-mono/packages/ai/src/utils/oauth/openai-codex.ts`

Redirect URI:

- `http://localhost:1455/auth/callback`

Behavior:

- PKCE flow
- separate random `state`
- uses:
  - `codex_cli_simplified_flow=true`
  - `id_token_add_organizations=true`
  - `originator=pi`
- local server binds specifically on port `1455`
- callback path is `/auth/callback`
- token refresh uses refresh token
- account ID extracted from JWT claim path `https://api.openai.com/auth`

### Sitegeist

File:

- `docs/sitegeist/src/oauth/openai-codex.ts`

Redirect URI:

- `http://localhost:1455/auth/callback`

Behavior:

- same client ID
- same flags
- same JWT parsing
- `originator=sitegeist`
- watches redirect to `localhost:1455` instead of running a local server

### Our app

File:

- `src/auth/providers/openai-codex.ts`

Redirect URI:

- dynamic same-origin `/auth/callback`

Behavior:

- same client ID
- same extra authorize params except:
  - `originator=sitegeist`
- popup-based callback page
- same token exchange and JWT account extraction

Important finding:

- `1455` is not a global OAuth port
- it is specific to OpenAI Codex / ChatGPT OAuth in the upstream `pi-ai` and Sitegeist implementations
- it differs from Anthropic and Gemini

This directly answers the “is 1455 different per provider?” question:

- Yes.
- OpenAI Codex uses `1455`
- Anthropic uses `53692`
- Gemini CLI uses `8085`
- Google Antigravity uses `51121`
- GitHub Copilot uses no redirect URI because it uses device code

Important divergence:

- Sitegeist intentionally preserves the OpenAI localhost callback contract
- we do not

This is the clearest concrete mismatch between our implementation and Sitegeist.

---

## Google Gemini CLI

### `pi-ai`

File:

- `docs/pi-mono/packages/ai/src/utils/oauth/google-gemini-cli.ts`

Redirect URI:

- `http://localhost:8085/oauth2callback`

Behavior:

- PKCE flow
- Google authorization-code exchange with client secret
- requires offline access and `prompt=consent`
- after token exchange, discovers or provisions a Cloud Code Assist project
- stores `projectId`
- refresh keeps project ID

### Sitegeist

File:

- `docs/sitegeist/src/oauth/google-gemini-cli.ts`

Redirect URI:

- `http://localhost:8085/oauth2callback`

Behavior:

- same client ID and secret
- same scopes
- same project discovery / onboarding
- same redirect contract
- browser tab watcher replaces callback server

### Our app

File:

- `src/auth/providers/google-gemini-cli.ts`

Redirect URI:

- dynamic same-origin `/auth/callback`

Behavior:

- same auth and token endpoints
- same project discovery logic
- same credential shape with `projectId`
- popup-based callback route

Important divergence:

- same as Anthropic/OpenAI: we replaced the provider-specific localhost redirect URI with one shared same-origin redirect URI

Operational implication:

- if Google’s registered OAuth client is only configured for `http://localhost:8085/oauth2callback`, our current strategy is not equivalent to Sitegeist
- if our flow works in practice, then the registered client must also allow our origin callback or the provider client registration has been changed

---

## GitHub Copilot

### `pi-ai`

File:

- `docs/pi-mono/packages/ai/src/utils/oauth/github-copilot.ts`

Behavior:

- device code flow
- no redirect URI
- obtains GitHub access token
- exchanges that for Copilot token
- stores GitHub access token as the refresh credential

### Sitegeist

File:

- `docs/sitegeist/src/oauth/github-copilot.ts`

Behavior:

- same device-code structure
- opens verification URL in a Chrome tab
- same Copilot token exchange
- same notion that refresh means “use stored GitHub access token to fetch a new Copilot token”

### Our app

File:

- `src/auth/providers/github-copilot.ts`

Behavior:

- same device-code flow
- opens popup instead of Chrome tab
- same refresh semantics

Difference from Sitegeist is minimal here.

This provider is the least divergent because there is no redirect URI problem.

---

## Redirect URI Findings

## Redirect URIs are provider-specific upstream

From `pi-ai` and Sitegeist:

- Anthropic:
  - `http://localhost:53692/callback`
- OpenAI Codex:
  - `http://localhost:1455/auth/callback`
- Google Gemini CLI:
  - `http://localhost:8085/oauth2callback`
- Google Antigravity:
  - `http://localhost:51121/oauth-callback`
- GitHub Copilot:
  - no redirect URI, device-code flow

So:

- `1455` is OpenAI Codex-specific
- redirect ports absolutely differ per provider

## Sitegeist preserves provider-specific redirect URIs

This is an important design choice.

Sitegeist does **not** normalize all providers to one callback route.

Instead it:

- keeps each provider’s upstream redirect URI
- intercepts the browser redirect using extension APIs

That means Sitegeist stays compatible with the provider registration assumptions embedded in `pi-ai`.

## Our app normalizes all callback providers to one redirect URI

Our UI computes:

- `${window.location.origin}/auth/callback`

for all authorization-code providers.

That is simpler, but it means:

- we no longer mirror Sitegeist’s provider contracts
- we rely on our own origin being accepted by each provider’s OAuth client configuration

This is the single biggest auth-specific divergence from Sitegeist.

---

## Data / Credential Shape Differences

## Sitegeist

`docs/sitegeist/src/oauth/types.ts`

- generic `providerId: string`
- generic serialized credential JSON

## Our app

`src/auth/oauth-types.ts`

- strongly typed provider IDs
- typed optional fields:
  - `accountId`
  - `projectId`

This is not a problem. If anything, our local type safety is better.

The meaningful difference is not the credential shape itself, but where resolution logic lives.

---

## Auth Resolution Structure Differences

## Sitegeist structure

Roughly:

- OAuth provider implementations
- central OAuth entrypoint
- central `resolveApiKey()`
- sidepanel storage hookup

This keeps the auth resolution path relatively compact.

## Our structure

Split across:

- `src/auth/auth-service.ts`
- `src/auth/resolve-api-key.ts`
- `src/auth/popup-flow.ts`
- `src/auth/oauth-utils.ts`
- `src/auth/providers/*.ts`
- `src/components/provider-settings.tsx`
- `src/routes/auth.callback.tsx`

What this means:

- behavior is more distributed
- it is harder to see the whole auth lifecycle at once
- provider-specific login and runtime resolution are separated more than in Sitegeist

This is similar to the pre-refactor streaming situation in spirit:

- we did not necessarily break the feature by doing this
- but we created a more app-specific control plane than Sitegeist has

---

## Specific Behavioral Differences Worth Calling Out

## 1. Single shared redirect URI vs provider-specific redirect URIs

This is the most important difference.

Why it matters:

- OAuth clients are usually registered with exact allowed redirect URIs
- Sitegeist and `pi-ai` strongly imply the provider registrations are built around those localhost callback URLs

## 2. Anthropic proxy handling differs for good reason

Sitegeist:

- extension-specific handling

Our app:

- explicit proxy support during token exchange and refresh

This divergence is justified by the environment.

## 3. `originator` parameter differs for OpenAI Codex

Sitegeist:

- `originator=sitegeist`

`pi-ai` CLI:

- `originator=pi`

Our app:

- also uses `originator=sitegeist`

This suggests our OpenAI flow was directly adapted from Sitegeist, not from raw `pi-ai`.

## 4. We do not preserve manual fallback behavior from `pi-ai`

In upstream CLI OAuth flows:

- local callback handling can race with manual pasted redirect input
- there are stronger recovery paths if callback capture fails

Sitegeist:

- does not use the same manual-input model because the extension can watch redirect tabs

Our app:

- also lacks that CLI fallback
- relies entirely on popup + callback route success

This is probably acceptable for a web app, but it is still a behavioral reduction from upstream `pi-ai`.

---

## What Seems Intentional vs What Seems Risky

## Intentional / justified differences

- Using a popup callback route instead of Chrome tab watchers
  - necessary because we are not a browser extension
- Explicit proxy support for Anthropic token exchange and refresh
  - necessary because we do not have extension-level CORS privileges
- Keeping Copilot as device flow
  - aligns well with Sitegeist and upstream

## Risky / likely too divergent differences

- One shared redirect URI for all authorization-code providers
  - this is the most likely place where we diverged too far from Sitegeist
- More distributed auth resolution responsibilities
  - not broken, but harder to reason about and easier to drift

---

## Recommendations

## 1. Make redirect URI strategy explicit and provider-aware

Even if we stay with a same-origin callback page, we should stop pretending redirect URIs are uniform.

Recommended next step:

- introduce provider-specific auth config metadata
- document the expected redirect URI per provider
- decide provider-by-provider whether we are:
  - preserving the Sitegeist/`pi-ai` localhost redirect URI contract, or
  - intentionally using a web-app callback URI instead

At minimum, this should be encoded in one place rather than inferred from UI code.

## 2. Pull auth resolution closer to Sitegeist’s centralized shape

Recommended direction:

- keep provider implementations in `src/auth/providers/*`
- consolidate orchestration into one module that owns:
  - `oauthLogin`
  - `oauthRefresh`
  - `resolveStoredApiKey`
  - `resolveProviderAuth`

This would reduce the current split between `auth-service.ts` and `resolve-api-key.ts`.

## 3. Preserve provider-specific comments and rationale

For each provider, explicitly document:

- redirect URI
- whether token exchange needs proxying
- whether refresh needs proxying
- whether the provider uses:
  - authorization code + PKCE
  - device code
- any provider-specific stored fields

The current code mostly encodes this in logic, not in one readable contract.

## 4. Re-evaluate whether same-origin callback is actually valid for each provider

This is the highest-value follow-up investigation.

Questions to verify for each provider:

- Is our app origin registered as an allowed redirect URI?
- If yes, where is that documented?
- If no, are we only “working locally” due to some accidental condition?

This matters most for:

- Anthropic
- OpenAI Codex
- Google Gemini CLI

---

## Bottom Line

If the question is:

> Is auth resolution another place where we took a more custom path than Sitegeist, similar to what happened with streaming?

The answer is:

- Yes, but not as extremely as streaming.

The clearest divergence is not token refresh logic or provider APIs.
It is redirect handling:

- Sitegeist keeps provider-specific localhost redirect URIs and adapts callback capture to the extension environment.
- We replaced that with one same-origin callback route for all authorization-code providers.

That is a real architectural difference, and it is the first thing I would revisit if we want auth to be “much closer” to Sitegeist.
