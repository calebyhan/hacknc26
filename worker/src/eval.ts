import { FakeInferenceProvider } from "../../packages/shared/adapters.ts";
import type { InferenceProvider } from "../../packages/shared/adapters.ts";
import { evalCorpus, gradeDecision } from "../../tests/eval/corpus.ts";
import { createProvider } from "./provider.ts";
import { InferenceError } from "./claude.ts";

const live = process.argv.includes("--live");
try {
  const requestedCase = process.argv.find(arg => arg.startsWith("--case="))?.slice("--case=".length);
  const cases = requestedCase ? evalCorpus.filter(testCase => testCase.id === requestedCase) : evalCorpus;
  if (!cases.length) throw new Error();
  let provider: InferenceProvider;
  if (live) {
    const name = process.env.RALLY_PROVIDER ?? "claude";
    if (name !== "claude" && name !== "codex") throw new Error();
    const local = createProvider(name, process.env.RALLY_MODEL ?? "");
    await local.checkReady();
    provider = local;
  } else provider = new FakeInferenceProvider(Object.fromEntries(evalCorpus.map((testCase) => [testCase.packet.incomingText, testCase.scriptedDecision])));
  const results: { id: string; expected: string; passed: boolean; latencyMs: number; errorCategory?: string; actionTypes?: string[] }[] = [];
  for (const testCase of cases) {
    const started = performance.now();
    let passed = false;
    let errorCategory: string | undefined;
    let actionTypes: string[] | undefined;
    try { const decision = await provider.decide(testCase.packet); actionTypes = decision.actions.map(action => action.type); passed = gradeDecision(testCase, decision); }
    catch (error) { errorCategory = error instanceof InferenceError ? error.message : "EVALUATION_ERROR"; }
    const result = { id: testCase.id, expected: testCase.expected, passed, latencyMs: Math.round(performance.now() - started), ...(errorCategory ? { errorCategory } : {}), ...(actionTypes ? { actionTypes } : {}) };
    results.push(result);
    if (live) console.info(JSON.stringify({ progress: result.id, passed, ...(errorCategory ? { errorCategory } : {}), ...(actionTypes ? { actionTypes } : {}) }));
  }
  const timings = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  console.info(JSON.stringify({ simulation: !live, provider: live ? process.env.RALLY_PROVIDER ?? "claude" : "fake", note: live ? "Synthetic inputs with real inference; grade checks scope and action types, not Domain execution" : "Scripted harness validation only; no model accuracy measurement", passed: results.filter((result) => result.passed).length, total: results.length, p50Ms: timings[Math.ceil(timings.length * 0.5) - 1], p95Ms: timings[Math.ceil(timings.length * 0.95) - 1], results }, null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
} catch {
  console.error("Evaluation unavailable. Check RALLY_PROVIDER, RALLY_MODEL and provider login; no credential values were logged.");
  process.exitCode = 1;
}
