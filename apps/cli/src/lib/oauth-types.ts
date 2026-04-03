export type OAuthProviderId = "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";

export interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  projectId?: string;
  providerId: OAuthProviderId;
  refresh: string;
}
