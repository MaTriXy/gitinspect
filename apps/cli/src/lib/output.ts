import type { OAuthCredentials } from "./oauth-types.js";

export function encodeCredentialsBase64(credentials: OAuthCredentials): string {
  return Buffer.from(JSON.stringify(credentials), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function formatCredentialsJson(credentials: OAuthCredentials): string {
  return JSON.stringify(credentials, null, 2);
}
