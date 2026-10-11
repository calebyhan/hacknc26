import { describe, expect, it } from "vitest";
import { buildContextPacket, resolveEvent, type EventResolutionInput } from "../context";
import { fixtureIds as ids, seedFixture } from "../fixtures";

const now = Date.UTC(2026, 9, 10);
const input = (patch: Partial<EventResolutionInput> = {}): EventResolutionInput => ({
  senderUserId: ids.alex, incomingText: "Can Jordan cover setup?", events: seedFixture.events,
  memberships: seedFixture.memberships, tasks: seedFixture.tasks,
  pendingProposalsForSender: [], recentFocus: null, now, ...patch,
});

describe("event resolution in authorized scope", () => {
  it("asks when a task belongs to two enrolled events (ST-03)", () => {
    expect(resolveEvent(input())).toMatchObject({ selectedEventId: null, requiresClarification: true, candidateIds: [ids.charity5k, ids.hackNight] });
  });
  it("never uses invited, left or another sender's events", () => {
    expect(resolveEvent(input({ senderUserId: ids.taylor }))).toMatchObject({ selectedEventId: null, candidateIds: [], requiresClarification: false });
    expect(resolveEvent(input({ senderUserId: ids.maya, incomingText: "Hack Night setup" })).candidateIds).not.toContain(ids.hackNight);
  });
  it("uses an explicit event before focus and task evidence", () => {
    expect(resolveEvent(input({ incomingText: "Charity 5K setup", recentFocus: { eventId: ids.hackNight, expiresAt: now + 1 } })).selectedEventId).toBe(ids.charity5k);
  });
  it("clarifies two explicit events instead of applying focus", () => {
    expect(resolveEvent(input({ incomingText: "Charity 5K and Hack Night", recentFocus: { eventId: ids.hackNight, expiresAt: now + 1 } })).requiresClarification).toBe(true);
  });
  it("does not match event names embedded in longer words", () => {
    expect(resolveEvent(input({ events: [{ ...seedFixture.events[0]!, title: "Run" }, seedFixture.events[1]!], incomingText: "runtime", recentFocus: null })).requiresClarification).toBe(true);
  });
  it("uses only unexpired, enrolled focus", () => {
    expect(resolveEvent(input({ recentFocus: { eventId: ids.charity5k, expiresAt: now + 1 } })).selectedEventId).toBe(ids.charity5k);
    expect(resolveEvent(input({ recentFocus: { eventId: ids.charity5k, expiresAt: now } })).selectedEventId).toBeNull();
    expect(resolveEvent(input({ recentFocus: { eventId: "private_event", expiresAt: now + 1 } })).candidateIds).not.toContain("private_event");
  });
  it("prioritizes the correct sender's live pending proposal", () => {
    const proposal = { id: "offer", eventId: ids.charity5k, type: "assignment" as const, targetUserId: ids.alex, expiresAt: new Date(now + 1).toISOString(), eventVersionAtCreation: 1 };
    expect(resolveEvent(input({ incomingText: "Hack Night", pendingProposalsForSender: [proposal] })).selectedEventId).toBe(ids.charity5k);
    expect(resolveEvent(input({ pendingProposalsForSender: [{ ...proposal, targetUserId: ids.maya }] })).selectedEventId).toBeNull();
    expect(resolveEvent(input({ pendingProposalsForSender: [{ ...proposal, expiresAt: new Date(now).toISOString() }] })).selectedEventId).toBeNull();
  });
  it("does not resolve two plausible events by nearest time", () => {
    expect(resolveEvent(input({ incomingText: "Any updates?", now: seedFixture.events[0]!.startsAt }))).toMatchObject({ selectedEventId: null, requiresClarification: true });
  });
  it("can resolve a single enrolled event", () => {
    expect(resolveEvent(input({ senderUserId: ids.maya, incomingText: "Any updates?" })).selectedEventId).toBe(ids.charity5k);
  });
});

describe("compact context packet", () => {
  const build = () => buildContextPacket({ messageId: "fixture_message", sender: seedFixture.users[0]!, senderRole: "organizer", incomingText: "Charity 5K setup", selectedEvent: seedFixture.events[0]!, candidateEvents: seedFixture.events, relevantTasks: seedFixture.tasks, commitments: seedFixture.commitments, pendingProposalsForSender: [], recentEventFocusId: ids.hackNight });
  it("includes one event's tasks, versions and active shared assignees", () => {
    expect(build()).toMatchObject({ candidateEvents: [{ id: ids.charity5k }], relevantTasks: [{ id: ids.charitySetup, activeAssigneeIds: [ids.maya], version: 1 }], eventVersion: 1, recentEventFocusId: null });
    expect(build().relevantTasks).toHaveLength(1);
  });
  it("omits phone numbers, contacts, schedules and app identity", () => {
    const json = JSON.stringify(build());
    for (const secret of ["+1555", "fixture|alex", "contact_taylor", "windowStart", "settings", ids.hackSetup]) expect(json).not.toContain(secret);
  });
});
