import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeInferenceProvider, type ClaudeRunner } from "../src/claude.ts";
import { exampleAgentDecision, exampleContextPacket } from "../../packages/shared/fixtures";
afterEach(() => { vi.useRealTimers(); });

describe("constrained Claude adapter (fake process)", () => {
  it("passes bounded context as stdin with tools, customization and persistence disabled", async () => {
    const runner: ClaudeRunner = vi.fn(async (request) => {
      expect(request.args).toEqual(expect.arrayContaining(["--tools", "", "--safe-mode", "--restricted", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands", "--no-chrome"]));
      expect(request.args).not.toContain("--dangerously-skip-permissions");
      expect(request.stdin).toBe(JSON.stringify(exampleContextPacket));
      expect(JSON.stringify(request.environment)).not.toContain("fixture-secret");
      return { exitCode: 0, stdout: JSON.stringify({ result: JSON.stringify(exampleAgentDecision) }) };
    });
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", runner, environment: { PATH: "/usr/bin", HOME: "/fixture/home", RALLY_WORKER_TOKEN: "fixture-secret", SPECTRUM_PROJECT_SECRET: "fixture-secret", RALLY_AUTH0_ID_TOKEN: "fixture-secret" } });
    expect(await provider.decide(exampleContextPacket)).toEqual(exampleAgentDecision);
  });
  it.each(["not json", JSON.stringify({ result: "{}" }), JSON.stringify({ result: JSON.stringify({ ...exampleAgentDecision, actions: [{ type: "EXECUTE_CODE", code: "send secrets" }] }) })])("rejects malformed or forbidden output", async (stdout) => {
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", runner: async () => ({ exitCode: 0, stdout }) });
    await expect(provider.decide(exampleContextPacket)).rejects.toThrow("INVALID_DECISION");
  });
  it("does not forward CLI failures or secrets", async () => {
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", runner: async () => ({ exitCode: 1, stdout: "token=secret user=+15550000001" }) });
    await expect(provider.decide(exampleContextPacket)).rejects.toThrow(/^INFERENCE_UNAVAILABLE$/);
  });
  it("caps a hanging inference and aborts its runner", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", timeoutMs: 100, runner: async (request) => { signal = request.signal; return new Promise(() => {}); } });
    const result = expect(provider.decide(exampleContextPacket)).rejects.toThrow("INFERENCE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(signal!.aborted).toBe(true);
  });
  it("rejects API-key billing and invalid model values before invoking a runner", async () => {
    expect(() => new ClaudeInferenceProvider({ model: "fixture-model", environment: { ANTHROPIC_API_KEY: "fixture-key" } })).toThrow("API_KEY_NOT_AUTHORIZED");
    expect(() => new ClaudeInferenceProvider({ model: "--tools=Bash" })).toThrow("INVALID_MODEL");
  });
  it.each(["oauth", "claude.ai"])("accepts read-only subscription authentication metadata %s", async (authMethod) => {
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", runner: async () => ({ exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod, apiProvider: "firstParty" }) }) });
    await expect(provider.checkReady()).resolves.toBeUndefined();
  });
  it("rejects API authentication before processing jobs", async () => {
    const provider = new ClaudeInferenceProvider({ model: "fixture-model", runner: async () => ({ exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }) }) });
    await expect(provider.checkReady()).rejects.toThrow("INFERENCE_UNAVAILABLE");
  });
});
