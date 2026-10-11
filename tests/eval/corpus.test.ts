import { describe, expect, it } from "vitest";
import { FakeInferenceProvider } from "../../packages/shared/adapters";
import { AgentDecisionSchema } from "../../packages/shared/agentDecision";
import { evalCorpus, gradeDecision } from "./corpus";

describe("29-case evaluation harness (scripted simulation, no accuracy claim)", () => {
  it("covers the original 20 utterances plus participant and task-selection regressions", () => { expect(evalCorpus).toHaveLength(29); expect(new Set(evalCorpus.map((c) => c.packet.incomingText)).size).toBe(29); });
  it("rejects an assignment to the wrong opaque participant or task", () => {
    const testCase = evalCorpus.find(c => c.id === "21")!;
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "setup", toParticipantRef: "fixture_p_812" }] })).toBe(false);
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "unknown", toParticipantRef: "Caleb" }] })).toBe(false);
  });
  it.each(["24", "25"])("%s grades the exact selected task and target participant", (id) => {
    const testCase = evalCorpus.find(item => item.id === id)!;
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "fixture_t_496", toParticipantRef: "fixture_p_812" }] })).toBe(false);
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "fixture_t_207", toParticipantRef: "fixture_p_983" }] })).toBe(false);
  });
  it("rejects replacing an existing teammate when the request is to fill the second place", () => {
    const testCase = evalCorpus.find(item => item.id === "26")!;
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_REASSIGNMENT", taskRef: "fixture_t_682", fromParticipantRef: "fixture_p_194", toParticipantRef: "fixture_p_573" }] })).toBe(false);
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "fixture_t_682", toParticipantRef: "fixture_p_826" }] })).toBe(false);
  });
  it("grades explicit replacement against the exact task, prior teammate and new teammate", () => {
    const testCase = evalCorpus.find(item => item.id === "27")!;
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_REASSIGNMENT", taskRef: "fixture_t_682", fromParticipantRef: "fixture_p_826", toParticipantRef: "fixture_p_573" }] })).toBe(false);
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "fixture_t_682", toParticipantRef: "fixture_p_573" }] })).toBe(false);
  });
  it.each(["28", "29"])("%s requires clarification instead of inventing a replacement", id => {
    const testCase = evalCorpus.find(item => item.id === id)!;
    expect(gradeDecision(testCase, { ...testCase.scriptedDecision, confidenceClass: "clear", needsClarification: false, actions: [{ type: "PROPOSE_REASSIGNMENT", taskRef: "fixture_t_682", fromParticipantRef: "fixture_p_194", toParticipantRef: "fixture_p_573" }] })).toBe(false);
  });
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
