import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { ProviderGroupId, ProviderId, ThinkingLevel } from "@gitinspect/pi/types/models";
import type { MessageRow, SessionData } from "@gitinspect/db/storage-types";
import { BusyRuntimeError } from "@gitinspect/pi/agent/runtime-command-errors";
import {
  AgentTurnPersistence,
  type AgentStateSnapshot,
  type TerminalAssistantStatus,
} from "@gitinspect/pi/agent/agent-turn-persistence";
import {
  shouldStopStreamingForRuntimeError,
  withTerminalError,
} from "@gitinspect/pi/agent/runtime-errors";
import { webMessageTransformer } from "@gitinspect/pi/agent/message-transformer";
import { streamChatWithPiAgent } from "@gitinspect/pi/agent/provider-stream";
import { buildInitialAgentState } from "@gitinspect/pi/agent/session-adapter";
import { resolveApiKeyForProvider } from "@gitinspect/pi/auth/resolve-api-key";
import { getCanonicalProvider, getModel } from "@gitinspect/pi/models/catalog";
import { createOptionalRepoRuntime } from "@gitinspect/pi/repo/repo-runtime";
import { createRepoTools } from "@gitinspect/pi/tools";

const TURN_IDLE_TIMEOUT_MS = 15 * 60_000;
const TURN_IDLE_POLL_MS = 30_000;

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export class AgentHost {
  readonly agent: Agent;

  private readonly persistence: AgentTurnPersistence;
  private lastTerminalStatus: TerminalAssistantStatus = undefined;
  private disposed = false;
  private promptPending = false;
  private runningTurn?: Promise<void>;
  private eventQueue = Promise.resolve();
  private githubRuntimeTokenSnapshot?: string;
  private getGithubToken?: () => Promise<string | undefined>;
  private repoRuntime;
  private unsubscribe?: () => void;
  private lastProgressAt = 0;
  private watchdogError?: Error;
  private watchdogInterval?: ReturnType<typeof setInterval>;
  private recoveringFromHandlerError = false;
  private terminalErrorMessage?: string;

  constructor(
    session: SessionData,
    messages: Array<MessageRow>,
    options?: {
      getGithubToken?: () => Promise<string | undefined>;
      githubRuntimeToken?: string;
    },
  ) {
    this.persistence = new AgentTurnPersistence(session, messages);
    this.githubRuntimeTokenSnapshot = options?.githubRuntimeToken;
    this.getGithubToken = options?.getGithubToken;
    this.repoRuntime = createOptionalRepoRuntime(session.repoSource, {
      runtimeToken: this.githubRuntimeTokenSnapshot,
    });

    const model = getModel(this.session.provider, this.session.model);

    this.agent = new Agent({
      convertToLlm: webMessageTransformer,
      getApiKey: async (provider) =>
        await resolveApiKeyForProvider(provider as ProviderId, this.session.providerGroup),
      initialState: buildInitialAgentState(
        this.session,
        messages,
        model,
        this.getAgentTools(this.repoRuntime),
      ),
      streamFn: streamChatWithPiAgent,
      toolExecution: "sequential",
    });
    this.agent.sessionId = this.session.id;
    this.unsubscribe = this.agent.subscribe((event) => {
      this.enqueueEvent(event);
    });
  }

  private get session(): SessionData {
    return this.persistence.session;
  }

  isBusy(): boolean {
    return this.promptPending || this.runningTurn !== undefined || this.agent.state.isStreaming;
  }

  async startTurn(content: string): Promise<void> {
    const trimmed = content.trim();

    if (!trimmed || this.disposed) {
      return;
    }

    if (this.isBusy()) {
      throw new BusyRuntimeError(this.session.id);
    }

    const turn = this.persistence.createTurn(trimmed);
    this.lastTerminalStatus = undefined;
    this.terminalErrorMessage = undefined;
    this.watchdogError = undefined;
    this.promptPending = true;

    try {
      await this.persistence.beginTurn(turn);
    } catch (error) {
      this.promptPending = false;
      throw error;
    }

    this.markProgress();
    this.runningTurn = this.runTurnToCompletion(turn.userMessage).finally(() => {
      this.runningTurn = undefined;
    });
  }

  async prompt(content: string): Promise<void> {
    await this.startTurn(content);
    await this.runningTurn;
    await this.flushPersistence();
  }

  async flushPersistence(): Promise<void> {
    await this.persistence.flush();
  }

  async waitForTurn(): Promise<void> {
    await this.runningTurn;
    await this.flushPersistence();
  }

  abort(): void {
    this.lastTerminalStatus = "aborted";
    this.terminalErrorMessage = undefined;
    this.agent.abort();
  }

  async setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const provider = getCanonicalProvider(providerGroup);
    const model = getModel(provider, modelId);

    this.agent.setModel(model);
    this.agent.sessionId = this.session.id;
    await this.persistence.updateModelSelection(providerGroup, modelId);
  }

  async setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.agent.setThinkingLevel(thinkingLevel);
    await this.persistence.updateThinkingLevel(thinkingLevel);
  }

  async refreshGithubToken(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const token = await this.getGithubToken?.();
    this.githubRuntimeTokenSnapshot = token;
    this.repoRuntime = createOptionalRepoRuntime(this.session.repoSource, {
      runtimeToken: token,
    });
    this.agent.setTools(this.getAgentTools(this.repoRuntime));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stopWatchdog();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.persistence.dispose();
    this.agent.abort();
  }

  private async runTurnToCompletion(userMessage: Message & { id: string }): Promise<void> {
    this.startWatchdog();
    let promptError: Error | undefined;

    try {
      await this.agent.prompt(userMessage);
    } catch (error) {
      if (this.isDisposed()) {
        return;
      }

      promptError = error instanceof Error ? error : new Error(String(error));
      this.watchdogError ??= promptError;
    } finally {
      this.promptPending = false;
      this.stopWatchdog();
      await this.flushEventQueue();
      await this.flushPersistence();

      if (!this.isDisposed() && this.session.isStreaming) {
        const snapshot = withTerminalError(this.snapshotAgentState(), this.terminalErrorMessage);
        const finalized = await this.persistence.persistCurrentTurnBoundary(snapshot);

        if (!finalized) {
          await this.persistence.repairTurnFailure(
            this.watchdogError ??
              promptError ??
              new Error("Runtime stopped before clearing the streaming state."),
            snapshot,
          );
        }
      }

      this.watchdogError = undefined;
      this.lastTerminalStatus = undefined;
      this.terminalErrorMessage = undefined;
    }
  }

  private async handleEvent(event: AgentEvent, snapshot: AgentStateSnapshot): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.markProgress();
    const nextSnapshot = withTerminalError(snapshot, this.terminalErrorMessage);

    if (!nextSnapshot.isStreaming && nextSnapshot.error) {
      this.lastTerminalStatus ??= "error";
    }

    await this.persistence.applySnapshot({
      snapshot: nextSnapshot,
      terminalStatus: this.lastTerminalStatus,
    });

    if (nextSnapshot.isStreaming && event.type === "turn_end" && event.toolResults.length > 0) {
      this.persistence.rotateStreamingAssistantDraft();
    }

    if (!nextSnapshot.isStreaming) {
      this.lastTerminalStatus = undefined;
      this.terminalErrorMessage = undefined;
    }
  }

  private async recoverFromHandlerError(error: Error): Promise<void> {
    if (this.isDisposed() || this.recoveringFromHandlerError) {
      return;
    }

    this.recoveringFromHandlerError = true;
    this.watchdogError = error;
    this.lastTerminalStatus = "error";
    this.agent.abort();

    try {
      await this.persistence.repairTurnFailure(error, this.snapshotAgentState());
    } finally {
      this.recoveringFromHandlerError = false;
    }
  }

  private enqueueEvent(event: AgentEvent): void {
    const snapshot = this.snapshotAgentState();
    const run = this.eventQueue.then(async () => {
      if (this.disposed) {
        return;
      }

      await this.handleEvent(event, snapshot);
    });

    this.eventQueue = run.catch(async (error) => {
      const nextError = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[agent-host] Unhandled error in event handler (session ${this.session.id}):`,
        nextError,
      );

      try {
        await this.recoverFromHandlerError(nextError);
      } catch (recoveryError) {
        console.error(
          `[agent-host] Failed to recover from event handler error (session ${this.session.id}):`,
          recoveryError,
        );
      }
    });
  }

  private async flushEventQueue(): Promise<void> {
    await this.eventQueue;
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private getAgentTools(runtime = this.repoRuntime): AgentTool[] {
    if (!runtime) {
      return [];
    }

    return createRepoTools(runtime, {
      onRepoError: async (error) => {
        const nextError = error instanceof Error ? error : new Error(String(error));

        await this.persistence.appendSystemNoticeFromError(nextError);

        if (
          shouldStopStreamingForRuntimeError(nextError) &&
          this.terminalErrorMessage === undefined
        ) {
          this.terminalErrorMessage = nextError.message;
          this.watchdogError = nextError;
          this.lastTerminalStatus = "error";
          this.agent.abort();
        }
      },
    }).agentTools;
  }

  private markProgress(): void {
    this.lastProgressAt = Date.now();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.markProgress();
    this.watchdogInterval = setInterval(() => {
      if (this.disposed || !this.isBusy()) {
        this.stopWatchdog();
        return;
      }

      if (Date.now() - this.lastProgressAt < TURN_IDLE_TIMEOUT_MS) {
        return;
      }

      this.watchdogError = new Error("Runtime timed out after no progress.");
      this.lastTerminalStatus = "error";
      this.agent.abort();
      this.stopWatchdog();
    }, TURN_IDLE_POLL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = undefined;
    }
  }

  private snapshotAgentState(): AgentStateSnapshot {
    return {
      error: this.agent.state.error,
      isStreaming: this.agent.state.isStreaming,
      messages: cloneValue(this.agent.state.messages),
      streamMessage:
        this.agent.state.streamMessage === null ? null : cloneValue(this.agent.state.streamMessage),
    };
  }
}
