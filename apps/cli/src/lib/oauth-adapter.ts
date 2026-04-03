import {
  loginAnthropic,
  loginGeminiCli,
  loginGitHubCopilot,
  loginOpenAICodex,
  type OAuthCredentials as PiOAuthCredentials,
} from "@mariozechner/pi-ai/oauth";
import type { OAuthCredentials } from "./oauth-types.js";
import type { CliProviderId } from "./providers.js";

export interface CliLoginCallbacks {
  onAuth: (info: { instructions?: string; url: string }) => void;
  onManualCodeInput?: () => Promise<string>;
  onProgress?: (message: string) => void;
  onPrompt: (prompt: {
    allowEmpty?: boolean;
    message: string;
    placeholder?: string;
  }) => Promise<string>;
  signal?: AbortSignal;
}

function normalizeCredentials(
  provider: CliProviderId,
  credentials: PiOAuthCredentials,
): OAuthCredentials {
  const normalized: OAuthCredentials = {
    access: credentials.access,
    expires: credentials.expires,
    providerId: provider,
    refresh: credentials.refresh,
  };

  if (provider === "openai-codex") {
    if (typeof credentials.accountId !== "string" || credentials.accountId.length === 0) {
      throw new Error("OpenAI Codex login did not return accountId");
    }
    normalized.accountId = credentials.accountId;
  }

  if (provider === "google-gemini-cli") {
    if (typeof credentials.projectId !== "string" || credentials.projectId.length === 0) {
      throw new Error("Gemini CLI login did not return projectId");
    }
    normalized.projectId = credentials.projectId;
  }

  return normalized;
}

export async function loginWithProvider(
  provider: CliProviderId,
  callbacks: CliLoginCallbacks,
): Promise<OAuthCredentials> {
  switch (provider) {
    case "anthropic": {
      return normalizeCredentials(
        provider,
        await loginAnthropic({
          onAuth: callbacks.onAuth,
          onManualCodeInput: callbacks.onManualCodeInput,
          onProgress: callbacks.onProgress,
          onPrompt: callbacks.onPrompt,
        }),
      );
    }
    case "github-copilot": {
      return normalizeCredentials(
        provider,
        await loginGitHubCopilot({
          onAuth: (url, instructions) => {
            callbacks.onAuth({ instructions, url });
          },
          onProgress: callbacks.onProgress,
          onPrompt: callbacks.onPrompt,
          signal: callbacks.signal,
        }),
      );
    }
    case "google-gemini-cli": {
      return normalizeCredentials(
        provider,
        await loginGeminiCli(callbacks.onAuth, callbacks.onProgress, callbacks.onManualCodeInput),
      );
    }
    case "openai-codex": {
      return normalizeCredentials(
        provider,
        await loginOpenAICodex({
          onAuth: callbacks.onAuth,
          onManualCodeInput: callbacks.onManualCodeInput,
          onProgress: callbacks.onProgress,
          onPrompt: callbacks.onPrompt,
          originator: "gitinspect",
        }),
      );
    }
  }
}
