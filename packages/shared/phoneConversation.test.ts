import { describe, expect, it } from "vitest";
import { normalizeSelectedPhone, parseFriendlyInstant, parseTimezone, parseWizardStart, taskContinuationInput } from "./phoneConversation";

describe("guided phone setup parsing (no inference)", () => {
  it("recognizes explicit wizard starts without consuming arbitrary conversation", () => {
    expect(parseWizardStart("Create an event")).toBe("event");
    expect(parseWizardStart("new event")).toBe("event");
    expect(parseWizardStart("plan an event")).toBe("event");
    expect(parseWizardStart("invite someone")).toBe("invite");
    expect(parseWizardStart("add a task")).toBe("task");
    expect(parseWizardStart("Can Jordan help?")).toBeNull();
    expect(parseWizardStart("YES")).toBeNull();
  });
  it("keeps next-task names distinct from conversational instructions and missing-title time fragments", () => {
    for (const title of ["speakers", "cleanup", "check-in", "A/V support"]) expect(taskContinuationInput(title)).toBe("title");
    for (const text of ["Can Maya cover setup?", "I can help with cleanup", "approve speakers", "what's my status", "Who can help?", "Maya can cover setup", "no thanks", "yes, please"]) expect(taskContinuationInput(text)).toBe("conversation");
    for (const text of ["", "1:30 PM", "2", "two\nlines"]) expect(taskContinuationInput(text)).toBe("invalid");
  });
  it("normalizes only explicit country-code numbers and reports specific errors", () => {
    expect(normalizeSelectedPhone("+1 (555) 000-0002")).toEqual({ phone: "+15550000002" });
    expect(normalizeSelectedPhone("555 000 0002").error).toContain("country code");
    expect(normalizeSelectedPhone("+1 555 CALL ME").error).toContain("digits");
    expect(normalizeSelectedPhone("+123").error).toContain("8–15");
  });
  it("uses an explicitly selected timezone, never the host zone", () => {
    expect(parseTimezone("Eastern")).toBe("America/New_York");
    expect(parseTimezone("Pacific")).toBe("America/Los_Angeles");
    expect(parseTimezone("Mars")).toBeNull();
    expect(parseFriendlyInstant("Oct 18, 2026 at 2:30 PM", "America/New_York")).toEqual({ timestamp: Date.parse("2026-10-18T18:30:00Z") });
    expect(parseFriendlyInstant("Oct 18, 2026 at 2:30 PM", "Eastern")).toEqual({ timestamp: Date.parse("2026-10-18T18:30:00Z") });
    expect(parseFriendlyInstant("2026-10-18 2:30 PM", "America/Los_Angeles")).toEqual({ timestamp: Date.parse("2026-10-18T21:30:00Z") });
  });
  it("rejects ambiguous dates, invalid days and daylight-saving gaps or repeated times", () => {
    for (const value of ["10/11 at 2", "tomorrow", "Feb 30, 2026 2 PM", "Nov 1, 2026 1:30 AM", "Mar 8, 2026 2:30 AM"]) {
      expect(parseFriendlyInstant(value, "America/New_York").error).toBeTruthy();
    }
    expect(parseFriendlyInstant("3 PM", "America/New_York", Date.parse("2026-10-18T18:00:00Z"))).toEqual({ timestamp: Date.parse("2026-10-18T19:00:00Z") });
  });
});
