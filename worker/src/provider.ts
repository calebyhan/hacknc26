import { ClaudeInferenceProvider } from "./claude.ts";
import { CodexInferenceProvider } from "./codex.ts";

export function createProvider(provider: "claude" | "codex", model: string, signal?: AbortSignal) {
  const options = { model, ...(signal ? { signal } : {}) };
  return provider === "codex" ? new CodexInferenceProvider(options) : new ClaudeInferenceProvider(options);
}
