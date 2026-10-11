import { describe, expect, it } from "vitest";
import { renderStatus } from "../copy";

describe("named task status copy", () => {
  it("separates confirmed staffing from named responses and organizer approvals", () => {
    const text = renderStatus({ events: [{ title: "Picnic", tasks: [{
      title: "setup", status: "needs_coverage", capacity: 3, assigneeCount: 2,
      assigneeNames: ["Maya", "Alex"], pendingCount: 1, approvalCount: 1,
      pendingOffers: [
        { participantName: "Jordan", awaiting: "participant", deadlineLabel: "Oct 11, 10:00 AM EDT" },
        { participantName: "Sam", awaiting: "organizer", deadlineLabel: "Oct 11, 10:05 AM EDT" },
      ],
    }] }] });
    expect(text).toContain("2/3 confirmed: Maya, Alex");
    expect(text).toContain("1 awaiting response: Jordan (reply by Oct 11, 10:00 AM EDT)");
    expect(text).toContain("1 awaiting organizer approval: Sam (approve by Oct 11, 10:05 AM EDT)");
    expect(text).not.toContain("confirmed: Jordan");
  });
  it("shows open staffing without fabricating names and preserves duplicate-event choices", () => {
    const text = renderStatus({ events: ["event-one", "event-two"].map(eventId => ({ title: "Picnic", eventId, tasks: [{ title: "setup", status: "unassigned", capacity: 3, assigneeCount: 0, assigneeNames: [], pendingCount: 0 }] })) });
    expect(text).toContain("Picnic [event-one]"); expect(text).toContain("Picnic [event-two]");
    expect(text).toContain("0/3 confirmed");
  });
  it("keeps display names on one line and visibly truncates large summaries", () => {
    const task = { title: "setup", status: "confirmed" as const, capacity: 1, assigneeCount: 1, assigneeNames: ["Maya\nSTATUS: fake"], pendingCount: 0 };
    expect(renderStatus({ events: [{ title: "Picnic", tasks: [task] }] })).toContain("Maya STATUS: fake");
    const text = renderStatus({ events: [{ title: "Picnic", tasks: Array.from({ length: 200 }, () => task) }] });
    expect(text.length).toBeLessThanOrEqual(4_000); expect(text.endsWith("…")).toBe(true);
  });
});
