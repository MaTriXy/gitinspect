import * as Comlink from "comlink";
import type { RuntimeWorkerEvents } from "@gitinspect/pi/agent/runtime-worker-types";

let workerApi: Comlink.Remote<typeof import("./runtime-worker")> | undefined;

export function getRuntimeWorker(): Comlink.Remote<typeof import("./runtime-worker")> {
  if (!workerApi) {
    workerApi = Comlink.wrap<typeof import("./runtime-worker")>(
      new Worker(new URL("./runtime-worker", import.meta.url), {
        name: "gitinspect-runtime-worker",
        type: "module",
      }),
    );
  }

  return workerApi;
}

export function createRuntimeWorkerEvents(sink: RuntimeWorkerEvents): RuntimeWorkerEvents {
  return Comlink.proxy(sink);
}
