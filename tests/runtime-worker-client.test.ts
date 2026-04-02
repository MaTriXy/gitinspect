import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyMock = vi.fn(<T>(value: T): T => value);

vi.mock("comlink", () => ({
  proxy: proxyMock,
}));

describe("runtime worker client", () => {
  beforeEach(() => {
    vi.resetModules();
    proxyMock.mockClear();
    Reflect.deleteProperty(globalThis, "ComlinkWorker");
  });

  it("creates the worker lazily and reuses the singleton", async () => {
    const constructorMock = vi.fn(
      (_url: URL, _options: { name: string; type: "module" }): Record<string, never> => ({}),
    );

    Reflect.set(globalThis, "ComlinkWorker", constructorMock);

    const { getRuntimeWorker } = await import("@/agent/runtime-worker-client");

    expect(constructorMock).not.toHaveBeenCalled();

    const first = getRuntimeWorker();
    const second = getRuntimeWorker();

    expect(first).toBe(second);
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        name: "gitinspect-runtime-worker",
        type: "module",
      }),
    );
  });

  it("wraps event sinks with Comlink.proxy", async () => {
    const constructorMock = vi.fn(
      (_url: URL, _options: { name: string; type: "module" }): Record<string, never> => ({}),
    );

    Reflect.set(globalThis, "ComlinkWorker", constructorMock);

    const { createRuntimeWorkerEvents } = await import("@/agent/runtime-worker-client");
    const sink = {
      pushSnapshot: vi.fn(async () => {}),
    };

    const proxied = createRuntimeWorkerEvents(sink);

    expect(proxied).toBe(sink);
    expect(proxyMock).toHaveBeenCalledWith(sink);
  });
});
