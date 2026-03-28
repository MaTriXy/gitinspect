type RuntimeDebugPhase =
  | "prompt_persisted"
  | "prompt_started"
  | "runtime_send_completed"
  | "runtime_send_failed"
  | "runtime_send_started"
  | "session_created"
  | "worker_init_completed"
  | "worker_init_started"

export function logRuntimeDebug(
  phase: RuntimeDebugPhase,
  details: Record<string, unknown>
): void {
  console.info(`[gitinspect:first-send] ${phase}`, {
    at: new Date().toISOString(),
    ...details,
  })
}
