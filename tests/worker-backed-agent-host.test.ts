import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeWorkerEvents, WorkerSnapshotEnvelope } from "@/agent/runtime-worker-types";
import type { MessageRow, SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";

const workerStartTurn = vi.fn(
  async (
    _input: {
      githubRuntimeToken?: string;
      messages: MessageRow[];
      session: SessionData;
      turn: {
        assistantMessageId: string;
        turnId: string;
        userMessage: {
          content: string;
          id: string;
          role: "user";
          timestamp: number;
        };
      };
    },
    _events: RuntimeWorkerEvents,
  ): Promise<void> => {},
);
const workerWaitForTurn = vi.fn(
  async (_sessionId: string): Promise<WorkerSnapshotEnvelope | undefined> => undefined,
);
const workerAbortTurn = vi.fn(async (_sessionId: string): Promise<void> => {});
const workerDisposeSession = vi.fn(async (_sessionId: string): Promise<void> => {});
const workerSetModelSelection = vi.fn(
  async (_input: {
    modelId: string;
    providerGroup: SessionData["providerGroup"];
    sessionId: string;
  }): Promise<void> => {},
);
const workerSetThinkingLevel = vi.fn(
  async (_input: {
    sessionId: string;
    thinkingLevel: SessionData["thinkingLevel"];
  }): Promise<void> => {},
);
const workerRefreshGithubToken = vi.fn(
  async (_input: { sessionId: string; token?: string }): Promise<void> => {},
);

let persistenceSession: SessionData;
const persistenceCreateTurn = vi.fn((content: string) => ({
  assistantMessageId: "assistant-1",
  turnId: "turn-1",
  userMessage: {
    content,
    id: "user-1",
    role: "user" as const,
    timestamp: 1,
  },
}));
const persistenceBeginTurn = vi.fn(async () => {
  persistenceSession = {
    ...persistenceSession,
    isStreaming: true,
  };
});
const persistenceGetSeedMessages = vi.fn((): MessageRow[] => []);
const persistenceAppendSystemNoticeFromError = vi.fn(async (_error: Error): Promise<void> => {});
const persistenceApplySnapshot = vi.fn(
  async (_envelope: {
    snapshot: WorkerSnapshotEnvelope["snapshot"];
    terminalStatus?: WorkerSnapshotEnvelope["terminalStatus"];
  }): Promise<void> => {},
);
const persistencePersistCurrentTurnBoundary = vi.fn(
  async (_snapshot: WorkerSnapshotEnvelope["snapshot"]): Promise<boolean> => {
    persistenceSession = {
      ...persistenceSession,
      isStreaming: false,
    };
    return true;
  },
);
const persistenceRepairTurnFailure = vi.fn(
  async (
    _error: Error | string,
    _snapshot?: WorkerSnapshotEnvelope["snapshot"],
  ): Promise<void> => {},
);
const persistenceUpdateModelSelection = vi.fn(
  async (_providerGroup: SessionData["providerGroup"], _modelId: string): Promise<void> => {},
);
const persistenceUpdateThinkingLevel = vi.fn(
  async (_thinkingLevel: SessionData["thinkingLevel"]): Promise<void> => {},
);
const persistenceRotateStreamingAssistantDraft = vi.fn((): void => {});
const persistenceFlush = vi.fn(async (): Promise<void> => {});
const persistenceDispose = vi.fn((): void => {});

vi.mock("@/agent/runtime-worker-client", () => ({
  createRuntimeWorkerEvents: (sink: RuntimeWorkerEvents): RuntimeWorkerEvents => sink,
  getRuntimeWorker: () => ({
    abortTurn: workerAbortTurn,
    disposeSession: workerDisposeSession,
    refreshGithubToken: workerRefreshGithubToken,
    setModelSelection: workerSetModelSelection,
    setThinkingLevel: workerSetThinkingLevel,
    startTurn: workerStartTurn,
    waitForTurn: workerWaitForTurn,
  }),
}));

vi.mock("@/agent/agent-turn-persistence", () => ({
  AgentTurnPersistence: class {
    constructor(session: SessionData, _messages: MessageRow[]) {
      persistenceSession = session;
    }

    get session(): SessionData {
      return persistenceSession;
    }

    getSeedMessages(): MessageRow[] {
      return persistenceGetSeedMessages();
    }

    createTurn(content: string) {
      return persistenceCreateTurn(content);
    }

    beginTurn(turn: ReturnType<typeof persistenceCreateTurn>): Promise<void> {
      void turn;
      return persistenceBeginTurn();
    }

    appendSystemNoticeFromError(error: Error): Promise<void> {
      return persistenceAppendSystemNoticeFromError(error);
    }

    applySnapshot(envelope: {
      snapshot: WorkerSnapshotEnvelope["snapshot"];
      terminalStatus?: WorkerSnapshotEnvelope["terminalStatus"];
    }): Promise<void> {
      return persistenceApplySnapshot(envelope);
    }

    persistCurrentTurnBoundary(snapshot: WorkerSnapshotEnvelope["snapshot"]): Promise<boolean> {
      return persistencePersistCurrentTurnBoundary(snapshot);
    }

    repairTurnFailure(
      error: Error | string,
      snapshot?: WorkerSnapshotEnvelope["snapshot"],
    ): Promise<void> {
      return persistenceRepairTurnFailure(error, snapshot);
    }

    updateModelSelection(
      providerGroup: SessionData["providerGroup"],
      modelId: string,
    ): Promise<void> {
      return persistenceUpdateModelSelection(providerGroup, modelId);
    }

    updateThinkingLevel(thinkingLevel: SessionData["thinkingLevel"]): Promise<void> {
      return persistenceUpdateThinkingLevel(thinkingLevel);
    }

    rotateStreamingAssistantDraft(): void {
      persistenceRotateStreamingAssistantDraft();
    }

    flush(): Promise<void> {
      return persistenceFlush();
    }

    dispose(): void {
      persistenceDispose();
    }
  },
}));

vi.mock("@/repo/github-token", () => ({
  getGithubPersonalAccessToken: vi.fn(async () => undefined),
}));

function createSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.4",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

describe("WorkerBackedAgentHost", () => {
  beforeEach(() => {
    vi.resetModules();
    persistenceSession = createSession();
    workerStartTurn.mockReset();
    workerWaitForTurn.mockReset();
    workerAbortTurn.mockReset();
    workerDisposeSession.mockReset();
    workerSetModelSelection.mockReset();
    workerSetThinkingLevel.mockReset();
    workerRefreshGithubToken.mockReset();
    persistenceCreateTurn.mockClear();
    persistenceBeginTurn.mockClear();
    persistenceGetSeedMessages.mockClear();
    persistenceAppendSystemNoticeFromError.mockClear();
    persistenceApplySnapshot.mockClear();
    persistenceApplySnapshot.mockImplementation(
      async (envelope: {
        snapshot: WorkerSnapshotEnvelope["snapshot"];
        terminalStatus?: WorkerSnapshotEnvelope["terminalStatus"];
      }): Promise<void> => {
        persistenceSession = {
          ...persistenceSession,
          isStreaming: envelope.snapshot.isStreaming,
        };
      },
    );
    persistencePersistCurrentTurnBoundary.mockClear();
    persistencePersistCurrentTurnBoundary.mockImplementation(
      async (_snapshot: WorkerSnapshotEnvelope["snapshot"]): Promise<boolean> => {
        persistenceSession = {
          ...persistenceSession,
          isStreaming: false,
        };
        return true;
      },
    );
    persistenceRepairTurnFailure.mockClear();
    persistenceUpdateModelSelection.mockClear();
    persistenceUpdateThinkingLevel.mockClear();
    persistenceRotateStreamingAssistantDraft.mockClear();
    persistenceFlush.mockClear();
    persistenceDispose.mockClear();
  });

  it("finalizes from the envelope returned by waitForTurn before repairing", async () => {
    const streamingEnvelope: WorkerSnapshotEnvelope = {
      sessionId: "session-1",
      snapshot: {
        error: undefined,
        isStreaming: true,
        messages: [],
        streamMessage: null,
      },
    };
    const finalEnvelope: WorkerSnapshotEnvelope = {
      sessionId: "session-1",
      snapshot: {
        error: undefined,
        isStreaming: false,
        messages: [
          {
            content: "hello",
            role: "user",
            timestamp: 1,
          },
        ],
        streamMessage: null,
      },
    };

    workerStartTurn.mockImplementation(
      async (
        _input: {
          githubRuntimeToken?: string;
          messages: MessageRow[];
          session: SessionData;
          turn: {
            assistantMessageId: string;
            turnId: string;
            userMessage: {
              content: string;
              id: string;
              role: "user";
              timestamp: number;
            };
          };
        },
        events: RuntimeWorkerEvents,
      ): Promise<void> => {
        await events.pushSnapshot(streamingEnvelope);
      },
    );
    workerWaitForTurn.mockResolvedValue(finalEnvelope);

    const { WorkerBackedAgentHost } = await import("@/agent/worker-backed-agent-host");
    const host = new WorkerBackedAgentHost(createSession(), []);

    await host.startTurn("hello");
    await host.waitForTurn();

    expect(persistenceApplySnapshot).toHaveBeenCalledWith({
      snapshot: streamingEnvelope.snapshot,
      terminalStatus: undefined,
    });
    expect(persistencePersistCurrentTurnBoundary).toHaveBeenCalledWith(finalEnvelope.snapshot);
    expect(persistenceRepairTurnFailure).not.toHaveBeenCalled();
  });

  it("persists terminal GitHub errors directly from the worker snapshot", async () => {
    const erroredEnvelope: WorkerSnapshotEnvelope = {
      sessionId: "session-1",
      snapshot: {
        error: "Authentication required: /",
        isStreaming: false,
        messages: [
          {
            content: "hello",
            role: "user",
            timestamp: 1,
          },
        ],
        streamMessage: null,
      },
      terminalStatus: "error",
    };

    workerStartTurn.mockImplementation(
      async (
        _input: {
          githubRuntimeToken?: string;
          messages: MessageRow[];
          session: SessionData;
          turn: {
            assistantMessageId: string;
            turnId: string;
            userMessage: {
              content: string;
              id: string;
              role: "user";
              timestamp: number;
            };
          };
        },
        events: RuntimeWorkerEvents,
      ): Promise<void> => {
        await events.pushSnapshot(erroredEnvelope);
      },
    );
    workerWaitForTurn.mockResolvedValue(erroredEnvelope);

    const { WorkerBackedAgentHost } = await import("@/agent/worker-backed-agent-host");
    const host = new WorkerBackedAgentHost(createSession(), []);

    await host.startTurn("hello");
    await host.waitForTurn();

    expect(persistenceApplySnapshot).toHaveBeenCalledWith({
      snapshot: erroredEnvelope.snapshot,
      terminalStatus: "error",
    });
    expect(persistencePersistCurrentTurnBoundary).not.toHaveBeenCalled();
    expect(persistenceRepairTurnFailure).not.toHaveBeenCalled();
  });
});
