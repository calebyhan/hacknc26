import { AgentDecisionSchema, type AgentDecision } from "../../packages/shared/agentDecision.ts";
import { ContextPacketSchema, type ContextPacket } from "../../packages/shared/contextPacket.ts";
import type { InferenceProvider } from "../../packages/shared/adapters.ts";
import { InferenceError, runCommand, type ClaudeRunner } from "./claude.ts";
import { systemPrompt } from "./prompt.ts";

// Inspected 0.152.1 and 0.160.1; the opt-in local Responses mock verifies no
// tool definitions are registered. Unknown CLI versions still fail closed.
const supportedVersions = new Set(["codex-cli 0.152.1", "codex-cli 0.160.1"]);
const disabledHostNotice = "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";
const disabledFeatures = [
  "shell_tool", "shell_snapshot", "unified_exec", "apps", "enable_mcp_apps", "plugins", "remote_plugin", "hooks", "memories", "multi_agent", "multi_agent_v2",
  "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "view_image", "image_generation", "artifact",
  "code_mode", "code_mode_host", "deferred_executor", "deferred_tool_world_state", "executor_capability_discovery",
  "in_app_browser", "in_app_chat", "in_app_dictation", "in_app_local_automation", "in_app_updates",
  "skill_search", "skill_mcp_dependency_install", "workspace_dependencies", "auth_elicitation", "tool_call_mcp_elicitation", "request_permissions_tool", "goals", "sleep_tool", "tool_suggest",
];

export class CodexInferenceProvider implements InferenceProvider {
  private readonly environment: Record<string, string> = {};
  private readonly runner: ClaudeRunner;
  private readonly timeoutMs: number;
  constructor(private readonly options: { model: string; timeoutMs?: number; runner?: ClaudeRunner; environment?: Readonly<Record<string, string | undefined>>; signal?: AbortSignal }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(options.model)) throw new Error("INVALID_MODEL");
    const source = options.environment ?? process.env;
    if (source.OPENAI_API_KEY || source.CODEX_API_KEY) throw new Error("API_KEY_NOT_AUTHORIZED");
    for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SYSTEMROOT", "LANG"]) if (source[key]) this.environment[key] = source[key]!;
    this.runner = options.runner ?? (r => runCommand("codex", r));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (this.timeoutMs <= 0 || this.timeoutMs > 30_000) throw new Error("INVALID_INFERENCE_TIMEOUT");
  }

  async checkReady(): Promise<void> {
    try {
      const version = await this.runner({ args: ["--version"], stdin: "", environment: this.environment, signal: AbortSignal.timeout(5_000) });
      if (version.exitCode !== 0 || !supportedVersions.has(version.stdout.trim())) throw new Error();
      // The CLI reports this status on stderr; never expose its raw output.
      const login = await this.runner({ args: ["login", "status"], stdin: "", environment: this.environment, captureStderr: true, signal: AbortSignal.timeout(5_000) });
      if (login.exitCode !== 0 || !login.stdout.split(/\r?\n/).includes("Logged in using ChatGPT")) throw new Error();
    } catch { throw new InferenceError("INFERENCE_UNAVAILABLE"); }
  }

  async decide(packet: ContextPacket): Promise<AgentDecision> {
    const stdin = JSON.stringify(ContextPacketSchema.parse(packet));
    if (Buffer.byteLength(stdin) > 65_536) throw new InferenceError("INVALID_DECISION");
    const controller = new AbortController();
    const signal = this.options.signal ? AbortSignal.any([controller.signal, this.options.signal]) : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.runner({ stdin, environment: this.environment, signal, args: [
          "exec", "--strict-config", "--model", this.options.model, "--json", "--color", "never", "--skip-git-repo-check",
          "--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "read-only",
          ...disabledFeatures.flatMap(feature => ["-c", `features.${feature}=false`]),
          "-c", "features.skip_host_skill_discovery=true",
          "-c", "suppress_unstable_features_warning=true",
          "-c", 'approval_policy="never"', "-c", 'web_search="disabled"', "-c", "mcp_servers={}",
          "-c", "project_doc_max_bytes=0", "-c", "model_reasoning_effort=\"low\"",
          "-c", `developer_instructions=${JSON.stringify(systemPrompt)}`, "-",
        ] }),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new InferenceError("INFERENCE_TIMEOUT")); }, this.timeoutMs); }),
      ]);
      if (result.exitCode !== 0) throw new InferenceError("INFERENCE_UNAVAILABLE");
      try {
        if (Buffer.byteLength(result.stdout) > 65_536) throw new Error();
        let turnStarted = false;
        let notices = 0;
        const events = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line) as { type?: string; item?: { type?: string; text?: string; message?: string } }).filter(event => {
          // This exact CLI 0.152.1 startup notice confirms a deliberately
          // disabled capability. No other error or in-turn notice is ignored.
          if (!turnStarted && event.type === "item.completed" && event.item?.type === "error" && event.item.message === disabledHostNotice && notices++ === 0) return false;
          if (event.type === "turn.started") turnStarted = true;
          return true;
        });
        const completed = events.filter(e => e.type === "turn.completed");
        const messages = events.filter(e => e.type === "item.completed" && e.item?.type === "agent_message");
        if (completed.length !== 1 || messages.length !== 1 || events.some(e => !["thread.started", "turn.started", "turn.completed", "item.started", "item.completed"].includes(e.type ?? "") || e.item && !["reasoning", "agent_message"].includes(e.item.type ?? ""))) throw new Error();
        return AgentDecisionSchema.parse(JSON.parse(messages[0]!.item!.text!));
      } catch { throw new InferenceError("INVALID_DECISION"); }
    } catch (error) { throw error instanceof InferenceError ? error : new InferenceError("INFERENCE_UNAVAILABLE"); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
}
