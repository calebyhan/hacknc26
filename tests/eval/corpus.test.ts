import { describe, expect, it } from "vitest";
import { FakeInferenceProvider } from "../../packages/shared/adapters";
import { AgentDecisionSchema } from "../../packages/shared/agentDecision";
import { evalCorpus, gradeDecision } from "./corpus";

describe("20-case evaluation harness (scripted simulation, no accuracy claim)", () => {
  it("covers exactly 20 distinct utterances", () => { expect(evalCorpus).toHaveLength(20); expect(new Set(evalCorpus.map((c) => c.packet.incomingText)).size).toBe(20); });
  it.each(evalCorpus)("$id: validates and grades its scripted $expected", async (testCase) => {
    const provider = new FakeInferenceProvider({ [testCase.packet.incomingText]: testCase.scriptedDecision });
    expect(gradeDecision(testCase, await provider.decide(testCase.packet))).toBe(true);
  });
  it("detects a valid but semantically wrong action instead of grading JSON alone", () => {
    const testCase = evalCorpus[0]!;
    const wrong = AgentDecisionSchema.parse({ ...testCase.scriptedDecision, actions: [{ type: "REQUEST_STATUS" }] });
    expect(gradeDecision(testCase, wrong)).toBe(false);
  });
});
