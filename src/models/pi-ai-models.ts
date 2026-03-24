// Thin wrapper around the shared pi-ai registry so the app reads the live model catalog
// from the upstream source of truth instead of maintaining a copied snapshot.
import {
  getModel as getRegistryModel,
  getModels as getRegistryModels,
  getProviders as getRegistryProviders,
} from "@mariozechner/pi-ai"
import type { ModelDefinition, ProviderId } from "@/types/models"

const SUPPORTED_PROVIDER_ORDER = [
  "anthropic",
  "github-copilot",
  "google-gemini-cli",
  "opencode",
  "openai-codex",
] as const satisfies readonly ProviderId[]

function hasProvider(provider: ProviderId): boolean {
  return getRegistryProviders().includes(provider)
}

export function getPiAiProviders(): ProviderId[] {
  return SUPPORTED_PROVIDER_ORDER.filter((provider) => hasProvider(provider))
}

export function getPiAiModels(provider: ProviderId): ModelDefinition[] {
  return getRegistryModels(provider) as ModelDefinition[]
}

export function getPiAiModel(
  provider: ProviderId,
  modelId: string
): ModelDefinition | undefined {
  return getRegistryModel(provider as never, modelId as never) as
    | ModelDefinition
    | undefined
}
