import { describe, expect, it } from "vitest";
import { parseCommand } from "../commands";
import { renderMessage } from "../copy";

describe("Lane A deterministic commands", () => {
  it.each(["YES", " yes! ", "Yes.", "yes,"])("accepts an explicit %s", (text) => {
    expect(parseCommand(text)).toEqual({ type: "YES" });
  });
  it.each(["maybe", "probably", "yes but no", "yesterday", "no problem", "YES\nSTOP"])("does not authorize equivocal %s", (text) => {
    expect(parseCommand(text).type).toBe("UNKNOWN");
  });
  it("preserves references while parsing the command case insensitively", () => {
    expect(parseCommand(" join aB12! ")).toEqual({ type: "JOIN", code: "aB12" });
    expect(parseCommand("leave Charity 5K.")).toEqual({ type: "LEAVE", eventRef: "Charity 5K" });
    for (const type of ["NO", "STATUS", "HELP", "STOP", "PAUSE", "RESUME"]) {
      expect(parseCommand(type.toLowerCase() + "!")).toEqual({ type });
    }
    expect(parseCommand("JOIN").type).toBe("UNKNOWN");
  });
  it("describes a failed send without inventing an assignment", () => {
    expect(renderMessage({ type: "delivery_failure", participantName: "Jordan", taskTitle: "setup", taskStatus: "needs_coverage" })).toContain("still needs coverage");
    expect(renderMessage({ type: "proposal_pending", participantName: "Jordan", taskTitle: "setup" })).toContain("waiting");
  });
});
