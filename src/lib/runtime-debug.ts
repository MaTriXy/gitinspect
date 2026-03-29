type RuntimeDebugPhase =
  | "lease_claim_started"
  | "lease_claimed"
  | "prompt_persisted"
  | "prompt_started"
  | "runtime_initial_turn_accepted"
  | "runtime_initial_turn_failed"
  | "runtime_initial_turn_started"
  | "runtime_turn_accepted"
  | "runtime_turn_failed"
  | "runtime_turn_started"
  | "session_created"

export type RuntimeTraceDetails = Record<
  string,
  boolean | number | string | undefined
>

export interface RuntimeTurnTrace {
  checkpoint: (message: string, details?: RuntimeTraceDetails) => void
  end: (details?: RuntimeTraceDetails) => void
  endPhase: (phase: string, details?: RuntimeTraceDetails) => void
  id: string
  markOnce: (
    key: string,
    message: string,
    details?: RuntimeTraceDetails
  ) => boolean
  rootLabel: string
  startPhase: (phase: string, details?: RuntimeTraceDetails) => void
}

const activeRuntimeTraces = new Map<string, RuntimeTurnTrace>()

function normalizeDetails(
  details?: RuntimeTraceDetails
): RuntimeTraceDetails | undefined {
  if (!details) {
    return undefined
  }

  const normalized = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  ) as RuntimeTraceDetails

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function safeTime(label: string): void {
  try {
    console.time(label)
  } catch {
    // Ignore missing timer support in constrained test environments.
  }
}

function safeTimeEnd(label: string): void {
  try {
    console.timeEnd(label)
  } catch {
    // Ignore missing timer support in constrained test environments.
  }
}

function safeTimeLog(
  label: string,
  message: string,
  details?: RuntimeTraceDetails
): void {
  try {
    const normalized = normalizeDetails(details)

    if (normalized) {
      console.timeLog(label, message, normalized)
      return
    }

    console.timeLog(label, message)
  } catch {
    const normalized = normalizeDetails(details)

    if (normalized) {
      console.info(label, message, normalized)
      return
    }

    console.info(label, message)
  }
}

function logTraceInfo(
  label: string,
  message: string,
  details?: RuntimeTraceDetails
): void {
  const normalized = normalizeDetails(details)

  if (normalized) {
    console.info(label, message, normalized)
    return
  }

  console.info(label, message)
}

function createTraceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createRuntimeTrace(
  scope: string,
  details?: RuntimeTraceDetails
): RuntimeTurnTrace {
  const id = createTraceId()
  const rootLabel = `[gitinspect:trace ${scope}:${id}]`
  const activePhases = new Map<string, string>()
  const marks = new Set<string>()
  let finished = false

  safeTime(rootLabel)
  logTraceInfo(rootLabel, "start", details)

  const trace: RuntimeTurnTrace = {
    checkpoint(message, checkpointDetails) {
      if (finished) {
        return
      }

      safeTimeLog(rootLabel, message, checkpointDetails)
    },
    end(endDetails) {
      if (finished) {
        return
      }

      finished = true

      for (const label of activePhases.values()) {
        safeTimeEnd(label)
      }

      activePhases.clear()
      safeTimeEnd(rootLabel)
      logTraceInfo(rootLabel, "end", endDetails)
    },
    endPhase(phase, phaseDetails) {
      const label = activePhases.get(phase)

      if (!label) {
        return
      }

      activePhases.delete(phase)
      safeTimeEnd(label)

      if (!finished) {
        safeTimeLog(rootLabel, `${phase}:end`, phaseDetails)
      }
    },
    id,
    markOnce(key, message, markDetails) {
      if (marks.has(key)) {
        return false
      }

      marks.add(key)
      this.checkpoint(message, markDetails)
      return true
    },
    rootLabel,
    startPhase(phase, phaseDetails) {
      if (finished || activePhases.has(phase)) {
        return
      }

      const label = `${rootLabel} ${phase}`
      activePhases.set(phase, label)
      safeTime(label)
      logTraceInfo(rootLabel, `${phase}:start`, phaseDetails)
    },
  }

  return trace
}

export function bindRuntimeTrace(
  sessionId: string,
  trace: RuntimeTurnTrace
): RuntimeTurnTrace {
  activeRuntimeTraces.set(sessionId, trace)
  return trace
}

export function getRuntimeTrace(
  sessionId: string | undefined
): RuntimeTurnTrace | undefined {
  if (!sessionId) {
    return undefined
  }

  return activeRuntimeTraces.get(sessionId)
}

export function clearRuntimeTrace(sessionId: string | undefined): void {
  if (!sessionId) {
    return
  }

  activeRuntimeTraces.delete(sessionId)
}

export function logRuntimeDebug(
  phase: RuntimeDebugPhase,
  details: Record<string, string | number | boolean | undefined>
): void {
  console.info(`[gitinspect:first-send] ${phase}`, {
    at: new Date().toISOString(),
    ...details,
  })
}
