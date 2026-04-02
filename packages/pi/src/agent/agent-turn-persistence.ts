import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@gitinspect/pi/types/chat";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import type { MessageRow, SessionData } from "@gitinspect/db/storage-types";
import {
  getSessionMessages,
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  recordUsage,
  replaceSessionMessages,
} from "@gitinspect/db/schema";
import { appendSessionNotice } from "@gitinspect/pi/sessions/session-notices";
import { buildPersistedSession } from "@gitinspect/pi/sessions/session-service";
import {
  markTurnCompleted,
  markTurnProgress,
  markTurnStarted,
} from "@gitinspect/db/session-runtime";
import {
  inferMessageStatus,
  normalizeAssistantDraft,
  normalizeMessages,
  toMessageRow,
} from "@gitinspect/pi/agent/session-adapter";
import { getIsoNow } from "@gitinspect/pi/lib/dates";
import { createId } from "@gitinspect/pi/lib/ids";
import { getCanonicalProvider } from "@gitinspect/pi/models/catalog";
import { pruneOrphanToolResults } from "@gitinspect/pi/agent/message-transformer";
import { createEmptyUsage } from "@gitinspect/pi/types/models";

export type TerminalAssistantStatus = "aborted" | "error" | undefined;

export type AgentStateSnapshot = {
  error: string | undefined;
  isStreaming: boolean;
  messages: AgentMessage[];
  streamMessage: AgentMessage | null;
};

export type SnapshotEnvelope = {
  snapshot: AgentStateSnapshot;
  terminalStatus?: TerminalAssistantStatus;
};

export type TurnEnvelope = {
  assistantMessageId: string;
  turnId: string;
  userMessage: UserMessage;
};

function sortByTimestamp(left: MessageRow, right: MessageRow): number {
  return left.timestamp - right.timestamp;
}

function toError(error: Error | string): Error {
  return error instanceof Error ? error : new Error(error);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function rewriteStreamingAssistantRow(
  sessionId: string,
  message: MessageRow,
  errorMessage: string,
): MessageRow {
  if (message.role !== "assistant" || message.status !== "streaming") {
    return message;
  }

  return toMessageRow(
    sessionId,
    {
      ...message,
      errorMessage,
      stopReason: "error",
    },
    "error",
    message.id,
  );
}

function hasMeaningfulAssistantDraft(message: AssistantMessage): boolean {
  if (
    message.content.some((block) => {
      switch (block.type) {
        case "text":
          return block.text.trim().length > 0;
        case "thinking":
          return block.thinking.trim().length > 0;
        case "toolCall":
          return true;
      }
    })
  ) {
    return true;
  }

  return (
    message.errorMessage !== undefined ||
    message.responseId !== undefined ||
    message.usage.totalTokens > 0 ||
    message.usage.cost.total > 0
  );
}

export class AgentTurnPersistence {
  private assignedAssistantIds = new Map<string, string>();
  private persistedMessageIds = new Set<string>();
  private recordedAssistantMessageIds = new Set<string>();
  private currentAssistantMessageId?: string;
  private currentTurnId?: string;
  private lastDraftAssistant?: AssistantMessage;
  private lastTerminalStatus: TerminalAssistantStatus = undefined;
  private persistQueue = Promise.resolve();
  private disposed = false;
  private readonly seededMessages: Array<MessageRow>;
  private sessionData: SessionData;

  constructor(session: SessionData, messages: Array<MessageRow>) {
    this.sessionData = session;
    this.seededMessages = cloneValue(messages);
    this.seedAssignedAssistantIds(messages);
    this.seedRecordedCosts(messages);
  }

  get session(): SessionData {
    return this.sessionData;
  }

  getSeedMessages(): Array<MessageRow> {
    return cloneValue(this.seededMessages);
  }

  createTurn(content: string): TurnEnvelope {
    const timestamp = Date.now();
    const turn: TurnEnvelope = {
      assistantMessageId: createId(),
      turnId: createId(),
      userMessage: {
        content,
        id: createId(),
        role: "user",
        timestamp,
      },
    };

    this.currentAssistantMessageId = turn.assistantMessageId;
    this.currentTurnId = turn.turnId;
    this.lastDraftAssistant = {
      api: "openai-responses",
      content: [{ text: "", type: "text" }],
      id: turn.assistantMessageId,
      model: this.session.model,
      provider: this.session.provider,
      role: "assistant",
      stopReason: "stop",
      timestamp,
      usage: createEmptyUsage(),
    };
    this.lastTerminalStatus = undefined;

    return turn;
  }

  async beginTurn(turn: TurnEnvelope): Promise<void> {
    if (this.disposed) {
      return;
    }

    const userRow = toMessageRow(this.session.id, turn.userMessage);
    const assistantRow = toMessageRow(
      this.session.id,
      this.lastDraftAssistant ?? {
        api: "openai-responses",
        content: [{ text: "", type: "text" }],
        id: turn.assistantMessageId,
        model: this.session.model,
        provider: this.session.provider,
        role: "assistant",
        stopReason: "stop",
        timestamp: turn.userMessage.timestamp,
        usage: createEmptyUsage(),
      },
      "streaming",
      turn.assistantMessageId,
    );

    try {
      await this.persistPromptStart(userRow, assistantRow);
    } catch (error) {
      this.clearActiveStreamPointers();
      throw error;
    }

    await markTurnStarted({
      assistantMessageId: assistantRow.id,
      sessionId: this.session.id,
      turnId: turn.turnId,
    });
  }

  async applySnapshot(envelope: SnapshotEnvelope): Promise<void> {
    if (this.disposed) {
      return;
    }

    const { snapshot } = envelope;

    if (!snapshot.isStreaming && !this.session.isStreaming) {
      return;
    }

    if (envelope.terminalStatus !== undefined) {
      this.lastTerminalStatus = envelope.terminalStatus;
    } else if (!snapshot.isStreaming && snapshot.error) {
      this.lastTerminalStatus ??= "error";
    }

    if (!snapshot.isStreaming && snapshot.error) {
      await this.appendSystemNoticeFromError(new Error(snapshot.error));
    }

    if (snapshot.isStreaming) {
      const currentAssistantRow = this.buildCurrentAssistantRow(snapshot);
      const newlyCompletedRows = this.getNewlyCompletedRows(snapshot);

      if (currentAssistantRow || newlyCompletedRows.length > 0) {
        await this.persistStreamingProgress(currentAssistantRow, newlyCompletedRows);
      }

      return;
    }

    const finalized = await this.persistCurrentTurnBoundary(snapshot);

    if (finalized) {
      return;
    }

    await this.repairTurnFailure(
      snapshot.error ?? new Error("Runtime stopped before clearing the streaming state."),
      snapshot,
    );
  }

  async persistCurrentTurnBoundary(snapshot: AgentStateSnapshot): Promise<boolean> {
    return await this.persistCurrentTurnBoundaryFromSnapshot(snapshot);
  }

  async updateModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.session = {
      ...this.session,
      error: undefined,
      model: modelId,
      provider: getCanonicalProvider(providerGroup),
      providerGroup,
      updatedAt: getIsoNow(),
    };
    await putSession(this.session);
  }

  async updateThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.session = {
      ...this.session,
      thinkingLevel,
      updatedAt: getIsoNow(),
    };
    await putSession(this.session);
  }

  async repairTurnFailure(error: Error | string, snapshot?: AgentStateSnapshot): Promise<void> {
    if (this.disposed) {
      return;
    }

    const normalizedError = toError(error);
    this.lastTerminalStatus = "error";
    const repairedRows = await this.buildRepairRows(normalizedError.message, snapshot);
    const nextSession = buildPersistedSession(
      {
        ...this.session,
        error: undefined,
        isStreaming: false,
        updatedAt: getIsoNow(),
      },
      repairedRows,
    );

    this.session = nextSession;
    this.persistQueue = this.persistQueue.then(async () => {
      if (this.disposed) {
        return;
      }

      await replaceSessionMessages(this.session, repairedRows);
      this.persistedMessageIds.clear();

      for (const message of repairedRows) {
        this.persistedMessageIds.add(message.id);
      }
    });

    await this.persistQueue;
    await markTurnCompleted({
      assistantMessageId: this.currentAssistantMessageId,
      lastError: normalizedError.message,
      sessionId: this.session.id,
      status: "error",
      turnId: this.currentTurnId,
    });
    await this.appendSystemNoticeFromError(normalizedError);
    this.clearActiveStreamPointers();
  }

  rotateStreamingAssistantDraft(): void {
    if (this.disposed) {
      return;
    }

    this.currentAssistantMessageId = createId();
    this.lastDraftAssistant = undefined;
    this.lastTerminalStatus = undefined;
  }

  async appendSystemNoticeFromError(error: Error): Promise<void> {
    if (this.disposed) {
      return;
    }

    await appendSessionNotice(this.session.id, error);
  }

  async flush(): Promise<void> {
    await this.persistQueue;
  }

  dispose(): void {
    this.disposed = true;
  }

  private set session(session: SessionData) {
    this.sessionData = session;
  }

  private seedRecordedCosts(messages: Array<MessageRow>): void {
    for (const message of messages) {
      this.persistedMessageIds.add(message.id);

      if (
        message.role !== "assistant" ||
        message.status !== "completed" ||
        message.usage.cost.total <= 0
      ) {
        continue;
      }

      this.recordedAssistantMessageIds.add(message.id);
    }
  }

  private seedAssignedAssistantIds(messages: Array<MessageRow>): void {
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      this.assignedAssistantIds.set(message.id, message.id);
    }
  }

  private buildCompletedRows(messages: AgentMessage[]): Array<MessageRow> {
    const normalizedMessages = normalizeMessages(messages);
    const currentAssistantId = this.currentAssistantMessageId;

    if (currentAssistantId) {
      for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
        const message = normalizedMessages[index];

        if (message?.role === "assistant" && !this.assignedAssistantIds.has(message.id)) {
          this.assignedAssistantIds.set(message.id, currentAssistantId);
          break;
        }
      }
    }

    let activeAssistantId: string | undefined;

    return normalizedMessages.map((message) => {
      let messageId = message.id;

      if (message.role === "assistant") {
        messageId = this.assignedAssistantIds.get(message.id) ?? message.id;
        activeAssistantId = messageId;
      }

      const row = toMessageRow(this.session.id, message, inferMessageStatus(message), messageId);

      if (row.role === "toolResult" && activeAssistantId) {
        row.parentAssistantId = activeAssistantId;
      }

      return row;
    });
  }

  private buildCurrentAssistantRow(snapshot: AgentStateSnapshot): MessageRow | undefined {
    const draft = normalizeAssistantDraft(snapshot.streamMessage);

    if (draft) {
      this.lastDraftAssistant = draft;
    }

    const currentAssistantId = this.currentAssistantMessageId;
    const lastDraftAssistant = this.lastDraftAssistant;

    if (!currentAssistantId || !lastDraftAssistant) {
      return undefined;
    }

    if (snapshot.isStreaming) {
      return toMessageRow(
        this.session.id,
        {
          ...lastDraftAssistant,
          id: currentAssistantId,
          model: this.session.model,
          provider: this.session.provider,
        },
        "streaming",
        currentAssistantId,
      );
    }

    if (!this.lastTerminalStatus) {
      return undefined;
    }

    return toMessageRow(
      this.session.id,
      {
        ...lastDraftAssistant,
        errorMessage:
          this.lastTerminalStatus === "error"
            ? (snapshot.error ?? lastDraftAssistant.errorMessage)
            : lastDraftAssistant.errorMessage,
        id: currentAssistantId,
        model: this.session.model,
        provider: this.session.provider,
        stopReason: this.lastTerminalStatus === "aborted" ? "aborted" : "error",
      },
      this.lastTerminalStatus,
      currentAssistantId,
    );
  }

  private buildCurrentRows(snapshot: AgentStateSnapshot): Array<MessageRow> {
    const rowsById = new Map<string, MessageRow>();

    for (const row of this.buildCompletedRows(snapshot.messages)) {
      rowsById.set(row.id, row);
    }

    const currentAssistantRow = this.buildCurrentAssistantRow(snapshot);

    if (currentAssistantRow) {
      rowsById.set(currentAssistantRow.id, currentAssistantRow);
    }

    return [...rowsById.values()].sort(sortByTimestamp);
  }

  private getNewlyCompletedRows(snapshot: AgentStateSnapshot): Array<MessageRow> {
    return this.buildCompletedRows(snapshot.messages).filter(
      (message) => !this.persistedMessageIds.has(message.id),
    );
  }

  private async persistPromptStart(userRow: MessageRow, assistantRow: MessageRow): Promise<void> {
    await this.persistSessionBoundary(
      {
        error: undefined,
        isStreaming: true,
      },
      [userRow, assistantRow],
      [...this.getSeedMessages(), userRow, assistantRow],
    );
  }

  private async persistStreamingProgress(
    currentAssistantRow: MessageRow | undefined,
    newlyCompletedRows: Array<MessageRow>,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.persistQueue = this.persistQueue.then(async () => {
      if (this.disposed) {
        return;
      }

      if (newlyCompletedRows.length > 0) {
        await putMessages(newlyCompletedRows);

        for (const message of newlyCompletedRows) {
          this.persistedMessageIds.add(message.id);
        }
      }

      if (currentAssistantRow) {
        await putMessage(currentAssistantRow);
        this.persistedMessageIds.add(currentAssistantRow.id);
      }

      await this.recordAssistantUsageForRows(newlyCompletedRows);

      if (currentAssistantRow || newlyCompletedRows.length > 0) {
        await markTurnProgress({
          assistantMessageId:
            currentAssistantRow?.role === "assistant"
              ? currentAssistantRow.id
              : this.currentAssistantMessageId,
          sessionId: this.session.id,
          turnId: this.currentTurnId,
        });
      }
    });

    await this.persistQueue;
  }

  private async persistCurrentTurnBoundaryFromSnapshot(
    snapshot: AgentStateSnapshot,
  ): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    const currentAssistantId = this.currentAssistantMessageId;

    if (!currentAssistantId) {
      return false;
    }

    const currentRows = this.buildCurrentRows(snapshot);
    const terminalAssistant =
      currentRows.find(
        (row): row is MessageRow & { role: "assistant" } =>
          row.id === currentAssistantId && row.role === "assistant" && row.status !== "streaming",
      ) ?? this.buildSyntheticCompletedAssistant(snapshot);

    if (!terminalAssistant) {
      return false;
    }

    const rowsForDerivation = currentRows.some((row) => row.id === terminalAssistant.id)
      ? currentRows
      : [...currentRows, terminalAssistant].sort(sortByTimestamp);

    const terminalStatus =
      terminalAssistant.status === "aborted" ||
      terminalAssistant.status === "completed" ||
      terminalAssistant.status === "error"
        ? terminalAssistant.status
        : "error";
    await this.persistSessionBoundary(
      {
        error: undefined,
        isStreaming: false,
      },
      [terminalAssistant],
      rowsForDerivation,
    );
    await this.recordAssistantUsage(terminalAssistant);
    await markTurnCompleted({
      assistantMessageId: terminalAssistant.id,
      lastError: terminalAssistant.errorMessage,
      sessionId: this.session.id,
      status: terminalStatus,
      turnId: this.currentTurnId,
    });

    if (terminalStatus === "error" && terminalAssistant.errorMessage) {
      await this.appendSystemNoticeFromError(new Error(terminalAssistant.errorMessage));
    }

    this.clearActiveStreamPointers();
    return true;
  }

  private buildSyntheticCompletedAssistant(
    snapshot: AgentStateSnapshot,
  ): (MessageRow & { role: "assistant" }) | undefined {
    if (snapshot.error || this.lastTerminalStatus) {
      return undefined;
    }

    const currentAssistantId = this.currentAssistantMessageId;
    const lastDraftAssistant = this.lastDraftAssistant;

    if (!currentAssistantId || !lastDraftAssistant) {
      return undefined;
    }

    if (lastDraftAssistant.stopReason !== "stop" && lastDraftAssistant.stopReason !== "length") {
      return undefined;
    }

    if (!hasMeaningfulAssistantDraft(lastDraftAssistant)) {
      return undefined;
    }

    const row = toMessageRow(
      this.session.id,
      {
        ...lastDraftAssistant,
        id: currentAssistantId,
        model: this.session.model,
        provider: this.session.provider,
      },
      "completed",
      currentAssistantId,
    );

    return row.role === "assistant" ? row : undefined;
  }

  private async persistSessionBoundary(
    overrides: Pick<SessionData, "error" | "isStreaming">,
    changedMessages: Array<MessageRow>,
    rowsForDerivation?: Array<MessageRow>,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    const nextSessionBase = {
      ...this.session,
      error: overrides.error,
      isStreaming: overrides.isStreaming,
      updatedAt: getIsoNow(),
    };

    const allRows =
      rowsForDerivation ??
      (await getSessionMessages(this.session.id)).map((message) => {
        const changedMessage = changedMessages.find((candidate) => candidate.id === message.id);
        return changedMessage ?? message;
      });

    if (this.disposed) {
      return;
    }

    this.session = buildPersistedSession(nextSessionBase, allRows);

    this.persistQueue = this.persistQueue.then(async () => {
      if (this.disposed) {
        return;
      }

      if (changedMessages.length > 0) {
        await putSessionAndMessages(this.session, changedMessages);

        for (const message of changedMessages) {
          this.persistedMessageIds.add(message.id);
        }
        return;
      }

      await putSession(this.session);
    });

    await this.persistQueue;
  }

  private async buildRepairRows(
    errorMessage: string,
    snapshot?: AgentStateSnapshot,
  ): Promise<MessageRow[]> {
    const persistedRows = await getSessionMessages(this.session.id);
    const rowsById = new Map<string, MessageRow>();

    for (const row of persistedRows) {
      rowsById.set(row.id, row);
    }

    if (snapshot) {
      for (const row of this.buildCurrentRows({
        ...snapshot,
        error: snapshot.error ?? errorMessage,
        isStreaming: false,
      })) {
        rowsById.set(row.id, row);
      }
    } else {
      const currentAssistantRow = this.buildCurrentAssistantRow({
        error: errorMessage,
        isStreaming: false,
        messages: [],
        streamMessage: null,
      });

      if (currentAssistantRow) {
        rowsById.set(currentAssistantRow.id, currentAssistantRow);
      }
    }

    return pruneOrphanToolResults(
      [...rowsById.values()]
        .map((row) => rewriteStreamingAssistantRow(this.session.id, row, errorMessage))
        .sort(sortByTimestamp),
    );
  }

  private async recordAssistantUsageForRows(rows: Array<MessageRow>): Promise<void> {
    for (const row of rows) {
      if (row.role !== "assistant") {
        continue;
      }

      await this.recordAssistantUsage(row);
    }
  }

  private async recordAssistantUsage(message: MessageRow & { role: "assistant" }): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (message.usage.cost.total <= 0 || this.recordedAssistantMessageIds.has(message.id)) {
      return;
    }

    this.recordedAssistantMessageIds.add(message.id);
    await recordUsage(message.usage, this.session.provider, this.session.model, message.timestamp);
  }

  private clearActiveStreamPointers(): void {
    this.currentAssistantMessageId = undefined;
    this.currentTurnId = undefined;
    this.lastDraftAssistant = undefined;
    this.lastTerminalStatus = undefined;
  }
}
