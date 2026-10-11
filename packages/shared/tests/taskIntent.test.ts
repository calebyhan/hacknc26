import { describe, expect, it } from "vitest";
import { classifyTaskStaffingIntent } from "../taskIntent";

describe("verified staffing text guard (no model or provider)", () => {
  it.each([
    "can Yewon also join me on cleanup? we need two people",
    "Can Yewon help with cleanup?",
    "Add Yewon to the cleanup team",
    "Yewon should work alongside Caleb on cleanup",
    "Add Yewon without replacing Caleb",
    "Add Yewon; don't replace Caleb",
  ])("recognizes an additional teammate: %s", text => expect(classifyTaskStaffingIntent(text)).toBe("add"));
  it.each([
    "Can Yewon replace Caleb on cleanup?",
    "Can Yewon cover for me instead?",
    "Ask Yewon to take over cleanup",
  ])("recognizes explicit replacement: %s", text => expect(classifyTaskStaffingIntent(text)).toBe("replace"));
  it.each([
    "Add Yewon or replace Caleb on cleanup",
    "Don't add Yewon to cleanup",
    "Yewon can't help with cleanup",
  ])("does not infer an action from mixed/negative cues: %s", text => expect(classifyTaskStaffingIntent(text)).toBe("ambiguous"));
  it.each(["Can Yewon cover cleanup?", "Who is covering cleanup?", "cleanup"])("leaves unspecified staffing intent to clarification: %s", text => expect(classifyTaskStaffingIntent(text)).toBe("unspecified"));
});
