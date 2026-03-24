import { proxy } from "comlink"
import {
  createIdleRuntimeSnapshot,
  type RuntimeClientSink,
  type RuntimeSessionSnapshot,
  type RuntimeStateSnapshot,
  type RuntimeWorkerApi,
} from "@/agent/runtime-worker-types"
import { createId } from "@/lib/ids"
import type { ProviderGroupId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

function createEmptyRuntimeState(): RuntimeStateSnapshot {
  return {
    connectedClientIds: [],
    runningSessionIds: [],
    updatedAt: Date.now(),
  }
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

function areAssistantDraftsEqual(
  left: RuntimeSessionSnapshot["draftAssistantMessage"],
  right: RuntimeSessionSnapshot["draftAssistantMessage"]
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return (
    left.id === right.id &&
    left.timestamp === right.timestamp &&
    JSON.stringify(left.content) === JSON.stringify(right.content)
  )
}

function areRuntimeStatesEqual(
  left: RuntimeStateSnapshot,
  right: RuntimeStateSnapshot
): boolean {
  return (
    areStringArraysEqual(left.connectedClientIds, right.connectedClientIds) &&
    areStringArraysEqual(left.runningSessionIds, right.runningSessionIds)
  )
}

function areSessionSnapshotsEqual(
  left: RuntimeSessionSnapshot,
  right: RuntimeSessionSnapshot
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.isStreaming === right.isStreaming &&
    left.error === right.error &&
    left.lastEventAt === right.lastEventAt &&
    areAssistantDraftsEqual(left.draftAssistantMessage, right.draftAssistantMessage)
  )
}

function createWorkerApi(): RuntimeWorkerApi {
  if (typeof window === "undefined" || typeof SharedWorker === "undefined") {
    throw new Error("SharedWorker runtime is only available in Chromium browsers")
  }

  return new ComlinkSharedWorker<typeof import("./runtime-shared-worker")>(
    new URL("./runtime-shared-worker", import.meta.url),
    {
      name: "gitoverflow-runtime",
      type: "module",
    }
  )
}

export class RuntimeClientStore {
  private api?: RuntimeWorkerApi
  private readonly clientId = createId()
  private connectError?: Error
  private connectPromise?: Promise<void>
  private readonly runtimeListeners = new Set<() => void>()
  private readonly sessionListeners = new Map<string, Set<() => void>>()
  private readonly observedSessionIds = new Set<string>()
  private runtimeState: RuntimeStateSnapshot = createEmptyRuntimeState()
  private readonly sessionSnapshots = new Map<string, RuntimeSessionSnapshot>()

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => {
        if (!this.api) {
          return
        }

        void this.api.disconnectClient(this.clientId)
      })
    }
  }

  subscribeRuntime(listener: () => void): () => void {
    this.runtimeListeners.add(listener)

    return () => {
      this.runtimeListeners.delete(listener)
    }
  }

  subscribeSession(sessionId: string, listener: () => void): () => void {
    const listeners = this.sessionListeners.get(sessionId) ?? new Set<() => void>()
    listeners.add(listener)
    this.sessionListeners.set(sessionId, listeners)

    return () => {
      const current = this.sessionListeners.get(sessionId)

      if (!current) {
        return
      }

      current.delete(listener)

      if (current.size === 0) {
        this.sessionListeners.delete(sessionId)
      }
    }
  }

  getRuntimeState(): RuntimeStateSnapshot {
    return this.runtimeState
  }

  getSessionSnapshot(sessionId: string): RuntimeSessionSnapshot {
    const existing = this.sessionSnapshots.get(sessionId)

    if (existing) {
      return existing
    }

    const idle = createIdleRuntimeSnapshot(sessionId)
    this.sessionSnapshots.set(sessionId, idle)
    return idle
  }

  async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      return await this.connectPromise
    }

    if (this.connectError) {
      throw this.connectError
    }

    this.connectPromise = (async () => {
      this.api = createWorkerApi()

      const sink: RuntimeClientSink = proxy({
        onRuntimeState: (snapshot) => {
          this.setRuntimeState(snapshot)
        },
        onSessionSnapshot: (snapshot) => {
          this.setSessionSnapshot(snapshot.sessionId, snapshot)
        },
      })

      await this.api.connectClient(this.clientId, sink)
      this.setRuntimeState(await this.api.getRuntimeState())

      for (const sessionId of this.observedSessionIds) {
        await this.api.observeSession(this.clientId, sessionId)
        const snapshot = await this.api.getSessionSnapshot(sessionId)
        this.setSessionSnapshot(
          sessionId,
          snapshot ?? createIdleRuntimeSnapshot(sessionId)
        )
      }
    })().catch((error) => {
      this.connectError =
        error instanceof Error ? error : new Error(String(error))
      this.connectPromise = undefined
      throw error
    })

    return await this.connectPromise
  }

  async observeSession(sessionId: string): Promise<void> {
    this.observedSessionIds.add(sessionId)
    await this.ensureConnected()
    await this.api?.observeSession(this.clientId, sessionId)
    const snapshot = await this.api?.getSessionSnapshot(sessionId)
    this.setSessionSnapshot(
      sessionId,
      snapshot ?? createIdleRuntimeSnapshot(sessionId)
    )
  }

  async unobserveSession(sessionId: string): Promise<void> {
    this.observedSessionIds.delete(sessionId)

    if (!this.api) {
      return
    }

    await this.api.unobserveSession(this.clientId, sessionId)
  }

  async hydrateSession(session: SessionData): Promise<void> {
    this.observedSessionIds.add(session.id)
    await this.ensureConnected()
    await this.api?.hydrateSession(this.clientId, session.id, session)
    const snapshot = await this.api?.getSessionSnapshot(session.id)
    this.setSessionSnapshot(
      session.id,
      snapshot ?? createIdleRuntimeSnapshot(session.id)
    )
  }

  async send(sessionId: string, content: string): Promise<void> {
    await this.ensureConnected()
    const result = await this.api?.send(sessionId, content)

    if (!result?.ok) {
      throw new Error(result?.error ?? "missing-session")
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.api?.abort(sessionId)
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    await this.ensureConnected()
    const result = await this.api?.setModelSelection(
      sessionId,
      providerGroup,
      modelId
    )

    if (!result?.ok) {
      throw new Error(result?.error ?? "missing-session")
    }
  }

  async setRepoSource(sessionId: string, repoSource?: RepoSource): Promise<void> {
    await this.ensureConnected()
    const result = await this.api?.setRepoSource(sessionId, repoSource)

    if (!result?.ok) {
      throw new Error(result?.error ?? "missing-session")
    }
  }

  private setRuntimeState(snapshot: RuntimeStateSnapshot): void {
    if (areRuntimeStatesEqual(this.runtimeState, snapshot)) {
      return
    }

    this.runtimeState = snapshot
    this.emitRuntime()
  }

  private setSessionSnapshot(
    sessionId: string,
    snapshot: RuntimeSessionSnapshot
  ): void {
    const current = this.sessionSnapshots.get(sessionId)

    if (current && areSessionSnapshotsEqual(current, snapshot)) {
      return
    }

    this.sessionSnapshots.set(sessionId, snapshot)
    this.emitSession(sessionId)
  }

  private emitRuntime(): void {
    for (const listener of this.runtimeListeners) {
      listener()
    }
  }

  private emitSession(sessionId: string): void {
    for (const listener of this.sessionListeners.get(sessionId) ?? []) {
      listener()
    }
  }
}

export const runtimeClientStore = new RuntimeClientStore()
