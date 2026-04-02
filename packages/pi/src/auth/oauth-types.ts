export interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  projectId?: string;
  providerId: "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";
  refresh: string;
}

export function isOAuthCredentials(value: string): boolean {
  return value.startsWith("{");
}

export function parseOAuthCredentials(value: string): OAuthCredentials {
  return JSON.parse(value) as OAuthCredentials;
}

export function serializeOAuthCredentials(credentials: OAuthCredentials): string {
  return JSON.stringify(credentials);
}
