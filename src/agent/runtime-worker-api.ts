import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { MessageRow, SessionData } from "@/types/storage"
import { AgentHost } from "@/agent/agent-host"
import { BusyRuntimeError } from "@/agent/runtime-command-errors"
import { logRuntimeDebug } from "@/lib/runtime-debug"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import { loadSessionWithMessages } from "@/sessions/session-service"
import { reconcileInterruptedSession } from "@/sessions/session-notices"

let host: AgentHost | undefined
let activeSessionId: string | undefined
let lifecycleChain = Promise.resolve()

function queueLifecycle<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = lifecycleChain.then(task, task)
  lifecycleChain = nextTask.then(
    () => undefined,
    () => undefined
  )
  return nextTask
}

function disposeHost(): void {
  host?.dispose()
  host = undefined
}

async function createHost(
  session: SessionData,
  messages: MessageRow[]
): Promise<AgentHost> {
  const githubRuntimeToken = await getGithubPersonalAccessToken()
  return new AgentHost(session, messages, {
    getGithubToken: getGithubPersonalAccessToken,
    githubRuntimeToken,
  })
}

async function loadReconciledSession(
  sessionId: string
): Promise<{ messages: MessageRow[]; session: SessionData } | undefined> {
  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded) {
    return undefined
  }

  if (!loaded.session.isStreaming) {
    return loaded
  }

  await reconcileInterruptedSession(sessionId)
  return await loadSessionWithMessages(sessionId)
}

export async function initFromStorage(sessionId: string): Promise<boolean> {
  return await queueLifecycle(async () => {
    if (host && activeSessionId === sessionId) {
      return true
    }

    disposeHost()
    activeSessionId = sessionId

    const loaded = await loadReconciledSession(sessionId)

    if (!loaded) {
      activeSessionId = undefined
      return false
    }

    host = await createHost(loaded.session, loaded.messages)
    return true
  })
}

export async function initFromSession(session: SessionData): Promise<void> {
  await queueLifecycle(async () => {
    if (host && activeSessionId === session.id) {
      return
    }

    disposeHost()
    activeSessionId = session.id
    host = await createHost(session, [])
  })
}

function requireHost(options: { idle?: boolean } = {}): AgentHost {
  if (!host || !activeSessionId) {
    throw new Error("Worker not initialized")
  }

  if (options.idle && host.isBusy()) {
    throw new BusyRuntimeError(activeSessionId)
  }

  return host
}

export async function startTurn(content: string): Promise<void> {
  logRuntimeDebug("prompt_started", {
    contentLength: content.trim().length,
    sessionId: activeSessionId,
  })
  await requireHost({ idle: true }).startTurn(content)
}

export function abort(): Promise<void> {
  host?.abort()
  return Promise.resolve()
}

export async function dispose(): Promise<void> {
  await queueLifecycle(async () => {
    disposeHost()
    activeSessionId = undefined
  })
}

export async function setModelSelection(
  providerGroup: ProviderGroupId,
  modelId: string
): Promise<void> {
  await requireHost({ idle: true }).setModelSelection(providerGroup, modelId)
}

export async function refreshGithubToken(): Promise<void> {
  await requireHost({ idle: true }).refreshGithubToken()
}

export async function setThinkingLevel(
  thinkingLevel: ThinkingLevel
): Promise<void> {
  await requireHost({ idle: true }).setThinkingLevel(thinkingLevel)
}
