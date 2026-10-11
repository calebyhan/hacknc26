import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { exampleAgentDecision, exampleContextPacket } from "../../packages/shared/fixtures";
import { runCommand } from "../src/claude.ts";
import { CodexInferenceProvider } from "../src/codex.ts";

/** Opt-in installed-CLI check. The mock rejects every request: no model or tool
 * executes, no API key is supplied, and no account/backend state is changed. */
describe.skipIf(process.env.RALLY_VERIFY_CODEX_CAPABILITIES !== "1")("installed Codex tool registration against a local mock", () => {
  it("registers no tools under the actual adapter restrictions", async () => {
    const requests: { authorization: boolean; tools: unknown; model: unknown }[] = [];
    const server = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += String(chunk); });
      request.on("end", () => {
        if (request.method === "POST" && request.url?.endsWith("/responses")) {
          const parsed = JSON.parse(body) as { tools?: unknown; model?: unknown };
          // Responses permits omission when no tool definitions are exposed.
          requests.push({ authorization: Boolean(request.headers.authorization), tools: parsed.tools ?? [], model: parsed.model });
        }
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Local inventory only; no model execution", type: "probe_complete" } }));
      });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    try {
      const port = (server.address() as AddressInfo).port;
      const provider = new CodexInferenceProvider({ model: "gpt-5.6-luna", runner: async request => {
        const localProvider = [
          "-c", 'model_provider="rally_probe"',
          "-c", `model_providers.rally_probe={name="Local capability inventory",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false,request_max_retries=0,stream_max_retries=0}`,
          "-c", "features.enable_request_compression=false",
        ];
        // Preserve every runtime restriction. Change only the transport to a
        // local no-auth mock and disable compression so its request is readable.
        const result = await runCommand("codex", { ...request, args: [...request.args.slice(0, -1), ...localProvider, "-"], signal: AbortSignal.timeout(15_000) });
        expect(result.exitCode).not.toBe(0);
        return { exitCode: 0, stdout: [
          { type: "turn.started" },
          { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(exampleAgentDecision) } },
          { type: "turn.completed" },
        ].map(item => JSON.stringify(item)).join("\n") };
      } });
      await provider.decide(exampleContextPacket);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual({ authorization: false, model: "gpt-5.6-luna", tools: [] });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, 20_000);
});
