import type {
  CanonicalProviderId,
  ProviderGroupDefinition,
  ProviderGroupId,
} from "@/types/models"

export const PROVIDER_GROUPS: Record<ProviderGroupId, ProviderGroupDefinition> = {
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
  opencode: {
    canonicalProvider: "opencode",
    description: "OpenCode API key for the full OpenCode catalog",
    id: "opencode",
    label: "OpenCode",
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

export const PROVIDER_GROUP_ORDER = [
  "anthropic",
  "github-copilot",
  "google-gemini-cli",
  "openai-codex",
  "opencode",
  "opencode-free",
] as const satisfies readonly ProviderGroupId[]

export function getProviderGroups(): ProviderGroupId[] {
  return [...PROVIDER_GROUP_ORDER]
}

export function isProviderGroupId(value: string): value is ProviderGroupId {
  return value in PROVIDER_GROUPS
}

export function getProviderGroupMetadata(
  providerGroup: ProviderGroupId
): ProviderGroupDefinition {
  return PROVIDER_GROUPS[providerGroup]
}

export function getCanonicalProvider(
  providerGroup: ProviderGroupId
): CanonicalProviderId {
  return PROVIDER_GROUPS[providerGroup].canonicalProvider
}

export function getDefaultProviderGroup(
  provider: CanonicalProviderId
): ProviderGroupId {
  return provider
}
