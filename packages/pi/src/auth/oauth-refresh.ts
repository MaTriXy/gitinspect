import { refreshAnthropic } from "@gitinspect/pi/auth/providers/anthropic";
import { refreshGitHubCopilot } from "@gitinspect/pi/auth/providers/github-copilot";
import { refreshGeminiCli } from "@gitinspect/pi/auth/providers/google-gemini-cli";
import { refreshOpenAICodex } from "@gitinspect/pi/auth/providers/openai-codex";
import type { OAuthCredentials } from "@gitinspect/pi/auth/oauth-types";
import type { ProxyRequestOptions } from "@gitinspect/pi/auth/oauth-utils";

export async function oauthRefresh(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  switch (credentials.providerId) {
    case "anthropic":
      return await refreshAnthropic(credentials, options);
    case "github-copilot":
      return await refreshGitHubCopilot(credentials);
    case "google-gemini-cli":
      return await refreshGeminiCli(credentials);
    case "openai-codex":
      return await refreshOpenAICodex(credentials);
  }
}
