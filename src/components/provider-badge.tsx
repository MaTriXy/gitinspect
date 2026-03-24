import { useLiveQuery } from "dexie-react-hooks"
import { getProviderKey } from "@/db/schema"
import { getProviderGroupMetadata } from "@/models/catalog"
import { PROVIDER_METADATA } from "@/models/provider-metadata"
import type { ProviderGroupId, ProviderId } from "@/types/models"
import { Badge } from "@/components/ui/badge"

export function ProviderBadge(props: {
  provider: ProviderId
  providerGroup?: ProviderGroupId
}) {
  const provider = props.provider
  const providerGroup = props.providerGroup ?? provider
  const record = useLiveQuery(async () => await getProviderKey(provider), [provider])
  const metadata = PROVIDER_METADATA[provider]
  const groupMetadata = getProviderGroupMetadata(providerGroup)
  const label = record?.value
    ? record.value.startsWith("{")
      ? "subscription"
      : "api key"
    : "not connected"

  return (
    <Badge className={`rounded-none border px-2 py-1 ${metadata.accentClassName}`} variant="outline">
      {groupMetadata.label} · {label}
    </Badge>
  )
}
