import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexInferenceProvider } from "../src/codex.ts";
import { exampleAgentDecision, exampleContextPacket } from "../../packages/shared/fixtures";
afterEach(() => vi.useRealTimers());
const success = [
  { type: "thread.started", thread_id: "fixture" },
  { type: "turn.started" },
  { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(exampleAgentDecision) } },
  { type: "turn.completed", usage: {} },
].map(e => JSON.stringify(e)).join("\n");
describe("constrained Codex adapter (fake CLI)", () => {
  it("disables execution, connectors, customization and persistence with isolated argv and stdin", async () => {
    const provider = new CodexInferenceProvider({ model: "fixture-model", environment: { PATH: "/usr/bin", HOME: "/fixture", RALLY_WORKER_TOKEN: "fixture-secret", SPECTRUM_PROJECT_SECRET: "fixture-secret", RALLY_AUTH0_ID_TOKEN: "fixture-secret" }, runner: async r => {
      expect(r.args).toEqual(expect.arrayContaining(["exec", "--json", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "read-only", "features.shell_tool=false", "features.apps=false", "features.plugins=false", "features.hooks=false", 'web_search="disabled"', 'approval_policy="never"']));
      expect(r.stdin).toBe(JSON.stringify(exampleContextPacket));
      expect(JSON.stringify(r.environment)).not.toContain("fixture-secret");
      return { exitCode: 0, stdout: success };
    } });
    expect(await provider.decide(exampleContextPacket)).toEqual(exampleAgentDecision);
  });
  it.each(["not json", success.replace('"turn.completed"', '"turn.failed"'), success.replace('"agent_message"', '"command_execution"'), success + "\n" + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{}" } })])("rejects malformed, incomplete, tool-using or duplicate output", async stdout => {
    const provider = new CodexInferenceProvider({ model: "fixture-model", runner: async () => ({ exitCode: 0, stdout }) });
    await expect(provider.decide(exampleContextPacket)).rejects.toThrow("INVALID_DECISION");
  });
  it("accepts only the known disabled-host notice before a turn, while rejecting other errors", async () => {
    const warning = JSON.stringify({ type: "item.completed", item: { type: "error", message: "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`." } });
    const provider = new CodexInferenceProvider({ model: "fixture-model", runner: async () => ({ exitCode: 0, stdout: warning + "\n" + success }) });
    expect(await provider.decide(exampleContextPacket)).toEqual(exampleAgentDecision);
    for (const stdout of [success + "\n" + warning, warning.replace("Code Mode", "Unknown error") + "\n" + success]) {
      await expect(new CodexInferenceProvider({ model: "fixture", runner: async () => ({ exitCode: 0, stdout }) }).decide(exampleContextPacket)).rejects.toThrow("INVALID_DECISION");
    }
  });
  it("requires the inspected CLI version and ChatGPT login", async () => {
    const provider = new CodexInferenceProvider({ model: "fixture-model", runner: async r => ({ exitCode: 0, stdout: r.args[0] === "--version" ? "codex-cli 0.152.1" : "Logged in using ChatGPT" }) });
    await expect(provider.checkReady()).resolves.toBeUndefined();
    for (const status of ["Logged in using an API key", "Not logged in"]) {
      const unavailable = new CodexInferenceProvider({ model: "fixture-model", runner: async r => ({ exitCode: 0, stdout: r.args[0] === "--version" ? "codex-cli 0.152.1" : status }) });
      await expect(unavailable.checkReady()).rejects.toThrow("INFERENCE_UNAVAILABLE");
    }
  });
  it("rejects API keys before running any process", () => {
    expect(() => new CodexInferenceProvider({ model: "fixture", environment: { OPENAI_API_KEY: "fixture-secret" } })).toThrow("API_KEY_NOT_AUTHORIZED");
    expect(() => new CodexInferenceProvider({ model: "fixture", environment: { CODEX_API_KEY: "fixture-secret" } })).toThrow("API_KEY_NOT_AUTHORIZED");
  });
  it("aborts hanging inference at its deadline", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const provider = new CodexInferenceProvider({ model: "fixture", timeoutMs: 100, runner: async r => { signal = r.signal; return new Promise(() => {}); } });
    const pending = expect(provider.decide(exampleContextPacket)).rejects.toThrow("INFERENCE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(100); await pending; expect(signal!.aborted).toBe(true);
  });
});
