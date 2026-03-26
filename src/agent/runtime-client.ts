import { wrap } from "comlink"
import type { Remote } from "comlink"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { SessionWorkerApi } from "@/agent/runtime-worker-types"
import {
  MissingSessionRuntimeError,
  reviveRuntimeCommandError,
} from "@/agent/runtime-command-errors"

const sharedWorkerSupported =
  typeof window !== "undefined" && "SharedWorker" in window

interface WorkerHandle {
  worker: SharedWorker | Worker
  api: Remote<SessionWorkerApi>
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
      const worker = new SharedWorker(url, opts)
      return { worker, api: wrap<SessionWorkerApi>(worker.port) }
    }

    const worker = new Worker(url, opts)
    return { worker, api: wrap<SessionWorkerApi>(worker) }
  }

  private terminateHandle(handle: WorkerHandle): void {
    if ("port" in handle.worker) {
      handle.worker.port.close()
    } else {
      handle.worker.terminate()
    }
  }

  private async getOrCreate(
    sessionId: string
  ): Promise<WorkerHandle | undefined> {
    const existing = this.workers.get(sessionId)

    if (existing) {
      return existing
    }

    let pending = this.initPromises.get(sessionId)

    if (pending) {
      return pending
    }

    pending = (async () => {
      try {
        const handle = this.createWorker(sessionId)
        const exists = await handle.api.init(sessionId)

        if (!exists) {
          this.terminateHandle(handle)
          return undefined
        }

        this.workers.set(sessionId, handle)
        return handle
      } finally {
        this.initPromises.delete(sessionId)
      }
    })()

    this.initPromises.set(sessionId, pending)
    return pending
  }

  private async call<T>(
    sessionId: string,
    invoke: (api: Remote<SessionWorkerApi>) => Promise<T>
  ): Promise<T> {
    const handle = await this.getOrCreate(sessionId)

    if (!handle) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    try {
      return await invoke(handle.api)
    } catch (error) {
      if (error instanceof Error) {
        throw reviveRuntimeCommandError(error, sessionId)
      }

      throw error
    }
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    const handle = await this.getOrCreate(sessionId)
    return handle !== undefined
  }

  async send(sessionId: string, content: string): Promise<void> {
    await this.call(sessionId, async (api) => await api.send(content))
  }

  async abort(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId)

    if (!handle) {
      return
    }

    try {
      await handle.api.abort()
    } catch (error) {
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
      // Best-effort teardown; worker may already be gone.
    }

    this.terminateHandle(handle)
    this.workers.delete(sessionId)
  }

  async refreshGithubToken(sessionId: string): Promise<void> {
    await this.call(sessionId, async (api) => await api.refreshGithubToken())
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    await this.call(sessionId, async (api) =>
      api.setModelSelection(providerGroup, modelId)
    )
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    await this.call(sessionId, async (api) =>
      api.setThinkingLevel(thinkingLevel)
    )
  }
}

export const runtimeClient = new RuntimeClient()
