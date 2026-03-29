import { wrap } from "comlink"
import type { Remote } from "comlink"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { SessionWorkerApi } from "@/agent/runtime-worker-types"
import type { SessionData } from "@/types/storage"
import {
  MissingSessionRuntimeError,
  reviveRuntimeCommandError,
} from "@/agent/runtime-command-errors"
import { logRuntimeDebug } from "@/lib/runtime-debug"

const sharedWorkerSupported =
  typeof window !== "undefined" && "SharedWorker" in window

interface WorkerHandle {
  worker: SharedWorker | Worker
  api: Remote<SessionWorkerApi>
  workerType: "dedicated" | "shared"
}

function isWorkerTransportError(error: Error): boolean {
  const message = error.message.toLowerCase()

  return (
    message.includes("disposed") ||
    message.includes("closed") ||
    message.includes("port") ||
    message.includes("worker")
  )
}

export class RuntimeClient {
  private readonly workers = new Map<string, WorkerHandle>()
  private readonly initPromises = new Map<
    string,
    Promise<WorkerHandle | undefined>
  >()

  private createWorker(sessionId: string): WorkerHandle {
    if (typeof window === "undefined") {
      throw new Error("Runtime requires a browser environment")
    }

    const url = new URL("./runtime-worker", import.meta.url)
    const opts = {
      name: `gitinspect-session-${sessionId}`,
      type: "module" as const,
    }

    if (sharedWorkerSupported) {
      try {
        const worker = new SharedWorker(url, opts)
        return {
          worker,
          api: wrap<SessionWorkerApi>(worker.port),
          workerType: "shared",
        }
      } catch (error) {
        console.warn("[gitinspect:runtime] shared_worker_unavailable", {
          error,
          sessionId,
        })
      }
    }

    const worker = new Worker(url, opts)
    return {
      worker,
      api: wrap<SessionWorkerApi>(worker),
      workerType: "dedicated",
    }
  }

  private terminateHandle(handle: WorkerHandle): void {
    if ("port" in handle.worker) {
      handle.worker.port.close()
    } else {
      handle.worker.terminate()
    }
  }

  private async getOrCreate(
    sessionId: string,
    initialize: (api: Remote<SessionWorkerApi>) => Promise<boolean>
  ): Promise<WorkerHandle | undefined> {
    const existing = this.workers.get(sessionId)

    if (existing) {
      return existing
    }

    const pending = this.initPromises.get(sessionId)

    if (pending) {
      return pending
    }

    const nextPending = (async () => {
      try {
        const handle = this.createWorker(sessionId)
        logRuntimeDebug("worker_init_started", {
          sessionId,
          workerType: handle.workerType,
        })
        const exists = await initialize(handle.api)

        if (!exists) {
          this.terminateHandle(handle)
          return undefined
        }

        logRuntimeDebug("worker_init_completed", {
          sessionId,
          workerType: handle.workerType,
        })
        this.workers.set(sessionId, handle)
        return handle
      } finally {
        this.initPromises.delete(sessionId)
      }
    })()

    this.initPromises.set(sessionId, nextPending)
    return nextPending
  }

  private async getOrCreateFromStorage(
    sessionId: string
  ): Promise<WorkerHandle | undefined> {
    return await this.getOrCreate(
      sessionId,
      async (api) => await api.initFromStorage(sessionId)
    )
  }

  private async getOrCreateFromSession(
    session: SessionData
  ): Promise<WorkerHandle | undefined> {
    return await this.getOrCreate(session.id, async (api) => {
      await api.initFromSession(session)
      return true
    })
  }

  private async call<T>(
    sessionId: string,
    getHandle: () => Promise<WorkerHandle | undefined>,
    invoke: (api: Remote<SessionWorkerApi>) => Promise<T>
  ): Promise<T> {
    const handle = await getHandle()

    if (!handle) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    try {
      return await invoke(handle.api)
    } catch (error) {
      if (error instanceof Error && isWorkerTransportError(error)) {
        this.terminateHandle(handle)
        this.workers.delete(sessionId)
      }

      if (error instanceof Error) {
        throw reviveRuntimeCommandError(error, sessionId)
      }

      throw error
    }
  }

  async startTurn(sessionId: string, content: string): Promise<void> {
    logRuntimeDebug("runtime_turn_started", {
      contentLength: content.trim().length,
      sessionId,
    })

    try {
      await this.call(
        sessionId,
        async () => await this.getOrCreateFromStorage(sessionId),
        async (api) => await api.startTurn(content)
      )
      logRuntimeDebug("runtime_turn_accepted", { sessionId })
    } catch (error) {
      logRuntimeDebug("runtime_turn_failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId,
      })
      throw error
    }
  }

  async startInitialTurn(session: SessionData, content: string): Promise<void> {
    logRuntimeDebug("runtime_initial_turn_started", {
      contentLength: content.trim().length,
      sessionId: session.id,
    })

    try {
      await this.call(
        session.id,
        async () => await this.getOrCreateFromSession(session),
        async (api) => await api.startTurn(content)
      )
      logRuntimeDebug("runtime_initial_turn_accepted", {
        sessionId: session.id,
      })
    } catch (error) {
      logRuntimeDebug("runtime_initial_turn_failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId: session.id,
      })
      throw error
    }
  }

  async abort(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId)

    if (!handle) {
      return
    }

    try {
      await handle.api.abort()
    } catch (error) {
      if (error instanceof Error && isWorkerTransportError(error)) {
        this.terminateHandle(handle)
        this.workers.delete(sessionId)
      }

      if (error instanceof Error) {
        throw reviveRuntimeCommandError(error, sessionId)
      }

      throw error
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId)

    if (!handle) {
      return
    }

    try {
      await handle.api.dispose()
    } catch {
      return
    } finally {
      this.terminateHandle(handle)
      this.workers.delete(sessionId)
    }
  }

  async refreshGithubToken(sessionId: string): Promise<void> {
    await this.call(
      sessionId,
      async () => await this.getOrCreateFromStorage(sessionId),
      async (api) => await api.refreshGithubToken()
    )
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    await this.call(
      sessionId,
      async () => await this.getOrCreateFromStorage(sessionId),
      async (api) => await api.setModelSelection(providerGroup, modelId)
    )
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    await this.call(
      sessionId,
      async () => await this.getOrCreateFromStorage(sessionId),
      async (api) => await api.setThinkingLevel(thinkingLevel)
    )
  }
}

export const runtimeClient = new RuntimeClient()
