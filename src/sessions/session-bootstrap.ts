import { BootstrapFailedRuntimeError } from "@/agent/runtime-command-errors"
import { runtimeClient } from "@/agent/runtime-client"
import { getCanonicalProvider } from "@/models/catalog"
import { resolveRepoSource } from "@/repo/settings"
import { appendSessionNotice } from "@/sessions/session-notices"
import {
  createSessionForChat,
  createSessionForRepo,
  type SessionCreationBase,
} from "@/sessions/session-actions"
import { persistSessionSnapshot } from "@/sessions/session-service"
import type { RepoTarget, SessionData } from "@/types/storage"

// Provisional sessions become ready only after prompt persistence; bootstrap failures stay chat-visible.
function toBootstrapFailure(error: unknown): BootstrapFailedRuntimeError {
  return new BootstrapFailedRuntimeError(
    error instanceof Error ? error.message : "Bootstrap failed"
  )
}

export async function bootstrapSessionAndSend(params: {
  content: string
  draft: SessionCreationBase
  repoTarget?: RepoTarget
}): Promise<SessionData> {
  const base = {
    model: params.draft.model,
    provider: getCanonicalProvider(
      params.draft.providerGroup ?? params.draft.provider
    ),
    providerGroup: params.draft.providerGroup ?? params.draft.provider,
    thinkingLevel: params.draft.thinkingLevel,
  }

  let session: SessionData

  try {
    const repoSource = params.repoTarget
      ? await resolveRepoSource(params.repoTarget)
      : undefined

    session = repoSource
      ? await createSessionForRepo({
          base,
          owner: repoSource.owner,
          ref: repoSource.ref,
          repo: repoSource.repo,
        })
      : await createSessionForChat(base)
  } catch (error) {
    session = await createSessionForChat(base)
    await persistSessionSnapshot({
      ...session,
      bootstrapStatus: "bootstrap",
    })
    await appendSessionNotice(session.id, toBootstrapFailure(error), {
      bootstrapStatus: "failed",
      clearStreaming: true,
      rewriteStreamingAssistant: true,
    })
    return {
      ...session,
      bootstrapStatus: "failed",
    }
  }

  await persistSessionSnapshot({
    ...session,
    bootstrapStatus: "bootstrap",
  })

  void runtimeClient.send(session.id, params.content).catch(async (error) => {
    try {
      await appendSessionNotice(session.id, toBootstrapFailure(error), {
        bootstrapStatus: "failed",
        clearStreaming: true,
        rewriteStreamingAssistant: true,
      })
    } catch (noticeError) {
      console.error("[gitinspect:first-send] bootstrap_notice_failed", {
        error,
        noticeError,
        sessionId: session.id,
      })
    }
  })

  return {
    ...session,
    bootstrapStatus: "bootstrap",
  }
}
