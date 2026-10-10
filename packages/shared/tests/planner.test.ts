import { describe, expect, it } from "vitest";
import { seedFixture, fixtureIds } from "../fixtures";
import { filterEligibleCandidates, rankCandidates, type PlanningInput } from "../planner";
import { findAffectedTasks } from "../assignment";

function fixture(): PlanningInput {
  const f = structuredClone(seedFixture);
  return { event: f.events[0]!, task: { ...f.tasks[0]!, status: "needs_coverage" }, users: f.users, memberships: f.memberships, tasks: f.tasks, commitments: [], availability: f.availability, now: f.users[0]!.createdAt };
}
describe("replacement planner (simulation)", () => {
  it("ranks explicit availability first; unknown availability still requires both approvals", () => {
    const ranking = rankCandidates(fixture());
    expect(ranking.candidates[0]).toMatchObject({ participantId: fixtureIds.jordan, score: 2 });
    expect(ranking.candidates.find(c => c.participantId === fixtureIds.maya)?.reasonCodes).toContain("AVAILABILITY_UNKNOWN_REQUIRES_CONFIRMATION");
    expect(ranking.candidates.every(c => c.reasonCodes.includes("PARTICIPANT_ACCEPTANCE_REQUIRED") && c.reasonCodes.includes("ORGANIZER_APPROVAL_REQUIRED"))).toBe(true);
  });
  it.each(["overlap", "stopped", "invited", "no-consent", "missing-skill", "unavailable", "unknown-window"])("removes candidates violating %s", reason => {
    const f = fixture(), user = f.users.find(u => u.id === fixtureIds.jordan)!, membership = f.memberships.find(m => m.userId === user.id && m.eventId === f.event.id)!;
    if (reason === "stopped") user.messagingState = "stopped";
    if (reason === "invited") membership.state = "invited";
    if (reason === "no-consent") delete membership.consentSourceMessageId;
    if (reason === "missing-skill") f.task.requiredSkills = ["medical"];
    if (reason === "unavailable") f.availability.push({ id: "unavailable", userId: user.id, eventId: f.event.id, windowStart: f.task.windowStart!, windowEnd: f.task.windowEnd!, kind: "unavailable", source: "self_reported", reportedByUserId: user.id, recordedAt: f.now + 1 });
    if (reason === "overlap" || reason === "unknown-window") {
      f.tasks.push({ ...f.task, id: "other", ...(reason === "overlap" ? {} : { windowStart: undefined, windowEnd: undefined }) });
      f.commitments.push({ id: "busy", eventId: f.event.id, taskId: "other", participantId: user.id, state: "active", createdAt: f.now });
    }
    expect(filterEligibleCandidates(f)).not.toContain(user.id);
  });
  it("breaks equal scores by ID regardless of input order", () => {
    const f = fixture(); f.availability = [];
    const first = rankCandidates(f).candidates.map(c => c.participantId);
    f.users.reverse(); f.memberships.reverse();
    expect(rankCandidates(f).candidates.map(c => c.participantId)).toEqual(first);
    expect(first).toEqual([...first].sort());
  });
  it("reports no match and rejects invalid dependencies or full capacity", () => {
    const f = fixture(); f.task.requiredSkills = ["unrecorded"];
    expect(rankCandidates(f)).toEqual({ candidates: [], reasonCodes: ["NO_ELIGIBLE_CANDIDATE"] });
    delete f.task.requiredSkills; f.task.dependsOnTaskIds = ["missing"];
    expect(filterEligibleCandidates(f)).toEqual([]);
    delete f.task.dependsOnTaskIds; f.commitments = structuredClone(seedFixture.commitments);
    expect(filterEligibleCandidates(f)).toEqual([]);
  });
  it("considers obligations only in the selected event; computes its dependent closure", () => {
    const f = fixture();
    f.commitments.push({ id: "private-obligation", eventId: fixtureIds.hackNight, taskId: fixtureIds.hackSetup, participantId: fixtureIds.jordan, state: "active", createdAt: f.now });
    expect(filterEligibleCandidates(f)).toContain(fixtureIds.jordan);
    f.tasks.push({ ...f.task, id: "dependent", dependsOnTaskIds: [f.task.id] }, { ...f.task, id: "downstream", dependsOnTaskIds: ["dependent"] }, { ...f.task, id: "private", eventId: fixtureIds.hackNight, dependsOnTaskIds: [f.task.id] });
    expect(findAffectedTasks(f.tasks, f.task.id)).toEqual([f.task.id, "dependent", "downstream"].sort());
  });
});
