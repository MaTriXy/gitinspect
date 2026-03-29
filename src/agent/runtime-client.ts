import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { MessageRow, SessionData } from "@/types/storage"
import { AgentHost } from "@/agent/agent-host"
import {
  claimSessionLease,
  LEASE_HEARTBEAT_MS,
  loadSessionLeaseState,
  releaseOwnedSessionLeases,
  releaseSessionLease,
  renewSessionLease,
} from "@/db/session-leases"
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
} from "@/agent/runtime-command-errors"
import { getSessionRuntime, putSession } from "@/db/schema"
import {
  bindRuntimeTrace,
  clearRuntimeTrace,
  getRuntimeTrace,
  logRuntimeDebug,
  type RuntimeTurnTrace,
} from "@/lib/runtime-debug"
import { getIsoNow } from "@/lib/dates"
import { getCanonicalProvider } from "@/models/catalog"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import { loadSession, loadSessionWithMessages } from "@/sessions/session-service"
import { reconcileInterruptedSession } from "@/sessions/session-notices"
import {
  type ActiveSessionViewState,
  deriveActiveSessionViewState,
  deriveRecoveryIntent,
} from "@/sessions/session-view-state"

export type InterruptedResumeMode = "continue" | "retry"

const CONTINUE_INTERRUPTED_PROMPT =
  "Continue your last response from where it stopped."
const RETRY_INTERRUPTED_PROMPT =
  "Please answer my previous message again."

function isSessionLockedMessage(error: Error): boolean {
  return error.message === "This session is active in another tab."
}

function assertTurnMutationAllowed(
  sessionId: string,
  state: ActiveSessionViewState,
  options: { allowRecovering: boolean }
): void {
  if (state.kind === "running-local") {
    throw new BusyRuntimeError(sessionId)
  }

  if (state.kind === "running-remote") {
    throw new Error("This session is active in another tab.")
  }

  if (!options.allowRecovering && state.kind === "recovering") {
    throw new Error("This session is active in another tab.")
  }
}

export class RuntimeClient {
  private readonly activeTurns = new Map<string, AgentHost>()
  private readonly leaseHeartbeats = new Map<
    string,
    ReturnType<typeof setInterval>
  >()
  private listenersInstalled = false

  constructor() {
    this.installListeners()
  }

  private installListeners(): void {
    if (
      this.listenersInstalled ||
      typeof window === "undefined"
    ) {
      return
    }

    const release = () => {
      void this.releaseAll()
    }

    window.addEventListener("beforeunload", release)
    window.addEventListener("pagehide", release)
    this.listenersInstalled = true
  }

  private async createHost(
    session: SessionData,
    messages: MessageRow[],
    trace?: RuntimeTurnTrace
  ): Promise<AgentHost> {
    trace?.startPhase("runtime.githubToken.read", {
      sessionId: session.id,
    })
    const githubRuntimeToken = await getGithubPersonalAccessToken()
    trace?.endPhase("runtime.githubToken.read", {
      hasGithubToken: Boolean(githubRuntimeToken),
      sessionId: session.id,
    })
    trace?.startPhase("runtime.host.construct", {
      hasRepoSource: Boolean(session.repoSource),
      messageCount: messages.length,
      sessionId: session.id,
    })
    const host = new AgentHost(session, messages, {
      getGithubToken: getGithubPersonalAccessToken,
      githubRuntimeToken,
    })
    trace?.endPhase("runtime.host.construct", {
      hasRepoSource: Boolean(session.repoSource),
      sessionId: session.id,
    })
    return host
  }

  private async claimOwnership(
    sessionId: string,
    options: { keepAlive?: boolean } = {}
  ): Promise<void> {
    logRuntimeDebug("lease_claim_started", { sessionId })
    const claimed = await claimSessionLease(sessionId)

    if (claimed.kind === "locked") {
      throw new Error("This session is active in another tab.")
    }

    if (options.keepAlive !== false) {
      this.startLeaseHeartbeat(sessionId)
    }
    logRuntimeDebug("lease_claimed", { sessionId })
  }

  private startLeaseHeartbeat(sessionId: string): void {
    if (this.leaseHeartbeats.has(sessionId)) {
      return
    }

    const interval = setInterval(() => {
      void renewSessionLease(sessionId)
    }, LEASE_HEARTBEAT_MS)

    this.leaseHeartbeats.set(sessionId, interval)
  }

  private stopLeaseHeartbeat(sessionId: string): void {
    const interval = this.leaseHeartbeats.get(sessionId)

    if (!interval) {
      return
    }

    clearInterval(interval)
    this.leaseHeartbeats.delete(sessionId)
  }

  private watchActiveTurn(sessionId: string, host: AgentHost): void {
    void host
      .waitForTurn()
      .catch((error) => {
        if (
          error instanceof Error &&
          !isSessionLockedMessage(error)
        ) {
          console.error("[gitinspect:runtime] turn_watch_failed", {
            error,
            sessionId,
          })
        }
      })
      .finally(() => {
        if (this.activeTurns.get(sessionId) !== host) {
          return
        }

        host.dispose()
        this.activeTurns.delete(sessionId)
        this.stopLeaseHeartbeat(sessionId)
        void releaseSessionLease(sessionId)
      })
  }

  private async loadPersistedState(sessionId: string): Promise<{
    loaded: { messages: MessageRow[]; session: SessionData }
    state: ReturnType<typeof deriveActiveSessionViewState>
  }> {
    const loaded = await loadSessionWithMessages(sessionId)

    if (!loaded) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    const [leaseState, runtime] = await Promise.all([
      loadSessionLeaseState(sessionId),
      getSessionRuntime(sessionId),
    ])
    const state = deriveActiveSessionViewState({
      hasLocalRunner: this.hasActiveTurn(sessionId),
      hasPartialAssistantText: false,
      lastProgressAt: runtime?.lastProgressAt,
      leaseState,
      runtimeStatus: runtime?.status,
      sessionIsStreaming: loaded.session.isStreaming,
    })

    return { loaded, state }
  }

  private async loadMutationSession(
    sessionId: string,
    trace?: RuntimeTurnTrace
  ): Promise<{ messages: MessageRow[]; session: SessionData }> {
    trace?.startPhase("runtime.state.load", { sessionId })
    let { state } = await this.loadPersistedState(sessionId)
    trace?.endPhase("runtime.state.load", {
      sessionId,
      state: state.kind,
    })

    assertTurnMutationAllowed(sessionId, state, { allowRecovering: true })

    if (deriveRecoveryIntent(state) === "run-now") {
      trace?.startPhase("runtime.reconcileInterrupted", { sessionId })
      await reconcileInterruptedSession(sessionId, {
        hasLocalRunner: false,
      })
      trace?.endPhase("runtime.reconcileInterrupted", { sessionId })
      trace?.startPhase("runtime.state.reload", { sessionId })
      ;({ state } = await this.loadPersistedState(sessionId))
      trace?.endPhase("runtime.state.reload", {
        sessionId,
        state: state.kind,
      })
    }

    assertTurnMutationAllowed(sessionId, state, { allowRecovering: false })

    trace?.startPhase("runtime.lease.claim", { sessionId })
    await this.claimOwnership(sessionId, { keepAlive: false })
    trace?.endPhase("runtime.lease.claim", { sessionId })
    trace?.startPhase("runtime.session.reload", { sessionId })
    const reloaded = await loadSessionWithMessages(sessionId)
    trace?.endPhase("runtime.session.reload", {
      hasSession: Boolean(reloaded),
      messageCount: reloaded?.messages.length ?? 0,
      sessionId,
    })

    if (!reloaded) {
      await releaseSessionLease(sessionId)
      throw new MissingSessionRuntimeError(sessionId)
    }

    return reloaded
  }

  async startTurn(
    sessionId: string,
    content: string,
    trace?: RuntimeTurnTrace
  ): Promise<void> {
    const turnTrace = trace
      ? bindRuntimeTrace(sessionId, trace)
      : getRuntimeTrace(sessionId)

    logRuntimeDebug("runtime_turn_started", {
      contentLength: content.trim().length,
      sessionId,
    })
    turnTrace?.checkpoint("runtime.startTurn.enter", {
      contentLength: content.trim().length,
      sessionId,
    })

    const existing = this.activeTurns.get(sessionId)

    if (existing?.isBusy()) {
      turnTrace?.end({
        reason: "busy-runtime",
        sessionId,
        status: "failed",
      })
      throw new BusyRuntimeError(sessionId)
    }

    const loaded = await this.loadMutationSession(sessionId, turnTrace)
    turnTrace?.checkpoint("runtime.session.ready", {
      hasRepoSource: Boolean(loaded.session.repoSource),
      messageCount: loaded.messages.length,
      sessionId,
    })
    const host = await this.createHost(loaded.session, loaded.messages, turnTrace)
    this.activeTurns.set(sessionId, host)

    try {
      turnTrace?.startPhase("runtime.host.startTurn", { sessionId })
      await host.startTurn(content, turnTrace)
      turnTrace?.endPhase("runtime.host.startTurn", { sessionId })
      this.startLeaseHeartbeat(sessionId)
      this.watchActiveTurn(sessionId, host)
      logRuntimeDebug("runtime_turn_accepted", { sessionId })
      turnTrace?.checkpoint("runtime.turn.accepted", { sessionId })
    } catch (error) {
      turnTrace?.endPhase("runtime.host.startTurn", {
        error:
          error instanceof Error ? error.message : String(error),
        sessionId,
      })
      host.dispose()
      this.activeTurns.delete(sessionId)
      this.stopLeaseHeartbeat(sessionId)
      await releaseSessionLease(sessionId)
      logRuntimeDebug("runtime_turn_failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId,
      })
      turnTrace?.end({
        message:
          error instanceof Error ? error.message : String(error),
        sessionId,
        status: "failed",
      })
      clearRuntimeTrace(sessionId)
      throw error
    }
  }

  async startInitialTurn(
    session: SessionData,
    content: string,
    trace?: RuntimeTurnTrace
  ): Promise<void> {
    const turnTrace = trace
      ? bindRuntimeTrace(session.id, trace)
      : getRuntimeTrace(session.id)

    logRuntimeDebug("runtime_initial_turn_started", {
      contentLength: content.trim().length,
      sessionId: session.id,
    })
    turnTrace?.checkpoint("runtime.startInitialTurn.enter", {
      contentLength: content.trim().length,
      sessionId: session.id,
    })

    turnTrace?.startPhase("runtime.initial.lease.claim", {
      sessionId: session.id,
    })
    await this.claimOwnership(session.id)
    turnTrace?.endPhase("runtime.initial.lease.claim", {
      sessionId: session.id,
    })
    const host = await this.createHost(session, [], turnTrace)
    this.activeTurns.set(session.id, host)

    try {
      turnTrace?.startPhase("runtime.initial.host.startTurn", {
        sessionId: session.id,
      })
      await host.startTurn(content, turnTrace)
      turnTrace?.endPhase("runtime.initial.host.startTurn", {
        sessionId: session.id,
      })
      this.watchActiveTurn(session.id, host)
      logRuntimeDebug("runtime_initial_turn_accepted", {
        sessionId: session.id,
      })
      turnTrace?.checkpoint("runtime.initial.turn.accepted", {
        sessionId: session.id,
      })
    } catch (error) {
      turnTrace?.endPhase("runtime.initial.host.startTurn", {
        error:
          error instanceof Error ? error.message : String(error),
        sessionId: session.id,
      })
      host.dispose()
      this.activeTurns.delete(session.id)
      this.stopLeaseHeartbeat(session.id)
      await releaseSessionLease(session.id)
      logRuntimeDebug("runtime_initial_turn_failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: session.id,
      })
      turnTrace?.end({
        message:
          error instanceof Error ? error.message : String(error),
        sessionId: session.id,
        status: "failed",
      })
      clearRuntimeTrace(session.id)
      throw error
    }
  }

  async abort(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (!host) {
      return
    }

    await this.claimOwnership(sessionId)
    host.abort()
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.get(sessionId)?.isBusy() ?? false
  }

  async releaseSession(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    host?.dispose()
    this.activeTurns.delete(sessionId)
    this.stopLeaseHeartbeat(sessionId)
    clearRuntimeTrace(sessionId)
    await releaseSessionLease(sessionId)
  }

  async releaseAll(): Promise<void> {
    for (const host of this.activeTurns.values()) {
      host.dispose()
    }

    this.activeTurns.clear()

    for (const [sessionId] of this.leaseHeartbeats) {
      this.stopLeaseHeartbeat(sessionId)
      clearRuntimeTrace(sessionId)
    }

    await releaseOwnedSessionLeases()
  }

  async refreshGithubToken(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (!host) {
      return
    }

    await host.refreshGithubToken()
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (host?.isBusy()) {
      throw new BusyRuntimeError(sessionId)
    }

    await this.claimOwnership(sessionId, { keepAlive: false })

    try {
      if (host) {
        await host.setModelSelection(providerGroup, modelId)
        return
      }

      const session = await loadSession(sessionId)

      if (!session) {
        throw new MissingSessionRuntimeError(sessionId)
      }

      await putSession({
        ...session,
        error: undefined,
        model: modelId,
        provider: getCanonicalProvider(providerGroup),
        providerGroup,
        updatedAt: getIsoNow(),
      })
    } finally {
      if (!this.hasActiveTurn(sessionId)) {
        await releaseSessionLease(sessionId)
      }
    }
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (host?.isBusy()) {
      throw new BusyRuntimeError(sessionId)
    }

    await this.claimOwnership(sessionId, { keepAlive: false })

    try {
      if (host) {
        await host.setThinkingLevel(thinkingLevel)
        return
      }

      const session = await loadSession(sessionId)

      if (!session) {
        throw new MissingSessionRuntimeError(sessionId)
      }

      await putSession({
        ...session,
        thinkingLevel,
        updatedAt: getIsoNow(),
      })
    } finally {
      if (!this.hasActiveTurn(sessionId)) {
        await releaseSessionLease(sessionId)
      }
    }
  }

  async resumeInterruptedTurn(
    sessionId: string,
    mode: InterruptedResumeMode
  ): Promise<void> {
    const { state } = await this.loadPersistedState(sessionId)

    if (state.kind !== "interrupted") {
      throw new Error("This session is not interrupted.")
    }

    await this.startTurn(
      sessionId,
      mode === "continue"
        ? CONTINUE_INTERRUPTED_PROMPT
        : RETRY_INTERRUPTED_PROMPT
    )
  }
}

export const runtimeClient = new RuntimeClient()
