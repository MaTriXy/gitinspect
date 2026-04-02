import type { ChatMessage } from "@gitinspect/pi/types/chat";
import { getAssistantText, getUserText } from "@gitinspect/pi/lib/chat-adapter";

export function messagesToMarkdown(messages: readonly ChatMessage[]): string {
  const parts: string[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user":
        parts.push(`## User\n\n${getUserText(message)}`);
        break;
      case "assistant": {
        const text = getAssistantText(message);
        if (text.trim()) {
          parts.push(`## Assistant\n\n${text}`);
        }
        break;
      }
      case "system":
        parts.push(`> **System:** ${message.message}`);
        break;
      case "toolResult":
        break;
    }
  }

  return parts.join("\n\n---\n\n") + "\n";
}

export async function copySessionToClipboard(messages: readonly ChatMessage[]): Promise<void> {
  const markdown = messagesToMarkdown(messages);
  await navigator.clipboard.writeText(markdown);
}
