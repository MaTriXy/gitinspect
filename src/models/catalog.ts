// App-facing catalog helpers layered on the shared pi-ai registry.
import {
  getModel as getRegistryModel,
  getModels as getRegistryModels,
} from "@mariozechner/pi-ai"
import type {
  ModelDefinition,
  ProviderGroupId,
  ProviderId,
  Usage,
} from "@/types/models"
import {
  isOAuthCredentials,
  parseOAuthCredentials,
} from "@/auth/oauth-types"
import {
  getAtlasProviderGroups,
  getCanonicalProvider,
  getDefaultProviderGroup,
  getProviderGroupMetadata,
  getRuntimeSupportedProviders,
  isProviderGroupId,
} from "@/models/provider-registry"

const SUPPORTED_PROVIDERS = getRuntimeSupportedProviders()

/** Preferred default model ids when registry still exposes them; otherwise first model is used. */
export const DEFAULT_MODELS: Partial<Record<ProviderId, string>> = {
  anthropic: "claude-sonnet-4-6",
  "github-copilot": "gpt-4o",
  "google-gemini-cli": "gemini-2.5-pro",
  openai: "gpt-4.1",
  opencode: "gpt-5.1-codex-mini",
  "opencode-go": "glm-5",
  "openai-codex": "gpt-5.1-codex-mini",
}

const DEFAULT_GROUP_MODELS: Partial<Record<ProviderGroupId, string>> = {
  "opencode-free": "mimo-v2-omni-free",
}

export function getProviders(): Array<ProviderId> {
  return SUPPORTED_PROVIDERS
}

export function getPiAiModels(provider: ProviderId): ModelDefinition[] {
  return getRegistryModels(provider) as ModelDefinition[]
}

export function getPiAiModel(
  provider: ProviderId,
  modelId: string
): ModelDefinition | undefined {
  return getRegistryModel(
    provider as never,
    modelId as never
  ) as ModelDefinition | undefined
}

export function getProviderGroups(): Array<ProviderGroupId> {
  return getAtlasProviderGroups().filter((providerGroup) => {
    const provider = getCanonicalProvider(providerGroup)
    return SUPPORTED_PROVIDERS.includes(provider)
  })
}

export function hasStoredProviderCredential(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function isOpenAiCodexOAuthConnected(value: string): boolean {
  if (!isOAuthCredentials(value)) {
    return false
  }

  try {
    const credentials = parseOAuthCredentials(value)
    return (
      credentials.providerId === "openai-codex" &&
      Boolean(credentials.access?.trim()) &&
      Boolean(credentials.refresh?.trim())
    )
  } catch {
    return false
  }
}

function isProviderRecordConnected(
  record: { provider: ProviderId; value: string }
): boolean {
  if (record.provider === "openai-codex") {
    return isOpenAiCodexOAuthConnected(record.value)
  }

  return hasStoredProviderCredential(record.value)
}

export function getConnectedProviders(
  providerRecords: Array<{ provider: ProviderId; value: string }>
): Array<ProviderId> {
  const connectedProviders = new Set(
    providerRecords
      .filter((record) => isProviderRecordConnected(record))
      .map((record) => record.provider)
  )

  return getProviderGroups()
    .filter((providerGroup) => providerGroup !== "opencode-free")
    .map((providerGroup) => getCanonicalProvider(providerGroup))
    .filter((provider, index, providers) => {
      return connectedProviders.has(provider) && providers.indexOf(provider) === index
    })
}

export function getVisibleProviderGroups(
  connectedProviders: Array<ProviderId>
): Array<ProviderGroupId> {
  const connectedProviderSet = new Set(connectedProviders)
  const connectedProviderGroups = getProviderGroups().filter((providerGroup) => {
    return (
      providerGroup !== "opencode-free" &&
      connectedProviderSet.has(getCanonicalProvider(providerGroup))
    )
  })

  return ["opencode-free", ...connectedProviderGroups]
}

export function getModels(provider: ProviderId): Array<ModelDefinition> {
  return getPiAiModels(provider)
}

export function getModel(provider: ProviderId, modelId: string): ModelDefinition {
  return getPiAiModel(provider, modelId) ?? getDefaultModel(provider)
}

export function isFreeModel(model: ModelDefinition): boolean {
  if (model.free === true) {
    return true
  }

  const freeName =
    model.id.toLowerCase().includes("free") ||
    model.name.toLowerCase().includes("free")

  return freeName
}

/** Newer / higher-version ids first (display order only). */
function sortModelsForDisplay(models: Array<ModelDefinition>): Array<ModelDefinition> {
  return [...models].sort((left, right) =>
    right.id.localeCompare(left.id, undefined, { numeric: true, sensitivity: "base" })
  )
}

export function getModelsForGroup(
  providerGroup: ProviderGroupId
): Array<ModelDefinition> {
  const provider = getCanonicalProvider(providerGroup)
  const models = getModels(provider)

  if (providerGroup === "opencode-free") {
    return sortModelsForDisplay(models.filter(isFreeModel))
  }

  return sortModelsForDisplay(models)
}

export function getDefaultModelForGroup(
  providerGroup: ProviderGroupId
): ModelDefinition {
  const preferredModelId = DEFAULT_GROUP_MODELS[providerGroup]

  if (preferredModelId) {
    const provider = getCanonicalProvider(providerGroup)
    const preferredModel = getPiAiModel(provider, preferredModelId)

    if (preferredModel && hasModelForGroup(providerGroup, preferredModel.id)) {
      return preferredModel
    }
  }

  const firstModel = getModelsForGroup(providerGroup).at(0)

  if (firstModel === undefined) {
    throw new Error(`Missing default model for provider group: ${providerGroup}`)
  }

  return firstModel
}

export function hasModelForGroup(
  providerGroup: ProviderGroupId,
  modelId: string
): boolean {
  return getModelsForGroup(providerGroup).some((model) => model.id === modelId)
}

export function getModelForGroup(
  providerGroup: ProviderGroupId,
  modelId: string
): ModelDefinition {
  return (
    getModelsForGroup(providerGroup).find((model) => model.id === modelId) ??
    getDefaultModelForGroup(providerGroup)
  )
}

export function getDefaultModel(provider: ProviderId): ModelDefinition {
  const preferredId = DEFAULT_MODELS[provider]
  if (preferredId) {
    const defaultModel = getPiAiModel(provider, preferredId)
    if (defaultModel) {
      return defaultModel
    }
  }

  const first = getPiAiModels(provider).at(0)
  if (!first) {
    throw new Error(`Missing default model for provider: ${provider}`)
  }

  return first
}

export function hasModel(provider: ProviderId, modelId: string): boolean {
  return Boolean(getPiAiModel(provider, modelId))
}

export function getPreferredProviderGroup(
  providersWithAuth: Array<ProviderId>
): ProviderGroupId {
  return getVisibleProviderGroups(providersWithAuth)[0] ?? "opencode-free"
}

export {
  getCanonicalProvider,
  getDefaultProviderGroup,
  getProviderGroupMetadata,
  isProviderGroupId,
}

export function calculateCost(model: ModelDefinition, usage: Usage): Usage["cost"] {
  const input = (model.cost.input / 1_000_000) * usage.input
  const output = (model.cost.output / 1_000_000) * usage.output
  const cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead
  const cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite

  return {
    cacheRead,
    cacheWrite,
    input,
    output,
    total: input + output + cacheRead + cacheWrite,
  }
}
