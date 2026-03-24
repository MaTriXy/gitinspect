import { SessionRuntimeRegistry } from "@/agent/session-runtime-registry"

const registry = new SessionRuntimeRegistry()

export const connectClient = registry.connectClient.bind(registry)
export const disconnectClient = registry.disconnectClient.bind(registry)
export const observeSession = registry.observeSession.bind(registry)
export const unobserveSession = registry.unobserveSession.bind(registry)
export const hydrateSession = registry.hydrateSession.bind(registry)
export const getSessionSnapshot = registry.getSessionSnapshot.bind(registry)
export const getRuntimeState = registry.getRuntimeState.bind(registry)
export const send = registry.send.bind(registry)
export const abort = registry.abort.bind(registry)
export const setModelSelection = registry.setModelSelection.bind(registry)
export const setRepoSource = registry.setRepoSource.bind(registry)
