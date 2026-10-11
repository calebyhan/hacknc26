import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentDecisionSchema, type AgentDecision } from "../../packages/shared/agentDecision.ts";
import { ContextPacketSchema, type ContextPacket } from "../../packages/shared/contextPacket.ts";
import type { InferenceProvider } from "../../packages/shared/adapters.ts";
import { systemPrompt } from "./prompt.ts";

const OUTPUT_LIMIT = 65_536;
export class InferenceError extends Error {
  constructor(category: "INFERENCE_TIMEOUT" | "INFERENCE_UNAVAILABLE" | "INVALID_DECISION") { super(category); this.name = "InferenceError"; }
}
export interface ClaudeRequest {
  args: string[];
  stdin: string;
  environment: Record<string, string>;
  signal: AbortSignal;
  captureStderr?: boolean;
}
export type ClaudeRunner = (request: ClaudeRequest) => Promise<{ exitCode: number; stdout: string }>;

/** No shell interpolation, repository working directory or model-accessible tools. */
export async function runCommand(executable: "claude" | "codex", request: ClaudeRequest): Promise<{ exitCode: number; stdout: string }> {
  const directory = await mkdtemp(join(tmpdir(), "rally-inference-"));
  try {
    if (request.signal.aborted) throw new InferenceError("INFERENCE_TIMEOUT");
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, request.args, { cwd: directory, env: request.environment, stdio: ["pipe", "pipe", request.captureStderr ? "pipe" : "ignore"], detached: process.platform !== "win32" });
      let stdout = "";
      let bytes = 0;
      let terminated = false;
      const stop = () => {
        terminated = true;
        try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      const collect = (chunk: string) => { bytes += Buffer.byteLength(chunk); if (bytes > OUTPUT_LIMIT) stop(); else stdout += chunk; };
      child.stdout!.setEncoding("utf8"); child.stdout!.on("data", collect);
      if (request.captureStderr && child.stderr) { child.stderr.setEncoding("utf8"); child.stderr.on("data", collect); }
      child.stdin!.on("error", () => { /* Exit handler supplies a sanitized failure. */ });
      child.once("error", () => { request.signal.removeEventListener("abort", stop); reject(new InferenceError("INFERENCE_UNAVAILABLE")); });
      child.once("close", (code) => {
        request.signal.removeEventListener("abort", stop);
        if (terminated) reject(new InferenceError(request.signal.aborted ? "INFERENCE_TIMEOUT" : "INVALID_DECISION"));
        else resolve({ exitCode: code ?? 1, stdout });
      });
      child.stdin!.end(request.stdin);
      if (request.signal.aborted) stop();
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export const runClaude: ClaudeRunner = (request) => runCommand("claude", request);

export class ClaudeInferenceProvider implements InferenceProvider {
  private readonly model: string;
  private readonly runner: ClaudeRunner;
  private readonly timeoutMs: number;
  private readonly environment: Record<string, string> = {};
  private readonly parentSignal: AbortSignal | undefined;
  constructor(options: { model: string; timeoutMs?: number; runner?: ClaudeRunner; environment?: Readonly<Record<string, string | undefined>>; signal?: AbortSignal }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(options.model)) throw new Error("INVALID_MODEL");
    const source = options.environment ?? process.env;
    if (source.ANTHROPIC_API_KEY) throw new Error("API_KEY_NOT_AUTHORIZED");
    for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SYSTEMROOT", "LANG"]) if (source[key]) this.environment[key] = source[key]!;
    this.environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    this.model = options.model;
    this.runner = options.runner ?? runClaude;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.parentSignal = options.signal;
    if (this.timeoutMs <= 0 || this.timeoutMs > 30_000) throw new Error("INVALID_INFERENCE_TIMEOUT");
  }

  /** Read-only authentication preflight; never prints account identifiers. */
  async checkReady(): Promise<void> {
    try {
      const result = await this.runner({ args: ["--safe-mode", "auth", "status", "--json"], stdin: "", environment: this.environment, signal: AbortSignal.timeout(5_000) });
      const status: unknown = JSON.parse(result.stdout);
      if (result.exitCode !== 0 || typeof status !== "object" || status === null || !("loggedIn" in status) || status.loggedIn !== true || !("authMethod" in status) || !["oauth", "claude.ai"].includes(String(status.authMethod)) || !("apiProvider" in status) || status.apiProvider !== "firstParty") throw new Error();
    } catch { throw new InferenceError("INFERENCE_UNAVAILABLE"); }
  }

  async decide(packet: ContextPacket): Promise<AgentDecision> {
    const stdin = JSON.stringify(ContextPacketSchema.parse(packet));
    if (Buffer.byteLength(stdin) > OUTPUT_LIMIT) throw new InferenceError("INVALID_DECISION");
    const controller = new AbortController();
    const signal = this.parentSignal ? AbortSignal.any([controller.signal, this.parentSignal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.runner({ stdin, signal, environment: this.environment, args: [
          "-p", "--model", this.model, "--output-format", "json", "--max-turns", "1",
          "--safe-mode", "--restricted", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
          "--setting-sources", "", "--settings", '{"disableAllHooks":true,"autoMemoryEnabled":false}',
          "--disable-slash-commands", "--no-chrome", "--no-session-persistence", "--system-prompt", systemPrompt,
        ] }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new InferenceError("INFERENCE_TIMEOUT")); }, this.timeoutMs); }),
      ]);
      if (result.exitCode !== 0) throw new InferenceError("INFERENCE_UNAVAILABLE");
      try {
        if (Buffer.byteLength(result.stdout) > OUTPUT_LIMIT) throw new Error();
        const envelope: unknown = JSON.parse(result.stdout);
        if (typeof envelope !== "object" || envelope === null || !("result" in envelope) || typeof envelope.result !== "string" || ("is_error" in envelope && envelope.is_error === true)) throw new Error();
        return AgentDecisionSchema.parse(JSON.parse(envelope.result));
      } catch { throw new InferenceError("INVALID_DECISION"); }
    } catch (error) {
      throw error instanceof InferenceError ? error : new InferenceError("INFERENCE_UNAVAILABLE");
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
}
