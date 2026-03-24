import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import { getCanonicalProvider, getModel } from "@/models/catalog"
import { recordUsage } from "@/db/schema"
import { createId } from "@/lib/ids"
import { webMessageTransformer } from "@/agent/message-transformer"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import {
  buildInitialAgentState,
  buildSessionFromAgentState,
} from "@/agent/session-adapter"
import { streamChatWithPiAgent } from "@/agent/live-runtime"
import { createRepoRuntime } from "@/repo/repo-runtime"
import {
  persistSession,
  shouldSaveSession,
} from "@/sessions/session-service"
import { normalizeRepoSource } from "@/repo/settings"
import { createRepoTools } from "@/tools"
import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"

export interface AgentHostSnapshot {
  error?: string
  isStreaming: boolean
  session: SessionData
}

export class AgentHost {
  readonly agent: Agent

  private readonly recordedAssistantMessageIds = new Set<string>()
  private persistQueue = Promise.resolve()
  private repoRuntime
  private session: SessionData
  private unsubscribe?: () => void

  constructor(
    session: SessionData,
    private readonly onSnapshot: (snapshot: AgentHostSnapshot) => void
  ) {
    this.session = session
    this.repoRuntime = this.createRuntime(session.repoSource)
    this.seedRecordedCosts(session)

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
        model,
        this.getAgentTools(this.repoRuntime)
      ),
      streamFn: streamChatWithPiAgent,
      toolExecution: "sequential",
    })
    this.agent.sessionId = session.id
    this.unsubscribe = this.agent.subscribe((event) => {
      void this.handleEvent(event)
    })
  }

  async prompt(content: string): Promise<void> {
    const trimmed = content.trim()

    if (!trimmed) {
      return
    }

    const message: Message & { id: string } = {
      content: trimmed,
      id: createId(),
      role: "user",
      timestamp: Date.now(),
    }

    await this.agent.prompt(message)
  }

  abort(): void {
    this.agent.abort()
  }

  async setModelSelection(
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    const provider = getCanonicalProvider(providerGroup)
    const model = getModel(provider, modelId)

    this.agent.setModel(model)
    this.agent.sessionId = this.session.id
    this.session = buildSessionFromAgentState(
      {
        ...this.session,
        provider,
        providerGroup,
      },
      this.agent.state
    )
    this.emitSnapshot()
    this.queuePersist(async () => {
      await persistSession(this.session)
    })
    await this.persistQueue
  }

  async setRepoSource(repoSource?: RepoSource): Promise<SessionData> {
    this.repoRuntime = this.createRuntime(repoSource)
    this.session = {
      ...this.session,
      repoSource: normalizeRepoSource(repoSource),
    }
    this.agent.setTools(this.getAgentTools(this.repoRuntime))
    this.emitSnapshot()
    this.queuePersist(async () => {
      await persistSession(this.session)
    })
    await this.persistQueue
    return this.session
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private emitSnapshot(): void {
    this.onSnapshot({
      error: this.agent.state.error,
      isStreaming: this.agent.state.isStreaming,
      session: this.session,
    })
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    this.session = buildSessionFromAgentState(this.session, this.agent.state)
    this.emitSnapshot()

    if (event.type !== "message_end") {
      return
    }

    this.queuePersist(async () => {
      if (shouldSaveSession(this.session)) {
        await persistSession(this.session)
      }

      if (
        event.message.role === "assistant" &&
        event.message.usage.cost.total > 0
      ) {
        const messageId =
          "id" in event.message && typeof event.message.id === "string"
            ? event.message.id
            : undefined

        if (messageId && !this.recordedAssistantMessageIds.has(messageId)) {
          this.recordedAssistantMessageIds.add(messageId)
          await recordUsage(
            event.message.usage,
            this.session.provider,
            this.session.model,
            event.message.timestamp
          )
        }
      }
    })

    await this.persistQueue
  }

  private queuePersist(task: () => Promise<void>): void {
    this.persistQueue = this.persistQueue.then(task, task)
  }

  private seedRecordedCosts(session: SessionData): void {
    for (const message of session.messages) {
      if (message.role !== "assistant" || message.usage.cost.total <= 0) {
        continue
      }

      this.recordedAssistantMessageIds.add(message.id)
    }
  }

  private createRuntime(repoSource?: RepoSource) {
    const normalized = normalizeRepoSource(repoSource)
    return normalized ? createRepoRuntime(normalized) : undefined
  }

  private getAgentTools(runtime = this.repoRuntime) {
    return runtime ? createRepoTools(runtime).agentTools : []
  }
}
