import { AgentHost, type AgentHostSnapshot } from "@/agent/agent-host"
import {
  createIdleRuntimeSnapshot,
  type RuntimeClientSink,
  type RuntimeMutationResult,
  type RuntimeSessionSnapshot,
  type RuntimeStateSnapshot,
} from "@/agent/runtime-worker-types"
import type { AssistantMessage } from "@/types/chat"
import type { ProviderGroupId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

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

function areRuntimeStatesEqual(
  left: RuntimeStateSnapshot,
  right: RuntimeStateSnapshot
): boolean {
  return (
    areStringArraysEqual(left.connectedClientIds, right.connectedClientIds) &&
    areStringArraysEqual(left.runningSessionIds, right.runningSessionIds)
  )
}

function getDraftAssistantMessage(
  snapshot: AgentHostSnapshot
): AssistantMessage | undefined {
  if (!snapshot.isStreaming) {
    return undefined
  }

  if (snapshot.streamMessage) {
    return snapshot.streamMessage
  }

  const lastMessage = snapshot.session.messages.at(-1)
  return lastMessage?.role === "assistant" ? lastMessage : undefined
}

function buildRuntimeSnapshot(
  snapshot: AgentHostSnapshot
): RuntimeSessionSnapshot {
  return {
    draftAssistantMessage: getDraftAssistantMessage(snapshot),
    error: snapshot.error,
    isStreaming: snapshot.isStreaming,
    lastEventAt: Date.now(),
    sessionId: snapshot.session.id,
  }
}

export class SessionRuntimeRegistry {
  private readonly clientSinks = new Map<string, RuntimeClientSink>()
  private readonly hostSubscriptions = new Map<string, () => void>()
  private readonly sessionClients = new Map<string, Set<string>>()
  private readonly sessionHosts = new Map<string, AgentHost>()
  private readonly sessionSnapshots = new Map<string, RuntimeSessionSnapshot>()
  private lastRuntimeState?: RuntimeStateSnapshot

  async connectClient(clientId: string, sink: RuntimeClientSink): Promise<void> {
    this.clientSinks.set(clientId, sink)
    sink.onRuntimeState(this.snapshotRuntimeState())

    for (const [sessionId, snapshot] of this.sessionSnapshots) {
      if (!this.sessionClients.get(sessionId)?.has(clientId)) {
        continue
      }

      sink.onSessionSnapshot(snapshot)
    }
  }

  async disconnectClient(clientId: string): Promise<void> {
    this.clientSinks.delete(clientId)

    for (const [sessionId, clientIds] of this.sessionClients) {
      clientIds.delete(clientId)

      if (clientIds.size === 0) {
        this.sessionClients.delete(sessionId)
      }
    }

    this.emitRuntimeState()
  }

  async observeSession(clientId: string, sessionId: string): Promise<void> {
    const clients = this.sessionClients.get(sessionId) ?? new Set<string>()
    clients.add(clientId)
    this.sessionClients.set(sessionId, clients)

    const sink = this.clientSinks.get(clientId)
    const snapshot =
      this.sessionSnapshots.get(sessionId) ?? createIdleRuntimeSnapshot(sessionId)

    this.sessionSnapshots.set(sessionId, snapshot)
    sink?.onSessionSnapshot(snapshot)
    this.emitRuntimeState()
  }

  async unobserveSession(clientId: string, sessionId: string): Promise<void> {
    const clients = this.sessionClients.get(sessionId)

    if (!clients) {
      return
    }

    clients.delete(clientId)

    if (clients.size === 0) {
      this.sessionClients.delete(sessionId)
    }

    this.emitRuntimeState()
  }

  async hydrateSession(
    clientId: string,
    sessionId: string,
    persistedSession: SessionData
  ): Promise<void> {
    await this.observeSession(clientId, sessionId)
    this.ensureHost(sessionId, persistedSession)
  }

  async getSessionSnapshot(
    sessionId: string
  ): Promise<RuntimeSessionSnapshot | undefined> {
    return this.sessionSnapshots.get(sessionId)
  }

  async getRuntimeState(): Promise<RuntimeStateSnapshot> {
    return this.snapshotRuntimeState()
  }

  async send(
    sessionId: string,
    content: string
  ): Promise<RuntimeMutationResult> {
    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    host.prompt(content)

    return {
      ok: true,
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.sessionHosts.get(sessionId)?.abort()
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult> {
    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    await host.setModelSelection(providerGroup, modelId)

    return {
      ok: true,
    }
  }

  async setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult> {
    const host = this.sessionHosts.get(sessionId)

    if (!host) {
      return {
        error: "missing-session",
        ok: false,
      }
    }

    if (host.isBusy()) {
      return {
        error: "busy",
        ok: false,
      }
    }

    await host.setRepoSource(repoSource)

    return {
      ok: true,
    }
  }

  dispose(): void {
    for (const unsubscribe of this.hostSubscriptions.values()) {
      unsubscribe()
    }

    for (const host of this.sessionHosts.values()) {
      host.dispose()
    }

    this.hostSubscriptions.clear()
    this.sessionHosts.clear()
    this.sessionSnapshots.clear()
    this.sessionClients.clear()
    this.clientSinks.clear()
  }

  private ensureHost(sessionId: string, persistedSession: SessionData): AgentHost {
    const existing = this.sessionHosts.get(sessionId)

    if (existing) {
      return existing
    }

    const host = new AgentHost(persistedSession)
    const unsubscribe = host.subscribe((snapshot) => {
      const previous = this.sessionSnapshots.get(sessionId)
      const runtimeSnapshot = buildRuntimeSnapshot(snapshot)
      this.sessionSnapshots.set(sessionId, runtimeSnapshot)
      this.emitSessionSnapshot(runtimeSnapshot)

      if (previous?.isStreaming !== runtimeSnapshot.isStreaming) {
        this.emitRuntimeState()
      }
    })

    this.sessionHosts.set(sessionId, host)
    this.hostSubscriptions.set(sessionId, unsubscribe)
    this.sessionSnapshots.set(sessionId, buildRuntimeSnapshot(host.getSnapshot()))
    this.emitRuntimeState()
    return host
  }

  private emitSessionSnapshot(snapshot: RuntimeSessionSnapshot): void {
    const clients = this.sessionClients.get(snapshot.sessionId)

    if (!clients) {
      return
    }

    for (const clientId of clients) {
      this.clientSinks.get(clientId)?.onSessionSnapshot(snapshot)
    }
  }

  private emitRuntimeState(): void {
    const snapshot = this.snapshotRuntimeState()

    if (this.lastRuntimeState && areRuntimeStatesEqual(this.lastRuntimeState, snapshot)) {
      return
    }

    this.lastRuntimeState = snapshot

    for (const sink of this.clientSinks.values()) {
      sink.onRuntimeState(snapshot)
    }
  }

  private snapshotRuntimeState(): RuntimeStateSnapshot {
    return {
      connectedClientIds: [...this.clientSinks.keys()].sort(),
      runningSessionIds: [...this.sessionSnapshots.values()]
        .filter((snapshot) => snapshot.isStreaming)
        .map((snapshot) => snapshot.sessionId)
        .sort(),
      updatedAt: Date.now(),
    }
  }
}
