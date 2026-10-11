import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { renderStatusDetails } from "./lib/statusText";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse("2026-10-11T04:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const users = [];
    for (const displayName of ["Alex", "Maya", "Jordan", "Sam", "Private person", "Invited contact"]) users.push(await ctx.db.insert("users", { displayName, messagingState: "active", createdAt: Date.now(), settings: {} }));
    const [alex, maya, jordan, sam, other, invited] = users as [typeof users[number], typeof users[number], typeof users[number], typeof users[number], typeof users[number], typeof users[number]];
    const event = await ctx.db.insert("events", { title: "Picnic", kind: "event", ownerId: alex, startsAt: Date.now() + 86_400_000, timezone: "America/New_York", status: "scheduled", version: 1 });
    const hidden = await ctx.db.insert("events", { title: "Private event", kind: "event", ownerId: other, startsAt: Date.now() + 86_400_000, timezone: "UTC", status: "scheduled", version: 1 });
    for (const userId of [alex, maya, jordan, sam]) await ctx.db.insert("memberships", { eventId: event, userId, role: userId === alex ? "organizer" : "member", state: "enrolled", notificationsEnabled: true });
    await ctx.db.insert("memberships", { eventId: event, userId: invited, role: "member", state: "invited", notificationsEnabled: false });
    await ctx.db.insert("memberships", { eventId: hidden, userId: other, role: "organizer", state: "enrolled", notificationsEnabled: true });
    const task = await ctx.db.insert("tasks", { eventId: event, title: "setup", capacity: 3, status: "needs_coverage", version: 1 });
    const privateTask = await ctx.db.insert("tasks", { eventId: hidden, title: "Private budget", capacity: 1, status: "confirmed", version: 1 });
    for (const participantId of [alex, maya]) await ctx.db.insert("commitments", { eventId: event, taskId: task, participantId, state: "active", createdAt: Date.now() });
    await ctx.db.insert("commitments", { eventId: hidden, taskId: privateTask, participantId: other, state: "active", createdAt: Date.now() });
    for (const [targetUserId, requiresOrganizerApproval] of [[jordan, false], [sam, true]] as const) await ctx.db.insert("proposals", { eventId: event, originatorId: alex, type: "assignment", targetTaskId: task, targetUserId, state: "pending", requiresOrganizerApproval, eventVersionAtCreation: 1, taskVersionAtCreation: 1, expiresAt: Date.now() + 600_000, idempotencyKey: `fixture-${targetUserId}` });
    return { alex, maya, jordan, sam, other, invited, event, hidden, task, privateTask };
  });
  return { t, ids, read: () => t.query(internal.domain.statusFor, { userId: ids.alex }) };
}

describe("named STATUS from authorized domain details (simulation)", () => {
  it("omits closed events from current phone status while retaining authorized history", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.ids.event, { status: "canceled", version: 2 }));
    const history = (await f.read()).events;
    expect(history).toHaveLength(1);
    expect(history[0]!.event.status).toBe("canceled");
    expect(renderStatusDetails(history)).toBe("You have no active events. Closed events remain available in the app.");
    expect(renderStatusDetails([])).toBe("You have no enrolled events.");
  });
  it("shows only committed people, staffing capacity and correctly staged offers with local deadlines", async () => {
    const f = await fixture();
    const text = renderStatusDetails((await f.read()).events);
    expect(text).toContain("2/3 confirmed: Alex, Maya");
    expect(text).toContain("1 awaiting response: Jordan (reply by Oct 11, 12:10 AM EDT)");
    expect(text).toContain("1 awaiting organizer approval: Sam (approve by Oct 11, 12:10 AM EDT)");
    expect(text).not.toContain("Private"); expect(text).not.toContain("Invited contact");
    expect(text).not.toContain("confirmed: Jordan");
    await expect(f.t.query(internal.domain.statusFor, { userId: f.ids.alex, eventId: f.ids.hidden })).rejects.toThrow("UNAUTHORIZED");
  });
  it("removes expired and version-stale offers without changing confirmed staffing", async () => {
    const f = await fixture();
    const initial = (await f.read()).events;
    vi.advanceTimersByTime(600_000);
    expect(renderStatusDetails(initial)).not.toContain("awaiting");
    vi.setSystemTime(Date.parse("2026-10-11T04:00:00Z"));
    await f.t.run(ctx => ctx.db.patch(f.ids.task, { version: 2 }));
    const text = renderStatusDetails((await f.read()).events);
    expect(text).not.toContain("awaiting"); expect(text).toContain("2/3 confirmed: Alex, Maya");
  });
  it("does not resolve foreign or invited IDs and drops cross-event task/proposal rows", async () => {
    const f = await fixture();
    const detail = (await f.read()).events[0]!;
    const hidden = (await f.t.query(internal.domain.statusFor, { userId: f.ids.other })).events[0]!;
    detail.tasks[0]!.activeAssigneeIds = [f.ids.invited, f.ids.other];
    detail.tasks.push(...hidden.tasks);
    detail.proposals.push({ ...detail.proposals[0]!, eventId: f.ids.hidden });
    const text = renderStatusDetails([detail]);
    expect(text).toContain("2/3 confirmed: Participant, Participant");
    expect(text).toContain("1 awaiting response");
    expect(text).not.toContain("Private"); expect(text).not.toContain("Invited contact");
  });
});
