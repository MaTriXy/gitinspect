import { isCancel, select } from "@clack/prompts";
import { LoginCancelledError } from "./errors.js";
import type { OAuthProviderId } from "./oauth-types.js";

export type CliProviderId = OAuthProviderId;

interface ProviderDefinition {
  aliases: readonly string[];
  id: CliProviderId;
  label: string;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    aliases: ["codex", "openai-codex"],
    id: "openai-codex",
    label: "OpenAI Codex",
  },
  {
    aliases: ["anthropic", "claude"],
    id: "anthropic",
    label: "Anthropic",
  },
  {
    aliases: ["gemini", "google-gemini-cli"],
    id: "google-gemini-cli",
    label: "Google Gemini CLI",
  },
  {
    aliases: ["copilot", "github-copilot"],
    id: "github-copilot",
    label: "GitHub Copilot",
  },
] as const;

export function getProviderLabel(providerId: CliProviderId): string {
  const provider = PROVIDERS.find((entry) => entry.id === providerId);
  return provider?.label ?? providerId;
}

export function normalizeProviderAlias(value: string): CliProviderId | undefined {
  const normalized = value.trim().toLowerCase();
  const provider = PROVIDERS.find((entry) => entry.aliases.includes(normalized));
  return provider?.id;
}

export async function promptForProvider(
  selectPrompt: typeof select = select,
): Promise<CliProviderId> {
  const result = await selectPrompt<CliProviderId>({
    message: "Choose an OAuth provider",
    options: PROVIDERS.map((provider) => ({
      hint: provider.id,
      label: provider.label,
      value: provider.id,
    })),
  });

  if (isCancel(result)) {
    throw new LoginCancelledError();
  }

  return result;
}
