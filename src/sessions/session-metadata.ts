import { getMessageText } from "@/lib/preview"
import { truncateText } from "@/lib/title"
import type { ChatMessage } from "@/types/chat"

export function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")

  if (!firstUser) {
    return "New chat"
  }

  const text = getMessageText(firstUser)

  if (!text) {
    return "New chat"
  }

  return truncateText(text, 50)
}

export function buildPreview(messages: ChatMessage[]): string {
  return truncateText(
    messages
      .filter(
        (message) => message.role === "assistant" || message.role === "user"
      )
      .map((message) => getMessageText(message))
      .filter(Boolean)
      .join("\n"),
    2048
  )
}

export function hasPersistableExchange(messages: ChatMessage[]): boolean {
  return (
    messages.some((message) => message.role === "user") &&
    messages.some((message) => message.role === "assistant")
  )
}
