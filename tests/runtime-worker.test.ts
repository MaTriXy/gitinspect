import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { AssistantMessage } from "@/types/chat";
import type { SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";
import { TEST_REPO_SOURCE } from "./repo-test-utils";

type MockAgentEvent =
  | {
      message: AssistantMessage;
      type: "message_end";
    }
  | {
      toolResults: Array<{ toolCallId: string }>;
      type: "turn_end";
    }
  | {
      type: "stream_update";
    };

type MockAgentState = {
  error: string | undefined;
  isStreaming: boolean;
  messages: Array<Message>;
  model: {
    id: string;
    provider: string;
  };
  streamMessage: AgentMessage | null;
  thinkingLevel: "medium";
};

type MockAgentClass = {
  abort: () => void;
  prompt: (message: Message & { id: string }) => Promise<void>;
  sessionId: string;
  setModel: (model: { id: string; provider: string }) => void;
  setThinkingLevel: (thinkingLevel: "medium" | "off" | "high") => void;
  setTools: (tools: Array<AgentTool>) => void;
  state: MockAgentState;
  subscribe: (listener: (event: MockAgentEvent) => void) => () => void;
};

type Subscriber = (event: MockAgentEvent) => void;

let subscriber: Subscriber | undefined;
let resolvePrompt: (() => void) | undefined;
let onRepoError: ((error: unknown) => void | Promise<void>) | undefined;

const agentState: MockAgentState = {
  error: undefined,
  isStreaming: false,
  messages: [],
  model: {
    id: "gpt-5.4",
    provider: "openai-codex",
  },
  streamMessage: null,
  thinkingLevel: "medium",
};

const promptMock = vi.fn(async (_message: Message & { id: string }): Promise<void> => {});
const abortMock = vi.fn(() => {});
const setModelMock = vi.fn((_model: { id: string; provider: string }): void => {});
const setThinkingLevelMock = vi.fn((_thinkingLevel: "medium" | "off" | "high"): void => {});
const setToolsMock = vi.fn((_tools: Array<AgentTool>): void => {});

vi.mock("@/auth/resolve-api-key", () => ({
  resolveApiKeyForProvider: vi.fn(async () => undefined),
}));

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: class {
    state = agentState;
    sessionId = "";

    constructor() {}

    subscribe(listener: Subscriber) {
      subscriber = listener;
      return () => {
        subscriber = undefined;
      };
    }

    prompt = promptMock;
    abort = abortMock;
    setModel = setModelMock;
    setThinkingLevel = setThinkingLevelMock;
    setTools = setToolsMock;
  } satisfies new () => MockAgentClass,
}));

vi.mock("@/tools", () => ({
  createRepoTools: vi.fn(
    (
      _runtime: unknown,
      options?: {
        onRepoError?: (error: unknown) => void | Promise<void>;
      },
    ) => {
      onRepoError = options?.onRepoError;

      return {
        agentTools: [] as AgentTool[],
      };
    },
  ),
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

function createAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text: "Done", type: "text" }],
    id: "assistant-1",
    model: "gpt-5.4",
    provider: "openai-codex",
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  };
}

function createTurn() {
  return {
    assistantMessageId: "assistant-streaming",
    turnId: "turn-1",
    userMessage: {
      content: "hello",
      id: "user-1",
      role: "user" as const,
      timestamp: 1,
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runtime worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    promptMock.mockReset();
    abortMock.mockReset();
    setModelMock.mockClear();
    setThinkingLevelMock.mockClear();
    setToolsMock.mockClear();
    subscriber = undefined;
    resolvePrompt = undefined;
    onRepoError = undefined;
    agentState.error = undefined;
    agentState.isStreaming = false;
    agentState.messages = [];
    agentState.streamMessage = null;
  });

  it("coalesces frequent stream updates into buffered snapshots", async () => {
    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;

      for (const text of ["A", "AB", "ABC"]) {
        agentState.streamMessage = createAssistantMessage({
          content: [{ text, type: "text" }],
          id: "assistant-stream",
          stopReason: "toolUse",
        });
        subscriber?.({ type: "stream_update" });
      }

      await new Promise<void>((resolve) => {
        resolvePrompt = () => {
          agentState.isStreaming = false;
          agentState.streamMessage = null;
          const assistant = createAssistantMessage({
            content: [{ text: "Finished", type: "text" }],
            id: "assistant-final",
          });
          agentState.messages = [
            {
              content: "hello",
              role: "user",
              timestamp: 1,
            },
            assistant,
          ];
          subscriber?.({
            message: assistant,
            type: "message_end",
          });
          resolve();
        };
      });
    });

    const worker = await import("@/agent/runtime-worker");
    const pushSnapshot = vi.fn(async () => {});

    await worker.startTurn(
      {
        messages: [],
        session: {
          ...createSession(),
          repoSource: {
            ...TEST_REPO_SOURCE,
            owner: "acme",
            repo: "demo",
          },
        },
        turn: createTurn(),
      },
      { pushSnapshot },
    );

    expect(pushSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(49);
    expect(pushSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(pushSnapshot).toHaveBeenCalledTimes(1);

    resolvePrompt?.();
    await flushMicrotasks();
    await worker.waitForTurn("session-1");

    expect(pushSnapshot).toHaveBeenCalled();
    await worker.disposeSession("session-1");
  });

  it("flushes tool-result boundaries immediately", async () => {
    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;
      agentState.streamMessage = createAssistantMessage({
        content: [{ text: "Reading", type: "text" }],
        id: "assistant-stream",
        stopReason: "toolUse",
      });
      subscriber?.({
        toolResults: [{ toolCallId: "call-1" }],
        type: "turn_end",
      });
      await new Promise<void>(() => {});
    });

    const worker = await import("@/agent/runtime-worker");
    const pushSnapshot = vi.fn(async () => {});

    await worker.startTurn(
      {
        messages: [],
        session: {
          ...createSession(),
          repoSource: {
            ...TEST_REPO_SOURCE,
            owner: "acme",
            repo: "demo",
          },
        },
        turn: createTurn(),
      },
      { pushSnapshot },
    );
    await flushMicrotasks();

    expect(pushSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        rotateStreamingAssistantDraft: true,
        sessionId: "session-1",
      }),
    );

    await worker.disposeSession("session-1");
  });

  it("emits aborted terminal status when a turn is aborted", async () => {
    abortMock.mockImplementation(() => {
      agentState.isStreaming = false;
      agentState.streamMessage = null;
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
      ];
      subscriber?.({ type: "stream_update" });
      resolvePrompt?.();
    });

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;
      agentState.streamMessage = createAssistantMessage({
        content: [{ text: "Partial", type: "text" }],
        id: "assistant-stream",
        stopReason: "toolUse",
      });
      subscriber?.({ type: "stream_update" });

      await new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      });
    });

    const worker = await import("@/agent/runtime-worker");
    const pushSnapshot = vi.fn(async () => {});

    await worker.startTurn(
      {
        messages: [],
        session: {
          ...createSession(),
          repoSource: {
            ...TEST_REPO_SOURCE,
            owner: "acme",
            repo: "demo",
          },
        },
        turn: createTurn(),
      },
      { pushSnapshot },
    );

    await worker.abortTurn("session-1");
    await flushMicrotasks();
    await worker.waitForTurn("session-1");

    expect(pushSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        terminalStatus: "aborted",
      }),
    );

    await worker.disposeSession("session-1");
  });

  it("stops streaming on the first actionable GitHub repo error", async () => {
    abortMock.mockImplementation(() => {
      agentState.isStreaming = false;
      agentState.streamMessage = null;
    });
    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;
      agentState.streamMessage = createAssistantMessage({
        content: [{ text: "Reading...", type: "text" }],
        id: "assistant-stream",
        stopReason: "toolUse",
      });

      await new Promise<void>(() => {});
    });

    const worker = await import("@/agent/runtime-worker");
    const repoModule = await import("@/lib/github");
    const pushSnapshot = vi.fn(async () => {});

    await worker.startTurn(
      {
        messages: [],
        session: {
          ...createSession(),
          repoSource: {
            ...TEST_REPO_SOURCE,
            owner: "acme",
            repo: "demo",
          },
        },
        turn: createTurn(),
      },
      { pushSnapshot },
    );

    expect(onRepoError).toBeTypeOf("function");

    await onRepoError?.(new repoModule.GitHubFsError("EACCES", "Authentication required: /", "/"));
    await flushMicrotasks();

    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(pushSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeErrors: [
          expect.objectContaining({
            code: "EACCES",
            kind: "permission",
            message: "Authentication required: /",
            path: "/",
            type: "github",
          }),
        ],
        snapshot: expect.objectContaining({
          error: "Authentication required: /",
        }),
        terminalStatus: "error",
      }),
    );

    await worker.disposeSession("session-1");
  });
});
