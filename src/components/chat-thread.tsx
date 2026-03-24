import type { AssistantMessage, ChatMessage } from "@/types/chat"
import { formatDistanceToNow } from "date-fns"
import { ToolCallBubble } from "@/components/tool-call-bubble"
import { ToolResultBubble } from "@/components/tool-result-bubble"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"

function MessageBubble({ message }: { message: ChatMessage }) {
  const timestamp = formatDistanceToNow(message.timestamp, {
    addSuffix: true,
  })

  if (message.role === "assistant") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    const toolCalls = message.content.filter((part) => part.type === "toolCall")

    return (
      <div className="flex flex-col gap-2 border-l border-foreground/10 pl-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Assistant</span>
          <span>{timestamp}</span>
          <Badge className="rounded-none" variant="outline">
            ${message.usage.cost.total.toFixed(4)}
          </Badge>
        </div>
        {text ? (
          <div className="whitespace-pre-wrap text-sm leading-6">{text}</div>
        ) : null}
        {toolCalls.map((toolCall) => (
          <ToolCallBubble key={toolCall.id} toolCall={toolCall} />
        ))}
        {message.errorMessage ? (
          <div className="text-xs text-destructive">{message.errorMessage}</div>
        ) : null}
      </div>
    )
  }

  if (message.role === "user") {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")

    return (
      <div className="flex flex-col gap-2 border-l border-foreground/10 pl-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>User</span>
          <span>{timestamp}</span>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-6">{text}</div>
      </div>
    )
  }

  return <ToolResultBubble message={message} />
}

function mergeMessages(
  messages: ChatMessage[],
  draftAssistantMessage: AssistantMessage | undefined
) {
  if (!draftAssistantMessage) {
    return messages
  }

  const existingIndex = messages.findIndex(
    (message) => message.id === draftAssistantMessage.id
  )

  if (existingIndex < 0) {
    return [...messages, draftAssistantMessage]
  }

  return messages.map((message, index) =>
    index === existingIndex ? draftAssistantMessage : message
  )
}

export function ChatThread(props: {
  draftAssistantMessage?: AssistantMessage
  isStreaming: boolean
  messages: ChatMessage[]
}) {
  const mergedMessages = mergeMessages(props.messages, props.draftAssistantMessage)

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
        {mergedMessages.length === 0 ? (
          <div className="border border-dashed border-foreground/15 bg-card/50 p-6 text-sm text-muted-foreground">
            Pick a provider, connect credentials in Settings, then send the first
            message. Sessions are stored locally and resume after reload.
          </div>
        ) : null}
        {mergedMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {props.isStreaming ? (
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Streaming…
          </div>
        ) : null}
      </div>
    </ScrollArea>
  )
}
