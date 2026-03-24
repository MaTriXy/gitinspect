import { getIsoNow } from "@/lib/dates"
import {
  deleteProviderKey,
  getProviderKey,
  setProviderKey,
} from "@/db/schema"
import { loginAnthropic, refreshAnthropic } from "@/auth/providers/anthropic"
import {
  loginGitHubCopilot,
  refreshGitHubCopilot,
} from "@/auth/providers/github-copilot"
import {
  loginGeminiCli,
  refreshGeminiCli,
} from "@/auth/providers/google-gemini-cli"
import {
  loginOpenAICodex,
  refreshOpenAICodex,
} from "@/auth/providers/openai-codex"
import {
  serializeOAuthCredentials,
  type OAuthCredentials,
} from "@/auth/oauth-types"
import type { ProxyRequestOptions } from "@/auth/oauth-utils"
import type { ProviderAuthKind, ProviderAuthState } from "@/types/auth"
import type { ProviderId } from "@/types/models"

export type OAuthProviderId =
  | "anthropic"
  | "github-copilot"
  | "google-gemini-cli"
  | "openai-codex"

export const OAUTH_PROVIDERS: Record<OAuthProviderId, { label: string }> = {
  anthropic: { label: "Anthropic (Claude Pro/Max)" },
  "github-copilot": { label: "GitHub Copilot" },
  "google-gemini-cli": { label: "Google Gemini" },
  "openai-codex": { label: "ChatGPT Plus/Pro" },
}

export function isOAuthProvider(provider: string): provider is OAuthProviderId {
  return provider in OAUTH_PROVIDERS
}

export function getOAuthProviderName(provider: OAuthProviderId): string {
  return OAUTH_PROVIDERS[provider].label
}

export async function oauthLogin(
  provider: OAuthProviderId,
  redirectUri: string,
  onDeviceCode?: (info: {
    userCode: string
  verificationUri: string
  }) => void,
  options?: ProxyRequestOptions
): Promise<OAuthCredentials> {
  switch (provider) {
    case "anthropic":
      return await loginAnthropic(redirectUri, options)
    case "github-copilot":
      return await loginGitHubCopilot(onDeviceCode ?? (() => {}))
    case "google-gemini-cli":
      return await loginGeminiCli(redirectUri)
    case "openai-codex":
      return await loginOpenAICodex(redirectUri)
  }
}

export async function oauthRefresh(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions
): Promise<OAuthCredentials> {
  switch (credentials.providerId) {
    case "anthropic":
      return await refreshAnthropic(credentials, options)
    case "github-copilot":
      return await refreshGitHubCopilot(credentials)
    case "google-gemini-cli":
      return await refreshGeminiCli(credentials)
    case "openai-codex":
      return await refreshOpenAICodex(credentials)
  }
}

export async function upsertProviderOAuth(
  provider: ProviderId,
  credentials: OAuthCredentials
): Promise<void> {
  await setProviderKey(provider, serializeOAuthCredentials(credentials))
}

export async function setProviderApiKey(
  provider: ProviderId,
  value: string
): Promise<void> {
  await setProviderKey(provider, value)
}

export async function disconnectProvider(provider: ProviderId): Promise<void> {
  await deleteProviderKey(provider)
}

export async function getProviderAuthState(
  provider: ProviderId
): Promise<ProviderAuthState> {
  const record = await getProviderKey(provider)
  const authKind: ProviderAuthKind =
    !record?.value
      ? "none"
      : record.value.startsWith("{")
        ? "oauth"
        : "api-key"

  return {
    authKind,
    hasValue: Boolean(record?.value),
    provider,
    updatedAt: record?.updatedAt ?? getIsoNow(),
  }
}
