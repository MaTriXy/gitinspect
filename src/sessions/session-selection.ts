import { setSetting } from "@/db/schema"
import type { SessionData } from "@/types/storage"

export async function persistLastUsedSessionSettings(
  session: Pick<
    SessionData,
    "model" | "provider" | "providerGroup"
  >
): Promise<void> {
  await Promise.all([
    setSetting("last-used-model", session.model),
    setSetting("last-used-provider", session.provider),
    setSetting(
      "last-used-provider-group",
      session.providerGroup ?? session.provider
    ),
  ])
}
