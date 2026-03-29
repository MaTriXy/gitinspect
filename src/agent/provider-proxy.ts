import { streamSimple } from "@mariozechner/pi-ai"
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai"
import { isFreeTierProxyMarker } from "@/auth/public-provider-fallbacks"
import { getRuntimeTrace } from "@/lib/runtime-debug"
import { getProxyConfig } from "@/proxy/settings"
import { buildProxiedUrl } from "@/proxy/url"

export function shouldUseProxyForProvider(
  provider: string,
  apiKey: string
): boolean {
  if (isFreeTierProxyMarker(apiKey)) {
    return provider.toLowerCase() === "fireworks-ai"
  }
  switch (provider.toLowerCase()) {
    case "anthropic":
      return apiKey.startsWith("sk-ant-oat") || apiKey.startsWith("{")
    case "openai":
    case "openai-codex":
    case "opencode":
    case "opencode-go":
      return true
    default:
      return false
  }
}

function applyProxyIfNeeded<TApi extends Api>(
  model: Model<TApi>,
  apiKey: string,
  proxyUrl?: string
): Model<TApi> {
  if (!proxyUrl || !model.baseUrl) {
    return model
  }

  if (!shouldUseProxyForProvider(model.provider, apiKey)) {
    return model
  }

  return {
    ...model,
    baseUrl: buildProxiedUrl(proxyUrl, model.baseUrl),
  }
}

export function createProxyAwareStreamFn() {
  return async <TApi extends Api>(
    model: Model<TApi>,
    context: Parameters<typeof streamSimple>[1],
    options?: SimpleStreamOptions
  ) => {
    const sessionId = (
      options as (SimpleStreamOptions & { sessionId?: string }) | undefined
    )?.sessionId
    const trace = getRuntimeTrace(sessionId)
    const apiKey = options?.apiKey

    if (!apiKey) {
      trace?.startPhase("provider.stream.open", {
        hasApiKey: false,
        provider: model.provider,
        sessionId,
      })
      const stream = await streamSimple(model, context, options)
      trace?.endPhase("provider.stream.open", {
        provider: model.provider,
        proxied: false,
        sessionId,
      })
      return stream
    }

    trace?.checkpoint("provider.stream.prepare", {
      contextMessages: context.messages.length,
      hasApiKey: true,
      provider: model.provider,
      sessionId,
      toolCount: context.tools?.length ?? 0,
    })

    const proxyUrl = isFreeTierProxyMarker(apiKey)
      ? "/api/proxy"
      : await (async () => {
          trace?.startPhase("proxy.config.load", {
            provider: model.provider,
            sessionId,
          })
          const proxy = await getProxyConfig()
          trace?.endPhase("proxy.config.load", {
            enabled: proxy.enabled,
            provider: model.provider,
            sessionId,
          })
          return proxy.enabled ? proxy.url : undefined
        })()

    if (!proxyUrl) {
      trace?.startPhase("provider.stream.open", {
        provider: model.provider,
        proxied: false,
        sessionId,
      })
      const stream = await streamSimple(model, context, options)
      trace?.endPhase("provider.stream.open", {
        provider: model.provider,
        proxied: false,
        sessionId,
      })
      return stream
    }

    const proxiedModel = applyProxyIfNeeded(model, apiKey, proxyUrl)

    trace?.checkpoint("proxy.decision", {
      provider: model.provider,
      proxied: proxiedModel.baseUrl !== model.baseUrl,
      sessionId,
      targetBaseUrl: proxiedModel.baseUrl,
    })
    trace?.startPhase("provider.stream.open", {
      provider: model.provider,
      proxied: proxiedModel.baseUrl !== model.baseUrl,
      sessionId,
    })

    const stream = await streamSimple(proxiedModel, context, options)

    trace?.endPhase("provider.stream.open", {
      provider: model.provider,
      proxied: proxiedModel.baseUrl !== model.baseUrl,
      sessionId,
    })

    return stream
  }
}
