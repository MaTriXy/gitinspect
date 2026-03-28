import type {
  AssistantMessage,
  ChatMessage,
  SystemMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@/types/chat"

export function getUserText(message: UserMessage): string {
  if (typeof message.content === "string") {
    return message.content
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function getAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("\n")
}

export function getAssistantToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter(
    (part): part is ToolCall => part.type === "toolCall"
  )
}

function collectToolResultsForAssistant(
  message: AssistantMessage,
  followingMessages: readonly ChatMessage[]
): Map<string, ToolResultMessage> {
  const toolCalls = getAssistantToolCalls(message)
  const toolResults = new Map<string, ToolResultMessage>()

  if (toolCalls.length === 0) {
    return toolResults
  }

  for (const next of followingMessages) {
    if (next.role === "assistant") {
      break
    }

    if (next.role === "system") {
      continue
    }

    if (next.role !== "toolResult" || toolResults.has(next.toolCallId)) {
      continue
    }

    if (next.parentAssistantId === message.id) {
      toolResults.set(next.toolCallId, next)
    }
  }

  return toolResults
}

export function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function isToolResultMessage(
  message: ChatMessage
): message is ToolResultMessage {
  return message.role === "toolResult"
}

export function isSystemMessage(
  message: ChatMessage
): message is SystemMessage {
  return message.role === "system"
}

export interface SourceRef {
  href: string
  title: string
}

export interface DerivedAssistantView {
  reasoning: string
  sources: readonly SourceRef[]
  text: string
  toolExecutions: ReadonlyArray<{
    toolCall: ToolCall
    toolResult?: ToolResultMessage
  }>
  versions: readonly string[]
}

export function deriveAssistantView(
  message: AssistantMessage,
  followingMessages: readonly ChatMessage[] = []
): DerivedAssistantView {
  const text = getAssistantText(message)
  const toolCalls = getAssistantToolCalls(message)
  const toolResults = collectToolResultsForAssistant(message, followingMessages)

  return {
    reasoning: getAssistantThinking(message),
    sources: [],
    text,
    toolExecutions: toolCalls.map((toolCall) => ({
      toolCall,
      toolResult: toolResults.get(toolCall.id),
    })),
    versions: [text] as const,
  }
}

export function getFoldedToolResultIds(
  messages: readonly ChatMessage[]
): ReadonlySet<string> {
  const foldedIds = new Set<string>()

  messages.forEach((message, index) => {
    if (message.role !== "assistant") {
      return
    }

    const toolResults = collectToolResultsForAssistant(
      message,
      messages.slice(index + 1)
    )

    for (const toolResult of toolResults.values()) {
      foldedIds.add(toolResult.id)
    }
  })

  return foldedIds
}
