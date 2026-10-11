import { describe, expect, it } from "vitest";
import { parseCommand, proposalReferenceMatches } from "./commands";

describe("explicit offer replies", () => {
  it.each(["whats my status", "what's my status?", "what’s my status", "show my status", "my status", "what am I assigned to", "  WHAT AM I ASSIGNED TO?!  "])("treats exact read-only status alias '%s' as deterministic STATUS", text => {
    expect(parseCommand(text)).toEqual({ type: "STATUS" });
  });
  it.each(["don't show my status", "show my status and cancel setup", "what am I assigned to tomorrow", "change my status", "my status is unavailable", "what's Sam's status", "show my\nstatus"])("does not steal a broader or negated request '%s'", text => {
    expect(parseCommand(text).type).toBe("UNKNOWN");
  });
  it("keeps bare answers and accepts targeted task and overlap replies", () => {
    expect(parseCommand("YES")).toEqual({ type: "YES" });
    expect(parseCommand("yes setup!")).toEqual({ type: "YES", proposalRef: "setup" });
    expect(parseCommand("NO A1B2C3")).toEqual({ type: "NO", proposalRef: "A1B2C3" });
    expect(parseCommand("confirm overlap setup")).toEqual({ type: "CONFIRM_OVERLAP", proposalRef: "setup" });
    expect(parseCommand("yes, create it").type).toBe("UNKNOWN");
    expect(parseCommand("maybe yes").type).toBe("UNKNOWN");
    expect(parseCommand("YES setup\nNO cleanup").type).toBe("UNKNOWN");
  });
  it("matches exact task names, IDs or short references, not substrings", () => {
    expect(proposalReferenceMatches("SETUP", "proposalabc123", "setup")).toBe(true);
    expect(proposalReferenceMatches("ABC123", "proposalabc123", "setup")).toBe(true);
    expect(proposalReferenceMatches("set", "proposalabc123", "setup")).toBe(false);
  });
});
