import { useLiveQuery } from "dexie-react-hooks"
import { loadSession } from "@/sessions/session-service"

export function useSessionData(sessionId: string | undefined) {
  return useLiveQuery(async () => {
    if (!sessionId) {
      return undefined
    }

    return await loadSession(sessionId)
  }, [sessionId])
}
