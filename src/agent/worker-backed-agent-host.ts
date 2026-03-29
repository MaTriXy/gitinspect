import { BusyRuntimeError } from "@/agent/runtime-command-errors"
import { AgentTurnPersistence } from "@/agent/agent-turn-persistence"
import {
  createRuntimeWorkerEvents,
  getRuntimeWorker,
} from "@/agent/runtime-worker-client"
import type { WorkerSnapshotEnvelope } from "@/agent/runtime-worker-types"
import type { SessionRunner } from "@/agent/session-runner"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import type { MessageRow, SessionData } from "@/types/storage"
import type {
  ProviderGroupId,
  ThinkingLevel,
} from "@/types/models"

export class WorkerBackedAgentHost implements SessionRunner {
  private readonly persistence: AgentTurnPersistence
  private readonly worker = getRuntimeWorker()
  private promptPending = false
  private runningTurn?: Promise<void>
  private disposed = false
  private lastEnvelope?: WorkerSnapshotEnvelope

  constructor(
    private readonly session: SessionData,
    messages: Array<MessageRow>
  ) {
    this.persistence = new AgentTurnPersistence(session, messages)
  }

  isBusy(): boolean {
    return this.promptPending || this.runningTurn !== undefined || this.persistence.session.isStreaming
  }

  async startTurn(content: string): Promise<void> {
    const trimmed = content.trim()

    if (!trimmed || this.disposed) {
      return
    }

    if (this.isBusy()) {
      throw new BusyRuntimeError(this.session.id)
    }

    const turn = this.persistence.createTurn(trimmed)
    this.promptPending = true

    try {
      await this.persistence.beginTurn(turn)
      await this.worker.startTurn(
        {
          githubRuntimeToken: await getGithubPersonalAccessToken(),
          messages: this.persistence.getSeedMessages(),
          session: this.persistence.session,
          turn,
        },
        createRuntimeWorkerEvents({
          pushSnapshot: async (envelope) => {
            this.lastEnvelope = envelope

            for (const runtimeError of envelope.runtimeErrors ?? []) {
              await this.persistence.appendSystemNoticeFromError(
                new Error(runtimeError)
              )
            }

            await this.persistence.applySnapshot({
              snapshot: envelope.snapshot,
              terminalStatus: envelope.terminalStatus,
            })

            if (envelope.rotateStreamingAssistantDraft) {
              this.persistence.rotateStreamingAssistantDraft()
            }
          },
        })
      )
      this.runningTurn = this.worker
        .waitForTurn(this.session.id)
        .then((envelope) => {
          if (envelope) {
            this.lastEnvelope = envelope
          }
        })
        .finally(() => {
          this.runningTurn = undefined
        })
    } catch (error) {
      await this.persistence.repairTurnFailure(
        error instanceof Error ? error : new Error(String(error)),
        this.lastEnvelope?.snapshot
      )
      throw error
    } finally {
      this.promptPending = false
    }
  }

  async waitForTurn(): Promise<void> {
    await this.runningTurn
    await this.persistence.flush()

    if (this.persistence.session.isStreaming) {
      const finalized = this.lastEnvelope
        ? await this.persistence.persistCurrentTurnBoundary(
            this.lastEnvelope.snapshot
          )
        : false

      if (finalized) {
        return
      }

      console.warn("[runtime-fallback] worker-host.waitForTurn", {
        hasLastEnvelope: this.lastEnvelope !== undefined,
        hasLastEnvelopeStreamMessage:
          this.lastEnvelope?.snapshot.streamMessage !== null,
        lastEnvelopeIsStreaming: this.lastEnvelope?.snapshot.isStreaming,
        lastEnvelopeMessageCount: this.lastEnvelope?.snapshot.messages.length,
        lastEnvelopeTerminalStatus: this.lastEnvelope?.terminalStatus,
        persistenceSessionIsStreaming: this.persistence.session.isStreaming,
        sessionId: this.session.id,
      })

      await this.persistence.repairTurnFailure(
        this.lastEnvelope?.snapshot.error ??
          new Error("Runtime stopped before clearing the streaming state."),
        this.lastEnvelope?.snapshot
      )
    }
  }

  async abort(): Promise<void> {
    await this.worker.abortTurn(this.session.id)
  }

  async setModelSelection(
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    if (this.disposed) {
      return
    }

    await this.persistence.updateModelSelection(providerGroup, modelId)
    await this.worker.setModelSelection({
      modelId,
      providerGroup,
      sessionId: this.session.id,
    })
  }

  async setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void> {
    if (this.disposed) {
      return
    }

    await this.persistence.updateThinkingLevel(thinkingLevel)
    await this.worker.setThinkingLevel({
      sessionId: this.session.id,
      thinkingLevel,
    })
  }

  async refreshGithubToken(): Promise<void> {
    if (this.disposed) {
      return
    }

    await this.worker.refreshGithubToken({
      sessionId: this.session.id,
      token: await getGithubPersonalAccessToken(),
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.persistence.dispose()
    await this.worker.disposeSession(this.session.id)
  }
}
