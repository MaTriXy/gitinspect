import { useLiveQuery } from "dexie-react-hooks"
import { getSetting } from "@/db/schema"

export function useActiveSessionId() {
  return useLiveQuery(async () => {
    const value = await getSetting("active-session-id")
    return typeof value === "string" ? value : undefined
  }, [])
}
