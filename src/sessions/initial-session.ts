import { getSetting, listProviderKeys } from "@/db/schema"
import {
  getCanonicalProvider,
  getConnectedProviders,
  getDefaultModelForGroup,
  getDefaultProviderGroup,
  getPreferredProviderGroup,
  getProviderGroups,
  getVisibleProviderGroups,
  hasModelForGroup,
  isProviderGroupId,
} from "@/models/catalog"
import { normalizeRepoSource } from "@/repo/settings"
import { parsedPathToRepoSource, parseRepoPathname } from "@/repo/url"
import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { SessionData } from "@/types/storage"
import {
  createSession,
  loadMostRecentSession,
  loadSession,
  persistSessionSnapshot,
} from "@/sessions/session-service"

function isProviderId(value: string): value is ProviderId {
  return (
    getProviderGroups().includes(value as ProviderGroupId) &&
    value !== "opencode-free"
  )
}

function normalizeVisibleSession(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>
): SessionData {
  const fallbackProviderGroup = visibleProviderGroups[0] ?? "opencode-free"
  const currentProviderGroup = session.providerGroup ?? session.provider
  const providerGroup = visibleProviderGroups.includes(currentProviderGroup)
    ? currentProviderGroup
    : fallbackProviderGroup
  const model = hasModelForGroup(providerGroup, session.model)
    ? session.model
    : getDefaultModelForGroup(providerGroup).id

  if (providerGroup === currentProviderGroup && model === session.model) {
    return session
  }

  return {
    ...session,
    model,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  }
}

export async function persistVisibleSessionSelection(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>
): Promise<SessionData> {
  const normalized = normalizeVisibleSession(session, visibleProviderGroups)

  if (
    normalized.providerGroup !== session.providerGroup ||
    normalized.provider !== session.provider ||
    normalized.model !== session.model
  ) {
    await persistSessionSnapshot(normalized)
  }

  return normalized
}

export async function resolveProviderDefaults(): Promise<{
  model: string
  providerGroup: ProviderGroupId
  visibleProviderGroups: Array<ProviderGroupId>
}> {
  const providerKeys = await listProviderKeys()
  const connectedProviders = getConnectedProviders(providerKeys)
  const visibleProviderGroups = getVisibleProviderGroups(connectedProviders)
  const fallbackProviderGroup = getPreferredProviderGroup(connectedProviders)
  const storedProviderGroup = await getSetting("last-used-provider-group")
  const storedProvider = await getSetting("last-used-provider")
  const providerGroup =
    typeof storedProviderGroup === "string" &&
    isProviderGroupId(storedProviderGroup) &&
    visibleProviderGroups.includes(storedProviderGroup)
      ? storedProviderGroup
      : typeof storedProvider === "string" && isProviderId(storedProvider)
        ? (() => {
            const nextProviderGroup = getDefaultProviderGroup(storedProvider)
            return visibleProviderGroups.includes(nextProviderGroup)
              ? nextProviderGroup
              : fallbackProviderGroup
          })()
        : fallbackProviderGroup
  const storedModel = await getSetting("last-used-model")
  const model =
    typeof storedModel === "string" && hasModelForGroup(providerGroup, storedModel)
      ? storedModel
      : getDefaultModelForGroup(providerGroup).id

  return { model, providerGroup, visibleProviderGroups }
}

function isLandingPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/"
  return p === "/"
}

function isChatPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/"
  return p === "/chat"
}

/**
 * Session bootstrap from the current URL.
 * `/` is the landing page (no chat session).
 * Repo routes always create a new session for that repository.
 * `/chat` resumes `?session=`, else the most recent session, else a new empty chat (no repo).
 */
export async function loadInitialSessionFromLocation(location: {
  pathname: string
  search: string
}): Promise<SessionData | null> {
  if (isLandingPath(location.pathname)) {
    return null
  }

  const { model, providerGroup, visibleProviderGroups } =
    await resolveProviderDefaults()

  const parsedPath = parseRepoPathname(location.pathname)
  const normalizedPathRepo = parsedPath
    ? normalizeRepoSource(parsedPathToRepoSource(parsedPath))
    : undefined

  if (normalizedPathRepo) {
    const created = createSession({
      model,
      providerGroup,
      repoSource: normalizedPathRepo,
    })
    await persistSessionSnapshot(created)
    return await persistVisibleSessionSelection(created, visibleProviderGroups)
  }

  if (isChatPath(location.pathname)) {
    const requestedSessionId = new URLSearchParams(location.search).get("session")
    if (requestedSessionId) {
      const loaded = await loadSession(requestedSessionId)
      if (loaded) {
        return await persistVisibleSessionSelection(loaded, visibleProviderGroups)
      }
    }

    const recent = await loadMostRecentSession()
    if (recent) {
      return await persistVisibleSessionSelection(recent, visibleProviderGroups)
    }

    const created = createSession({
      model,
      providerGroup,
      repoSource: undefined,
    })
    await persistSessionSnapshot(created)
    return await persistVisibleSessionSelection(created, visibleProviderGroups)
  }

  return null
}
