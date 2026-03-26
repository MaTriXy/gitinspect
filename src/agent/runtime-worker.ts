import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import { AgentHost } from "@/agent/agent-host"
import { BusyRuntimeError } from "@/agent/runtime-command-errors"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import { loadSessionWithMessages } from "@/sessions/session-service"

let host: AgentHost | undefined
let activeSessionId: string | undefined

export async function init(id: string): Promise<boolean> {
  if (host && activeSessionId === id) {
    return true
  }

  if (host) {
    host.dispose()
    host = undefined
  }

  activeSessionId = id
  const loaded = await loadSessionWithMessages(id)

  if (!loaded) {
    activeSessionId = undefined
    return false
  }

  const githubRuntimeToken = await getGithubPersonalAccessToken()
  host = new AgentHost(loaded.session, loaded.messages, {
    getGithubToken: getGithubPersonalAccessToken,
    githubRuntimeToken,
  })

  return true
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

export async function send(content: string): Promise<void> {
  await requireHost({ idle: true }).prompt(content)
}

export function abort(): Promise<void> {
  host?.abort()
  return Promise.resolve()
}

export function dispose(): Promise<void> {
  host?.dispose()
  host = undefined
  activeSessionId = undefined
  return Promise.resolve()
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
