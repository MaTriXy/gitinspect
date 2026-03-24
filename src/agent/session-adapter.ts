import type { AgentMessage, AgentState, AgentTool } from "@mariozechner/pi-agent-core"
import type { Message, Model } from "@mariozechner/pi-ai"
import { SYSTEM_PROMPT } from "@/agent/system-prompt"
import { getIsoNow } from "@/lib/dates"
import { getCanonicalProvider, getDefaultProviderGroup } from "@/models/catalog"
import { buildPersistedSession } from "@/sessions/session-service"
import type {
  AssistantMessage,
  ChatMessage,
  ToolResultMessage,
  UserMessage,
} from "@/types/chat"
import type { SessionData } from "@/types/storage"

function isLlmMessage(message: AgentMessage): message is Message {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    (message.role === "assistant" ||
      message.role === "toolResult" ||
      message.role === "user")
  )
}

function getStableMessageId(message: Message, index: number): string {
  if ("id" in message && typeof message.id === "string") {
    return message.id
  }

  switch (message.role) {
    case "assistant":
      return `assistant-${message.timestamp}-${index}`
    case "toolResult":
      return `tool-result-${message.toolCallId}-${index}`
    case "user":
      return `user-${message.timestamp}-${index}`
  }
}

function normalizeMessage(message: Message, index: number): ChatMessage {
  const id = getStableMessageId(message, index)

  switch (message.role) {
    case "assistant":
      return {
        ...message,
        id,
      } satisfies AssistantMessage
    case "toolResult":
      return {
        ...message,
        id,
      } satisfies ToolResultMessage
    case "user":
      return {
        ...message,
        id,
      } satisfies UserMessage
  }
}

function normalizeMessages(messages: AgentMessage[]): ChatMessage[] {
  return messages
    .filter(isLlmMessage)
    .map((message, index) => normalizeMessage(message, index))
}

export function buildInitialAgentState(
  session: SessionData,
  model: Model<any>,
  tools: AgentTool[]
): Partial<AgentState> {
  return {
    messages: session.messages,
    model,
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: session.thinkingLevel,
    tools,
  }
}

export function buildSessionFromAgentState(
  previousSession: SessionData,
  agentState: AgentState
): SessionData {
  return buildPersistedSession({
    ...previousSession,
    messages: normalizeMessages(agentState.messages),
    model: agentState.model.id,
    provider: getCanonicalProvider(
      previousSession.providerGroup ??
        getDefaultProviderGroup(
          agentState.model.provider as SessionData["provider"]
        )
    ),
    providerGroup:
      previousSession.providerGroup ??
      getDefaultProviderGroup(
        agentState.model.provider as SessionData["provider"]
      ),
    thinkingLevel: agentState.thinkingLevel,
    updatedAt: getIsoNow(),
  })
}
