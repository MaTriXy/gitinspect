import { describe, expect, it } from "vitest"
import { createEmptyUsage } from "@/types/models"
import {
  DEFAULT_MODELS,
  calculateCost,
  getCanonicalProvider,
  getDefaultModel,
  getDefaultModelForGroup,
  getModel,
  getModelsForGroup,
  getProviderGroups,
  isFreeModel,
} from "@/models/catalog"

describe("model catalog", () => {
  it("returns the configured default models", () => {
    expect(getDefaultModel("openai-codex").id).toBe(DEFAULT_MODELS["openai-codex"])
    expect(getDefaultModel("anthropic").id).toBe(DEFAULT_MODELS.anthropic)
  })

  it("falls back to the provider default when the requested model is missing", () => {
    expect(getModel("github-copilot", "missing-model").id).toBe("gpt-4o")
  })

  it("exposes the OpenCode provider groups and canonicalizes the free group", () => {
    expect(getProviderGroups()).toEqual(
      expect.arrayContaining(["opencode", "opencode-free"])
    )
    expect(getCanonicalProvider("opencode-free")).toBe("opencode")
  })

  it("filters the OpenCode free group to free-tier models only", () => {
    const freeModels = getModelsForGroup("opencode-free")

    expect(freeModels.length).toBeGreaterThan(0)
    expect(freeModels.every((model) => isFreeModel(model))).toBe(true)
    expect(getDefaultModelForGroup("opencode-free").id).toBe("gpt-5-nano")
  })

  it("calculates per-message cost from usage totals", () => {
    const model = getModel("openai-codex", "gpt-5.1-codex-mini")
    const usage = createEmptyUsage()
    usage.input = 1_000
    usage.output = 500
    usage.totalTokens = 1_500

    expect(calculateCost(model, usage)).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      input: 0.00025,
      output: 0.001,
      total: 0.00125,
    })
  })
})
