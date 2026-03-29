import { createId } from "@/lib/ids"
import { getIsoNow } from "@/lib/dates"
import { buildSystemMessage, classifyRuntimeError } from "@/agent/runtime-errors"
import { toMessageRow } from "@/agent/session-adapter"
import { StreamInterruptedRuntimeError } from "@/agent/runtime-command-errors"
import {
  buildPersistedSession,
  loadSessionWithMessages,
} from "@/sessions/session-service"
import { putSessionAndMessages } from "@/db/schema"
import type { MessageRow, SessionData } from "@/types/storage"

function isSystemFingerprintRow(
  message: MessageRow,
  fingerprint: string
): boolean {
  return message.role === "system" && message.fingerprint === fingerprint
}

function rewriteStreamingAssistantRows(
  messages: MessageRow[],
  errorMessage: string
): MessageRow[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || message.status !== "streaming") {
      return message
    }

    return toMessageRow(
      message.sessionId,
      {
        ...message,
        errorMessage,
        stopReason: "error",
      },
      "error",
      message.id
    )
  })
}

function mergeSessionRows(
  session: SessionData,
  messages: MessageRow[]
): SessionData {
  return buildPersistedSession(
    {
      ...session,
      error: undefined,
      updatedAt: getIsoNow(),
    },
    messages
  )
}

export async function appendSessionNotice(
  sessionId: string,
  error: Error | string
): Promise<void> {
  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded) {
    return
  }

  const classified = classifyRuntimeError(error)

  if (
    loaded.messages.some((message) =>
      isSystemFingerprintRow(message, classified.fingerprint)
    )
  ) {
    return
  }

  const notice = toMessageRow(
    sessionId,
    buildSystemMessage(classified, createId(), Date.now())
  )

  await putSessionAndMessages(
    mergeSessionRows(loaded.session, [...loaded.messages, notice]),
    [notice]
  )
}

export async function reconcileInterruptedSession(
  sessionId: string
): Promise<void> {
  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded || !loaded.session.isStreaming) {
    return
  }

  const interruption = new StreamInterruptedRuntimeError()
  const classified = classifyRuntimeError(interruption)
  const rewrittenMessages = rewriteStreamingAssistantRows(
    loaded.messages,
    classified.message
  )
  const changedMessages = rewrittenMessages.filter((message, index) => {
    const previous = loaded.messages[index]
    return JSON.stringify(previous) !== JSON.stringify(message)
  })
  const hasNotice = rewrittenMessages.some((message) =>
    isSystemFingerprintRow(message, classified.fingerprint)
  )
  const nextMessages = hasNotice
    ? rewrittenMessages
    : [
        ...rewrittenMessages,
        toMessageRow(
          sessionId,
          buildSystemMessage(classified, createId(), Date.now())
        ),
      ]
  const persistedChanges =
    hasNotice || nextMessages.length === rewrittenMessages.length
      ? changedMessages
      : [nextMessages[nextMessages.length - 1], ...changedMessages]

  await putSessionAndMessages(
    buildPersistedSession(
      {
        ...loaded.session,
        error: undefined,
        isStreaming: false,
        updatedAt: getIsoNow(),
      },
      nextMessages
    ),
    persistedChanges
  )
}
