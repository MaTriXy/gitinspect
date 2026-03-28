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
import type { BootstrapStatus, MessageRow } from "@/types/storage"
import type { SessionData } from "@/types/storage"

type AppendSessionNoticeOptions = {
  bootstrapStatus?: BootstrapStatus
  clearStreaming?: boolean
  rewriteStreamingAssistant?: boolean
}

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

async function writeSessionNotice(
  session: SessionData,
  messages: MessageRow[],
  notice: MessageRow,
  bootstrapStatus: BootstrapStatus | undefined,
  clearStreaming: boolean
): Promise<void> {
  const nextSessionBase = {
    ...session,
    bootstrapStatus: bootstrapStatus ?? session.bootstrapStatus,
    error: undefined,
    isStreaming: clearStreaming ? false : session.isStreaming,
    updatedAt: getIsoNow(),
  }
  const nextMessages = [...messages, notice]
  const nextSession = buildPersistedSession(nextSessionBase, nextMessages)

  await putSessionAndMessages(nextSession, nextMessages)
}

export async function appendSessionNotice(
  sessionId: string,
  error: unknown,
  options: AppendSessionNoticeOptions = {}
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

  const nextMessages = options.rewriteStreamingAssistant
    ? rewriteStreamingAssistantRows(loaded.messages, classified.message)
    : loaded.messages

  await writeSessionNotice(
    loaded.session,
    nextMessages,
    notice,
    options.bootstrapStatus,
    options.clearStreaming ?? false
  )
}

export async function reconcileInterruptedSession(
  sessionId: string
): Promise<void> {
  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded || !loaded.session.isStreaming) {
    return
  }

  await appendSessionNotice(sessionId, new StreamInterruptedRuntimeError(), {
    bootstrapStatus:
      loaded.session.bootstrapStatus === "bootstrap" ? "failed" : "ready",
    clearStreaming: true,
    rewriteStreamingAssistant: true,
  })
}
