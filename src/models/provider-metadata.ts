import type { ProviderId } from "@/types/models"

export interface ProviderMetadata {
  accentClassName: string
  description: string
  label: string
}

export const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
  anthropic: {
    accentClassName: "text-amber-700",
    description: "Claude API and Claude subscription OAuth",
    label: "Anthropic",
  },
  "github-copilot": {
    accentClassName: "text-cyan-700",
    description: "GitHub Copilot subscription and API-compatible access",
    label: "Copilot",
  },
  "google-gemini-cli": {
    accentClassName: "text-emerald-700",
    description: "Cloud Code Assist OAuth for Gemini models",
    label: "Gemini",
  },
  opencode: {
    accentClassName: "text-teal-700",
    description: "OpenCode API key for full and free-tier model access",
    label: "OpenCode",
  },
  "openai-codex": {
    accentClassName: "text-sky-700",
    description: "ChatGPT subscription OAuth and Codex-compatible responses",
    label: "OpenAI Codex",
  },
}
