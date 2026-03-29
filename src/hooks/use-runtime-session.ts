import * as React from "react"
import { runtimeClient } from "@/agent/runtime-client"

export function useRuntimeSession(sessionId: string | undefined) {
  const runMutation = React.useEffectEvent(
    async (action: (currentSessionId: string) => Promise<void>) => {
      if (!sessionId) {
        return
      }

      await action(sessionId)
    }
  )

  const send = React.useEffectEvent(async (content: string) => {
    await runMutation(async (currentSessionId) => {
      await runtimeClient.startTurn(currentSessionId, content)
    })
  })

  const abort = React.useEffectEvent(async () => {
    if (!sessionId) {
      return
    }
    await runtimeClient.abort(sessionId)
  })

  const setModelSelection = React.useEffectEvent(
    async (
      providerGroup: Parameters<typeof runtimeClient.setModelSelection>[1],
      model: string
    ) => {
      await runMutation(async (currentSessionId) => {
        await runtimeClient.setModelSelection(
          currentSessionId,
          providerGroup,
          model
        )
      })
    }
  )

  const setThinkingLevel = React.useEffectEvent(
    async (
      thinkingLevel: Parameters<typeof runtimeClient.setThinkingLevel>[1]
    ) => {
      await runMutation(async (currentSessionId) => {
        await runtimeClient.setThinkingLevel(
          currentSessionId,
          thinkingLevel
        )
      })
    }
  )

  return {
    abort,
    send,
    setModelSelection,
    setThinkingLevel,
  }
}
