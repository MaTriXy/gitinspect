import * as React from "react"
import { runtimeClientStore } from "@/agent/runtime-client"

export function useRuntimeState() {
  React.useEffect(() => {
    void runtimeClientStore.ensureConnected()
  }, [])

  const subscribe = React.useCallback((onStoreChange: () => void) => {
    return runtimeClientStore.subscribeRuntime(onStoreChange)
  }, [])

  const getSnapshot = React.useCallback(() => {
    return runtimeClientStore.getRuntimeState()
  }, [])

  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  )
}
