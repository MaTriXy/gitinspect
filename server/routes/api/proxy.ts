import { defineHandler } from "nitro"

const ALLOWED_HOSTS = new Set(["api.fireworks.ai"])

function createProxyTrace(method: string, target: URL) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const label = `[gitinspect:proxy ${id}]`
  let finished = false

  const log = (
    message: string,
    details?: Record<string, number | string | undefined>
  ) => {
    const normalized =
      details &&
      Object.fromEntries(
        Object.entries(details).filter(([, value]) => value !== undefined)
      )

    if (normalized && Object.keys(normalized).length > 0) {
      console.timeLog(label, message, normalized)
      return
    }

    console.timeLog(label, message)
  }

  console.time(label)
  console.info(label, "start", {
    host: target.host,
    method,
    pathname: target.pathname,
    search: target.search,
  })

  return {
    end(details?: Record<string, number | string | undefined>) {
      if (finished) {
        return
      }

      finished = true
      log("end", details)
      console.timeEnd(label)
    },
    log,
  }
}

export default defineHandler(async (event) => {
  const targetUrl = event.url.searchParams.get("url")

  if (!targetUrl) {
    event.res.status = 400
    return { error: "Missing ?url= parameter" }
  }

  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    event.res.status = 400
    return { error: "Invalid target URL" }
  }

  if (!ALLOWED_HOSTS.has(target.host)) {
    event.res.status = 403
    return { error: `Host not allowed: ${target.host}` }
  }

  const trace = createProxyTrace(event.req.method, target)

  const apiKey = process.env.FIREWORKS_API_KEY
  if (!apiKey) {
    trace.end({ status: "missing-api-key" })
    event.res.status = 503
    return { error: "Server proxy is not configured" }
  }

  if (event.req.method === "OPTIONS") {
    event.res.headers.set("access-control-allow-origin", "*")
    event.res.headers.set("access-control-allow-methods", "GET, POST, OPTIONS")
    event.res.headers.set("access-control-allow-headers", "content-type, authorization")
    trace.end({ status: "options" })
    return ""
  }

  const forwardHeaders = new Headers({
    authorization: `Bearer ${apiKey}`,
  })

  const contentType = event.req.headers.get("content-type")
  if (contentType) {
    forwardHeaders.set("content-type", contentType)
  }

  for (const [key, value] of event.req.headers.entries()) {
    if (key.startsWith("x-")) {
      forwardHeaders.set(key, value)
    }
  }

  let body: string | undefined
  if (event.req.method !== "GET" && event.req.method !== "HEAD") {
    trace.log("request.body.read:start", {
      contentLength: event.req.headers.get("content-length") ?? undefined,
    })
    body = await event.req.text()
    trace.log("request.body.read:end", {
      bodyLength: body.length,
    })
  }

  trace.log("upstream.fetch:start")
  let response: Response

  try {
    response = await fetch(target.toString(), {
      method: event.req.method,
      headers: forwardHeaders,
      body,
    })
  } catch (error) {
    trace.end({
      error: error instanceof Error ? error.message : String(error),
      status: "fetch_failed",
    })
    throw error
  }
  trace.log("upstream.fetch:headers", {
    contentType: response.headers.get("content-type") ?? undefined,
    retryAfter: response.headers.get("retry-after") ?? undefined,
    status: String(response.status),
  })

  if (!response.ok) {
    try {
      const diagnosticText = await response.clone().text()

      trace.log("upstream.fetch:error_body", {
        preview: diagnosticText.slice(0, 200),
        status: String(response.status),
      })
    } catch (error) {
      trace.log("upstream.fetch:error_body_failed", {
        error: error instanceof Error ? error.message : String(error),
        status: String(response.status),
      })
    }
  }

  event.res.headers.set(
    "content-type",
    response.headers.get("content-type") ?? "application/json",
  )
  event.res.headers.set("cache-control", "no-cache")
  event.res.headers.set("access-control-allow-origin", "*")

  if (!response.body) {
    event.res.status = response.status
    trace.end({
      body: "none",
      status: String(response.status),
    })
    return ""
  }

  const reader = response.body.getReader()
  let firstChunkSeen = false

  const tracedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()

        if (done) {
          trace.end({
            body: "complete",
            firstChunkSeen: String(firstChunkSeen),
            status: String(response.status),
          })
          controller.close()
          return
        }

        if (value) {
          if (!firstChunkSeen) {
            firstChunkSeen = true
            trace.log("upstream.stream:first_chunk", {
              chunkBytes: String(value.byteLength),
              status: String(response.status),
            })
          }

          controller.enqueue(value)
        }
      } catch (error) {
        trace.end({
          error: error instanceof Error ? error.message : String(error),
          status: String(response.status),
        })
        controller.error(error)
      }
    },
    cancel(reason) {
      void reader.cancel(reason)
      trace.end({
        reason: "cancelled",
        status: String(response.status),
      })
    },
  })

  const headers = new Headers(response.headers)
  headers.set(
    "content-type",
    response.headers.get("content-type") ?? "application/json",
  )
  headers.set("cache-control", "no-cache")
  headers.set("access-control-allow-origin", "*")

  return new Response(tracedBody, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
})
