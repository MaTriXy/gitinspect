/**
 * Single source for provider groups, UI labels, and Sitegeist-style API-key visibility.
 * Mirrors docs/sitegeist/src/dialogs/ApiKeysOAuthTab.ts for hidden providers, with
 * gitinspect overrides so `opencode` and `opencode-go` stay visible.
 */
import { getProviders as getRegistryProviders } from "@mariozechner/pi-ai"
import type {
  KnownProvider,
  ProviderGroupDefinition,
  ProviderGroupId,
  ProviderId,
} from "@/types/models"

/** Same denylist as Sitegeist for API-key rows (OAuth-only or not for browser API keys). */
export const SITEGEIST_HIDDEN_API_KEY_PROVIDERS = new Set<KnownProvider>([
  "amazon-bedrock",
  "azure-openai-responses",
  "github-copilot",
  "google-antigravity",
  "google-vertex",
  "openai-codex",
  "google-gemini-cli",
  "opencode",
  "opencode-go",
  "kimi-coding",
])

/** Always show these in API key settings even though Sitegeist hides them. */
export const GITINSPECT_FORCE_SHOW_API_KEY_PROVIDERS = new Set<KnownProvider>([
  "opencode",
  "opencode-go",
])

/** Subscription OAuth providers (explicit order). */
export const SUBSCRIPTION_OAUTH_PROVIDER_ORDER: KnownProvider[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
]

/** OAuth-only: no API-key row (same as previous OAUTH_ONLY_PROVIDERS). */
export const OAUTH_ONLY_PROVIDERS = new Set<KnownProvider>([
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
])

/**
 * API-key settings rows: full pi-ai registry minus Sitegeist hidden set, plus forced
 * OpenCode providers.
 */
export function getApiKeyProvidersForSettings(): KnownProvider[] {
  const fromRegistry = getRegistryProviders() as KnownProvider[]
  return fromRegistry.filter((provider) => {
    if (GITINSPECT_FORCE_SHOW_API_KEY_PROVIDERS.has(provider)) {
      return true
    }
    return !SITEGEIST_HIDDEN_API_KEY_PROVIDERS.has(provider)
  })
}

/**
 * Providers that participate in model selection / runtime (union of API-key list and
 * subscription-only backends).
 */
export function getRuntimeSupportedProviders(): KnownProvider[] {
  const apiKeys = getApiKeyProvidersForSettings()
  const merged = new Set<KnownProvider>([
    ...apiKeys,
    ...SUBSCRIPTION_OAUTH_PROVIDER_ORDER,
  ])
  return [...merged].sort((a, b) => a.localeCompare(b))
}

/** Curated labels for common groups; others get a synthetic definition at runtime. */
export const PROVIDER_GROUPS: Partial<
  Record<ProviderGroupId, ProviderGroupDefinition>
> = {
  anthropic: {
    canonicalProvider: "anthropic",
    description: "Claude API and Claude subscription OAuth",
    id: "anthropic",
    label: "Anthropic",
  },
  "github-copilot": {
    canonicalProvider: "github-copilot",
    description: "GitHub Copilot subscription and API-compatible access",
    id: "github-copilot",
    label: "Copilot",
  },
  "google-gemini-cli": {
    canonicalProvider: "google-gemini-cli",
    description: "Cloud Code Assist OAuth for Gemini models",
    id: "google-gemini-cli",
    label: "Gemini",
  },
  openai: {
    canonicalProvider: "openai",
    description: "OpenAI API key for GPT and o-series models",
    id: "openai",
    label: "OpenAI",
  },
  opencode: {
    canonicalProvider: "opencode",
    description: "OpenCode API key for the full OpenCode catalog",
    id: "opencode",
    label: "OpenCode",
  },
  "opencode-go": {
    canonicalProvider: "opencode-go",
    description: "OpenCode Go API key for the Go-line catalog",
    id: "opencode-go",
    label: "OpenCode Go",
  },
  "opencode-free": {
    canonicalProvider: "opencode",
    description: "OpenCode free-tier models only",
    id: "opencode-free",
    label: "OpenCode Free",
  },
  "openai-codex": {
    canonicalProvider: "openai-codex",
    description: "ChatGPT subscription OAuth and Codex-compatible responses",
    id: "openai-codex",
    label: "OpenAI Codex",
  },
}

/** Preferred model-selector group order; remaining supported providers append sorted. */
const PROVIDER_GROUP_BASE_ORDER: readonly ProviderGroupId[] = [
  "anthropic",
  "github-copilot",
  "google-gemini-cli",
  "openai",
  "openai-codex",
  "opencode",
  "opencode-go",
  "opencode-free",
] as const

function prettyProviderLabel(provider: string): string {
  return provider
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function getAtlasProviderGroups(): ProviderGroupId[] {
  const supported = new Set(getRuntimeSupportedProviders())
  const hasOpencode = supported.has("opencode")
  const ordered: ProviderGroupId[] = []

  for (const id of PROVIDER_GROUP_BASE_ORDER) {
    if (id === "opencode-free") {
      if (hasOpencode) {
        ordered.push("opencode-free")
      }
      continue
    }
    if (supported.has(id)) {
      ordered.push(id)
    }
  }

  const rest = [...supported]
    .filter((id) => !ordered.includes(id))
    .sort((a, b) => a.localeCompare(b))
  ordered.push(...rest)

  return ordered
}

export function isProviderGroupId(value: string): value is ProviderGroupId {
  if (value === "opencode-free") {
    return true
  }
  return (getRegistryProviders() as string[]).includes(value)
}

export function getProviderGroupMetadata(
  providerGroup: ProviderGroupId
): ProviderGroupDefinition {
  const known = PROVIDER_GROUPS[providerGroup]
  if (known) {
    return known
  }

  return {
    canonicalProvider: providerGroup as ProviderId,
    description: "",
    id: providerGroup,
    label: prettyProviderLabel(providerGroup),
  }
}

export function getCanonicalProvider(
  providerGroup: ProviderGroupId
): ProviderId {
  if (providerGroup === "opencode-free") {
    return "opencode"
  }
  return getProviderGroupMetadata(providerGroup).canonicalProvider
}

export function getDefaultProviderGroup(provider: ProviderId): ProviderGroupId {
  const meta = PROVIDER_GROUPS[provider as ProviderGroupId]
  if (meta) {
    return meta.id
  }
  return provider as ProviderGroupId
}

/**
 * Common providers first (same order as Sitegeist-style expectations), then the rest
 * A–Z by display label.
 */
const API_KEY_SETTINGS_PINNED_ORDER: KnownProvider[] = [
  "anthropic",
  "openai",
  "opencode",
  "opencode-go",
  "google",
  "groq",
  "mistral",
]

/**
 * API key rows for settings: OAuth-only providers removed, pinned providers first,
 * remaining providers sorted alphabetically by label.
 */
export function getSortedApiKeyProvidersForSettings(): KnownProvider[] {
  const list = getApiKeyProvidersForSettings().filter(
    (provider) => !OAUTH_ONLY_PROVIDERS.has(provider)
  )
  const pinnedSet = new Set(API_KEY_SETTINGS_PINNED_ORDER)
  const pinned = API_KEY_SETTINGS_PINNED_ORDER.filter((id) => list.includes(id))
  const rest = list
    .filter((id) => !pinnedSet.has(id))
    .sort((a, b) => {
      const labelA = getProviderGroupMetadata(a as ProviderGroupId).label
      const labelB = getProviderGroupMetadata(b as ProviderGroupId).label
      return labelA.localeCompare(labelB, undefined, { sensitivity: "base" })
    })
  return [...pinned, ...rest]
}
