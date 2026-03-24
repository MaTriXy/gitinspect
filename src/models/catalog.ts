// App-facing catalog helpers layered on top of the vendored pi-ai registry.
// The app no longer carries its own model snapshot; defaults are derived from the
// first model exposed by each supported provider.
import {
  getPiAiModel,
  getPiAiModels,
  getPiAiProviders,
} from "@/models/pi-ai-models"
import {
  getCanonicalProvider,
  getDefaultProviderGroup,
  getProviderGroupMetadata,
  getProviderGroups as getAtlasProviderGroups,
  isProviderGroupId,
} from "@/models/provider-atlas"
import type {
  ModelDefinition,
  ProviderGroupId,
  ProviderId,
  Usage,
} from "@/types/models"

const SUPPORTED_PROVIDERS = getPiAiProviders()
export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-6",
  "github-copilot": "gpt-4o",
  "google-gemini-cli": "gemini-2.5-pro",
  opencode: "gpt-5.1-codex-mini",
  "openai-codex": "gpt-5.1-codex-mini",
}
const DEFAULT_GROUP_MODELS: Partial<Record<ProviderGroupId, string>> = {
  "opencode-free": "gpt-5-nano",
}

export function getProviders(): ProviderId[] {
  return SUPPORTED_PROVIDERS
}

export function getProviderGroups(): ProviderGroupId[] {
  return getAtlasProviderGroups().filter((providerGroup) => {
    const provider = getCanonicalProvider(providerGroup)
    return SUPPORTED_PROVIDERS.includes(provider)
  })
}

export function getModels(provider: ProviderId): ModelDefinition[] {
  return getPiAiModels(provider)
}

export function getModel(provider: ProviderId, modelId: string): ModelDefinition {
  return getPiAiModel(provider, modelId) ?? getDefaultModel(provider)
}

export function isFreeModel(model: ModelDefinition): boolean {
  if (model.free === true) {
    return true
  }

  const zeroCost =
    model.cost.input === 0 &&
    model.cost.output === 0 &&
    model.cost.cacheRead === 0 &&
    model.cost.cacheWrite === 0

  const freeName =
    model.id.toLowerCase().includes("free") ||
    model.name.toLowerCase().includes("free")

  return zeroCost || freeName
}

export function getModelsForGroup(providerGroup: ProviderGroupId): ModelDefinition[] {
  const provider = getCanonicalProvider(providerGroup)
  const models = getModels(provider)

  if (providerGroup === "opencode-free") {
    return models.filter(isFreeModel)
  }

  return models
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

  const firstModel = getModelsForGroup(providerGroup)[0]

  if (!firstModel) {
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
  const defaultModel = getPiAiModel(provider, DEFAULT_MODELS[provider])

  if (!defaultModel) {
    throw new Error(`Missing default model for provider: ${provider}`)
  }

  return defaultModel
}

export function hasModel(provider: ProviderId, modelId: string): boolean {
  return Boolean(getPiAiModel(provider, modelId))
}

export function getPreferredProvider(
  providersWithAuth: ProviderId[]
): ProviderId {
  return providersWithAuth[0] ?? "openai-codex"
}

export function getPreferredProviderGroup(
  providersWithAuth: ProviderId[]
): ProviderGroupId {
  return getDefaultProviderGroup(getPreferredProvider(providersWithAuth))
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
