import { Agent } from "@mariozechner/pi-agent-core"
import type {
  AgentEvent,
  AgentTool,
} from "@mariozechner/pi-agent-core"
import { BusyRuntimeError } from "@/agent/runtime-command-errors"
import {
  shouldStopStreamingForRuntimeError,
  withTerminalError,
} from "@/agent/runtime-errors"
import { webMessageTransformer } from "@/agent/message-transformer"
import { streamChatWithPiAgent } from "@/agent/provider-stream"
import { buildInitialAgentState } from "@/agent/session-adapter"
import type {
  ConfigureSessionInput,
  RefreshGithubTokenInput,
  RuntimeWorkerEvents,
  SetThinkingLevelInput,
  StartTurnInput,
  WorkerSnapshot,
  WorkerSnapshotEnvelope,
} from "@/agent/runtime-worker-types"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import { getCanonicalProvider, getModel } from "@/models/catalog"
import { createRepoRuntime } from "@/repo/repo-runtime"
import { normalizeRepoSource } from "@/repo/settings"
import { createRepoTools } from "@/tools"
import type { ProviderId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

const TURN_IDLE_TIMEOUT_MS = 15 * 60_000
const TURN_IDLE_POLL_MS = 30_000
const SNAPSHOT_FLUSH_MS = 50

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

class WorkerAgentRunner {
  readonly agent: Agent

  private disposed = false
  private promptPending = false
  private runningTurn?: Promise<void>
  private githubRuntimeTokenSnapshot?: string
  private repoRuntime
  private unsubscribe?: () => void
  private lastProgressAt = 0
  private watchdogInterval?: ReturnType<typeof setInterval>
  private readonly sessionId: string
  private sessionData: SessionData
  private readonly events: RuntimeWorkerEvents
  private flushTimer?: ReturnType<typeof setTimeout>
  private latestTerminalStatus: "aborted" | "error" | undefined
  private terminalErrorMessage?: string
  private rotateStreamingAssistantDraft = false
  private pendingRuntimeErrors: string[] = []
  private lastEnvelope?: WorkerSnapshotEnvelope

  constructor(
    session: SessionData,
    messages: StartTurnInput["messages"],
    events: RuntimeWorkerEvents,
    options?: {
      githubRuntimeToken?: string
    }
  ) {
    this.sessionId = session.id
    this.sessionData = session
    this.events = events
    this.githubRuntimeTokenSnapshot = options?.githubRuntimeToken
    this.repoRuntime = this.createRuntime(session.repoSource)

    const model = getModel(session.provider, session.model)

    this.agent = new Agent({
      convertToLlm: webMessageTransformer,
      getApiKey: async (provider) =>
        await resolveApiKeyForProvider(
          provider as ProviderId,
          this.session.providerGroup
        ),
      initialState: buildInitialAgentState(
        session,
        messages,
        model,
        this.getAgentTools(this.repoRuntime)
      ),
      streamFn: streamChatWithPiAgent,
      toolExecution: "sequential",
    })
    this.agent.sessionId = this.sessionId
    this.unsubscribe = this.agent.subscribe((event) => {
      this.enqueueEvent(event)
    })
  }

  private get session(): SessionData {
    return this.sessionData
  }

  private set session(session: SessionData) {
    this.sessionData = session
  }

  isBusy(): boolean {
    return this.promptPending || this.runningTurn !== undefined || this.agent.state.isStreaming
  }

  async startTurn(turn: StartTurnInput["turn"]): Promise<void> {
    if (this.disposed) {
      return
    }

    if (this.isBusy()) {
      throw new BusyRuntimeError(this.sessionId)
    }

    this.latestTerminalStatus = undefined
    this.terminalErrorMessage = undefined
    this.promptPending = true
    this.markProgress()
    this.runningTurn = this.runTurnToCompletion(turn.userMessage).finally(() => {
      this.runningTurn = undefined
    })
  }

  async waitForTurn(): Promise<WorkerSnapshotEnvelope | undefined> {
    await this.runningTurn
    return this.lastEnvelope
  }

  abort(): void {
    this.latestTerminalStatus = "aborted"
    this.terminalErrorMessage = undefined
    this.agent.abort()
    void this.flushSnapshotNow()
  }

  async setModelSelection(
    providerGroup: ConfigureSessionInput["providerGroup"],
    modelId: string
  ): Promise<void> {
    if (this.disposed) {
      return
    }

    const provider = getCanonicalProvider(providerGroup)
    const model = getModel(provider, modelId)

    this.agent.setModel(model)
    this.agent.sessionId = this.sessionId
    this.session = {
      ...this.session,
      error: undefined,
      model: modelId,
      provider,
      providerGroup,
    }
  }

  async setThinkingLevel(
    thinkingLevel: SetThinkingLevelInput["thinkingLevel"]
  ): Promise<void> {
    if (this.disposed) {
      return
    }

    this.agent.setThinkingLevel(thinkingLevel)
    this.session = {
      ...this.session,
      thinkingLevel,
    }
  }

  async refreshGithubToken(
    token: RefreshGithubTokenInput["token"]
  ): Promise<void> {
    if (this.disposed) {
      return
    }

    this.githubRuntimeTokenSnapshot = token
    this.repoRuntime = this.createRuntime(this.session.repoSource, token)
    this.agent.setTools(this.getAgentTools(this.repoRuntime))
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.stopWatchdog()
    this.clearFlushTimer()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.agent.abort()
  }

  private async runTurnToCompletion(
    userMessage: StartTurnInput["turn"]["userMessage"]
  ): Promise<void> {
    this.startWatchdog()

    try {
      await this.agent.prompt(userMessage)
    } catch (error) {
      if (this.disposed) {
        return
      }

      const nextError =
        error instanceof Error ? error : new Error(String(error))
      void nextError
      this.latestTerminalStatus ??= "error"
    } finally {
      this.promptPending = false
      this.stopWatchdog()
      await this.flushSnapshotNow()
    }
  }

  private enqueueEvent(event: AgentEvent): void {
    if (this.disposed) {
      return
    }

    this.markProgress()
    const snapshot = this.snapshotAgentState()

    if (!snapshot.isStreaming && snapshot.error) {
      this.latestTerminalStatus ??= "error"
    }

    if (event.type === "turn_end" && event.toolResults.length > 0) {
      this.rotateStreamingAssistantDraft = true
    }

    const force =
      event.type === "message_end" ||
      event.type === "turn_end" ||
      (!snapshot.isStreaming && this.latestTerminalStatus !== undefined)

    this.queueSnapshotFlush(force)
  }

  private queueSnapshotFlush(force = false): void {
    if (this.disposed) {
      return
    }

    if (force) {
      void this.flushSnapshotNow()
      return
    }

    if (this.flushTimer) {
      return
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flushSnapshotNow()
    }, SNAPSHOT_FLUSH_MS)
  }

  private async flushSnapshotNow(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.clearFlushTimer()
    const snapshot = withTerminalError(
      this.snapshotAgentState(),
      this.terminalErrorMessage
    )

    const envelope: WorkerSnapshotEnvelope = {
      rotateStreamingAssistantDraft: this.rotateStreamingAssistantDraft
        ? true
        : undefined,
      runtimeErrors:
        this.pendingRuntimeErrors.length > 0
          ? [...this.pendingRuntimeErrors]
          : undefined,
      sessionId: this.sessionId,
      snapshot,
      terminalStatus: this.latestTerminalStatus,
    }

    this.rotateStreamingAssistantDraft = false
    this.pendingRuntimeErrors = []
    this.lastEnvelope = envelope

    await this.events.pushSnapshot(envelope)
  }

  private snapshotAgentState(): WorkerSnapshot {
    return {
      error: this.agent.state.error,
      isStreaming: this.agent.state.isStreaming,
      messages: cloneValue(this.agent.state.messages),
      streamMessage:
        this.agent.state.streamMessage === null
          ? null
          : cloneValue(this.agent.state.streamMessage),
    }
  }

  private markProgress(): void {
    this.lastProgressAt = Date.now()
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    this.markProgress()
    this.watchdogInterval = setInterval(() => {
      if (this.disposed || !this.isBusy()) {
        this.stopWatchdog()
        return
      }

      if (Date.now() - this.lastProgressAt < TURN_IDLE_TIMEOUT_MS) {
        return
      }

      this.latestTerminalStatus = "error"
      this.agent.abort()
      this.stopWatchdog()
      this.queueSnapshotFlush(true)
    }, TURN_IDLE_POLL_MS)
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval)
      this.watchdogInterval = undefined
    }
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) {
      return
    }

    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private createRuntime(repoSource?: RepoSource, token?: string) {
    const normalized = normalizeRepoSource(repoSource)

    if (!normalized) {
      return undefined
    }

    const resolved =
      token !== undefined ? token : this.githubRuntimeTokenSnapshot

    return createRepoRuntime(normalized, { runtimeToken: resolved })
  }

  private getAgentTools(runtime = this.repoRuntime): AgentTool[] {
    if (!runtime) {
      return []
    }

    return createRepoTools(runtime, {
      onRepoError: (error) => {
        const nextError =
          error instanceof Error ? error : new Error(String(error))
        this.pendingRuntimeErrors.push(nextError.message)

        if (
          shouldStopStreamingForRuntimeError(nextError) &&
          this.terminalErrorMessage === undefined
        ) {
          this.terminalErrorMessage = nextError.message
          this.latestTerminalStatus = "error"
          this.agent.abort()
        }

        this.queueSnapshotFlush(true)
      },
    }).agentTools
  }
}

const runners = new Map<string, WorkerAgentRunner>()

function getRunner(sessionId: string): WorkerAgentRunner | undefined {
  return runners.get(sessionId)
}

export async function startTurn(
  input: StartTurnInput,
  events: RuntimeWorkerEvents
): Promise<void> {
  let runner = getRunner(input.session.id)

  if (!runner) {
    runner = new WorkerAgentRunner(input.session, input.messages, events, {
      githubRuntimeToken: input.githubRuntimeToken,
    })
    runners.set(input.session.id, runner)
  }

  await runner.startTurn(input.turn)
}

export async function waitForTurn(
  sessionId: string
): Promise<WorkerSnapshotEnvelope | undefined> {
  return await getRunner(sessionId)?.waitForTurn()
}

export async function abortTurn(sessionId: string): Promise<void> {
  getRunner(sessionId)?.abort()
}

export async function disposeSession(sessionId: string): Promise<void> {
  getRunner(sessionId)?.dispose()
  runners.delete(sessionId)
}

export async function setModelSelection(
  input: ConfigureSessionInput
): Promise<void> {
  await getRunner(input.sessionId)?.setModelSelection(
    input.providerGroup,
    input.modelId
  )
}

export async function setThinkingLevel(
  input: SetThinkingLevelInput
): Promise<void> {
  await getRunner(input.sessionId)?.setThinkingLevel(input.thinkingLevel)
}

export async function refreshGithubToken(
  input: RefreshGithubTokenInput
): Promise<void> {
  await getRunner(input.sessionId)?.refreshGithubToken(input.token)
}
