import { describe, expect, it, vi } from "vitest";
import {
  getProviderLabel,
  normalizeProviderAlias,
  promptForProvider,
} from "../apps/cli/src/lib/providers";

describe("cli providers", () => {
  it("normalizes aliases", () => {
    expect(normalizeProviderAlias("codex")).toBe("openai-codex");
    expect(normalizeProviderAlias("claude")).toBe("anthropic");
    expect(normalizeProviderAlias("gemini")).toBe("google-gemini-cli");
    expect(normalizeProviderAlias("copilot")).toBe("github-copilot");
    expect(normalizeProviderAlias("unknown")).toBeUndefined();
  });

  it("returns provider labels", () => {
    expect(getProviderLabel("openai-codex")).toBe("OpenAI Codex");
    expect(getProviderLabel("github-copilot")).toBe("GitHub Copilot");
  });

  it("prompts for a provider", async () => {
    const selectPrompt = vi.fn().mockResolvedValue("anthropic");

    await expect(promptForProvider(selectPrompt)).resolves.toBe("anthropic");
    expect(selectPrompt).toHaveBeenCalledOnce();
  });
});
