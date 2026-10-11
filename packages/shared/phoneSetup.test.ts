import { describe, expect, it } from "vitest";
import { parsePhoneSetupCommand } from "./phoneSetup";

describe("deterministic phone setup grammar", () => {
  it("requires explicit timestamps and validates the timezone and windows", () => {
    expect(parsePhoneSetupCommand("CREATE EVENT Picnic | 2026-10-12T14:00:00-04:00 | America/New_York | Park")).toMatchObject({ type: "CREATE_EVENT", title: "Picnic", location: "Park" });
    for (const text of ["CREATE EVENT Picnic | tomorrow | America/New_York", "CREATE EVENT Picnic | 2026-10-12T14:00:00 | America/New_York", "CREATE EVENT Picnic | 2026-10-12T18:00:00Z | Mars", "TASK Picnic | setup | 2026-10-12T18:00:00Z | 2026-10-12T17:00:00Z", "INVITE Picnic | Jordan | 5551234", "CONFIRM other 0", "CREATE EVENT X | 2026-02-30T18:00:00Z | UTC"]) {
      expect(parsePhoneSetupCommand(text)).toEqual({ type: "INVALID" });
    }
  });
  it("leaves unrelated natural language and frozen commands alone", () => {
    for (const text of ["Can Jordan cover setup?", "YES", "JOIN ABC", "STOP", "Create a picnic tomorrow"]) expect(parsePhoneSetupCommand(text)).toBeNull();
    expect(parsePhoneSetupCommand("CONFIRM event-id 1")).toEqual({ type: "CONFIRM_EVENT", eventId: "event-id", expectedVersion: 1 });
    expect(parsePhoneSetupCommand("APPROVE proposal-id")).toEqual({ type: "APPROVE_PROPOSAL", proposalId: "proposal-id" });
  });
});
