import { useLiveQuery } from "dexie-react-hooks"
import { db } from "@/db/schema"
import {
  getConnectedProviders,
  getVisibleProviderGroups,
} from "@/models/catalog"

export function useVisibleProviderGroups() {
  const providerKeys = useLiveQuery(() => db.providerKeys.toArray(), []) ?? []

  return getVisibleProviderGroups(getConnectedProviders(providerKeys))
}
