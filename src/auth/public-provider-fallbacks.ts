import type { ProviderGroupId } from "@/types/models"

const OPENCODE_FREE_PUBLIC_API_KEY =
  "sk-thgNKT2uEk6opeqnpmXaqsiDQQbxO0tuKQ1tbBEjYqtRM9Yy03EmLdFkoupwBkau"

export function getPublicApiKeyForProviderGroup(
  providerGroup?: ProviderGroupId
): string | undefined {
  if (providerGroup === "opencode-free") {
    return OPENCODE_FREE_PUBLIC_API_KEY
  }

  return undefined
}
