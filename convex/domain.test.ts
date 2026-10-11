import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import spectrumTest from "@spectrum-ts/convex/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sealEnvelope } from "./lib/messaging";
import { FakeMessagingAdapter } from "../packages/shared/adapters";
import { deliverWithAdapter } from "./lib/messagingDelivery";
import type { AgentAction, AgentDecision } from "../packages/shared/agentDecision";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture(capacity = 1) {
  const t = convexTest(schema, modules); spectrumTest.register(t, "spectrum");
  const ids = await t.run(async (ctx) => {
    const users = await Promise.all(["Alex", "Maya", "Jordan", "Sam"].map((displayName, i) => ctx.db.insert("users", { displayName, verifiedPhoneE164: `+1555000000${i + 1}`, ...(i === 0 ? { authSubject: "fixture|alex" } : {}), messagingState: "active", createdAt: Date.now(), settings: {} })));
    const [alex, maya, jordan, sam] = users;
    const event = await ctx.db.insert("events", { title: "Charity 5K", kind: "event", startsAt: Date.now() + 86400000, timezone: "America/New_York", ownerId: alex!, status: "scheduled", version: 1 });
    const task = await ctx.db.insert("tasks", { eventId: event, title: "setup", windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, capacity, status: capacity === 1 ? "confirmed" : "unassigned", version: 1 });
    return { alex: alex!, maya: maya!, jordan: jordan!, sam: sam!, event, task };
  });
  async function message(userId: typeof ids.alex, text: string) {
    const user = await t.run(ctx => ctx.db.get(userId));
    const providerMessageId = `fixture-${userId}-${text}-${Math.random()}`;
    const encrypted = await sealEnvelope({ text, spaceId: `any;-;${user!.verifiedPhoneE164}`, linePhone: "shared" }, `spectrum:${providerMessageId}:${user!.verifiedPhoneE164}`);
    return t.run(ctx => ctx.db.insert("inboundMessages", { provider: "spectrum", providerMessageId, senderPhone: user!.verifiedPhoneE164!, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted: encrypted, processingState: "received" }));
  }
  for (const [i, userId] of [ids.alex, ids.maya, ids.jordan, ids.sam].entries()) {
    const consent = await message(userId, "JOIN fixture");
    await t.run(ctx => ctx.db.insert("memberships", { userId, eventId: ids.event, role: i === 0 ? "organizer" : "member", state: "enrolled", notificationsEnabled: true, consentAt: Date.now(), consentSourceMessageId: consent }));
  }
  if (capacity === 1) await t.run(ctx => ctx.db.insert("commitments", { eventId: ids.event, taskId: ids.task, participantId: ids.maya, state: "active", createdAt: Date.now() }));
  const request = await message(ids.alex, "Can Jordan cover setup?");
  async function proposal(target = ids.jordan, type: "assignment" | "reassignment" = capacity === 1 ? "reassignment" : "assignment", originator = ids.alex) {
    return t.mutation(internal.proposals.create, { eventId: ids.event, originatorId: originator, sourceMessageId: originator === ids.alex ? request : await message(originator, "Can Jordan cover setup?"), type, ...(type === "reassignment" ? { subjectId: ids.maya } : {}), targetTaskId: ids.task, targetUserId: target, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 600000, idempotencyKey: `fixture:${target}:${originator}` });
  }
  return { t, ids, message, proposal, request };
}

function decision(eventCandidateId: string | null, actions: AgentAction[]): AgentDecision {
  return { schemaVersion: 1, eventCandidateId, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions, responseStyle: "concise", reasonCodes: [] };
}
async function job(f: Awaited<ReturnType<typeof fixture>>, text: string, actor = f.ids.alex, scoped = true) {
  const messageId = await f.message(actor, text);
  return f.t.run(ctx => ctx.db.insert("reasoningJobs", { messageId, eventId: scoped ? f.ids.event : null, contextVersion: scoped ? 1 : null, taskVersions: scoped ? [{ taskId: f.ids.task, version: 1 }] : [], status: "claimed", attempts: 1, leaseOwner: "simulation-worker", leaseToken: "simulation-lease", leaseUntil: Date.now() + 60000 }));
}

describe("Lane B deterministic domain (simulation; no model or real provider)", () => {
  it("ST-04/05/07: pending leaves Maya active; verified YES commits once and notifies exactly once", async () => {
    const { t, ids, message, proposal } = await fixture();
    const p = await proposal();
    expect(await proposal()).toBe(p);
    expect(await t.run(ctx => ctx.db.get(ids.task))).toMatchObject({ status: "confirmed", version: 1 });
    const fake = new FakeMessagingAdapter();
    const request = (await t.run(ctx => ctx.db.query("outboundMessages").collect()))[0]!;
    await t.action(async ctx => deliverWithAdapter(ctx, request._id, () => fake));
    const yes = await message(ids.jordan, "YES");
    expect(await t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: yes, response: "accept" })).toBe("accepted");
    expect(await t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: yes, response: "accept" })).toBe("accepted");
    const commitments = await t.run(ctx => ctx.db.query("commitments").collect());
    expect(commitments.filter(c => c.state === "active").map(c => c.participantId)).toEqual([ids.jordan]);
    expect(commitments.find(c => c.participantId === ids.maya)?.state).toBe("released");
    expect(await t.run(ctx => ctx.db.get(ids.task))).toMatchObject({ version: 2 });
    expect(await t.run(ctx => ctx.db.get(ids.event))).toMatchObject({ version: 1 });
    const outbox = await t.run(ctx => ctx.db.query("outboundMessages").collect());
    expect(outbox).toHaveLength(4); // one request, one notice per affected person
    for (const row of outbox) await t.action(async ctx => deliverWithAdapter(ctx, row._id, () => fake));
    expect(fake.sends).toHaveLength(4);
  });
  it("ST-06/09: NO preserves Maya; maybe and another sender cannot approve", async () => {
    const { t, ids, message, proposal } = await fixture(); const p = await proposal();
    await expect(t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: await message(ids.jordan, "maybe"), response: "accept" })).rejects.toThrow();
    await expect(t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.maya, sourceMessageId: await message(ids.maya, "YES"), response: "accept" })).rejects.toThrow("UNAUTHORIZED");
    expect(await t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: await message(ids.jordan, "NO"), response: "decline" })).toBe("declined");
    expect((await t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([ids.maya]);
  });
  it.each(["event", "task", "expiry"])("ST-08: %s staleness cannot commit", async kind => {
    const { t, ids, message, proposal } = await fixture(); const p = await proposal();
    if (kind === "expiry") vi.advanceTimersByTime(600001);
    else await t.run(ctx => ctx.db.patch(kind === "event" ? ids.event : ids.task, { version: 2 }));
    expect(await t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: await message(ids.jordan, "YES"), response: "accept" })).toBe("expired");
    expect((await t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([ids.maya]);
  });
  it("ST-13: two concurrent acceptances leave exactly one winner", async () => {
    const { t, ids, message, proposal } = await fixture();
    const p = await proposal(), q = await proposal(ids.sam);
    await Promise.all([t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: await message(ids.jordan, "YES"), response: "accept" }), t.mutation(internal.proposals.respond, { proposalId: q, actorId: ids.sam, sourceMessageId: await message(ids.sam, "YES"), response: "accept" })]);
    expect((await t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active")).toHaveLength(1);
    expect((await t.run(ctx => ctx.db.query("proposals").collect())).map(p => p.state).sort()).toEqual(["accepted", "superseded"]);
  });
  it("ST-18: organizer override releases; decline keeps coverage gap; third-party report cannot write", async () => {
    const { t, ids, message, proposal } = await fixture();
    const args = { eventId: ids.event, participantId: ids.maya, taskId: ids.task, expectedEventVersion: 1 };
    await expect(t.mutation(internal.commitments.reportUnavailable, { ...args, actorId: ids.jordan, sourceMessageId: await message(ids.jordan, "Maya can't make it") })).rejects.toThrow("UNAUTHORIZED");
    const unavailable = await message(ids.alex, "Maya can't make it");
    await t.mutation(internal.commitments.reportUnavailable, { ...args, actorId: ids.alex, sourceMessageId: unavailable });
    expect(await t.run(ctx => ctx.db.get(ids.task))).toMatchObject({ status: "needs_coverage", version: 2 });
    const p = await t.mutation(internal.proposals.create, { eventId: ids.event, originatorId: ids.alex, sourceMessageId: unavailable, type: "assignment", targetTaskId: ids.task, targetUserId: ids.jordan, expectedEventVersion: 1, expectedTaskVersion: 2, expiresAt: Date.now() + 60000, idempotencyKey: "replacement-after-cancel" });
    await t.mutation(internal.proposals.respond, { proposalId: p, actorId: ids.jordan, sourceMessageId: await message(ids.jordan, "NO"), response: "decline" });
    expect(await t.run(ctx => ctx.db.get(ids.task))).toMatchObject({ status: "needs_coverage" });
  });
  it("ST-10/17: public APIs authenticate and authorize; private events never appear in status", async () => {
    const { t, ids } = await fixture();
    await expect(t.query(api.events.detail, { eventId: ids.event })).rejects.toMatchObject({ data: { version: 1, code: "AUTHENTICATION_REQUIRED" } });
    const alex = t.withIdentity({ subject: "fixture|alex" });
    expect((await alex.query(api.events.myEvents, {})).map(e => e._id)).toEqual([ids.event]);
    const status = await t.query(internal.domain.statusFor, { userId: ids.jordan });
    expect(status.events).toHaveLength(1); expect(status.events[0]!.tasks[0]!.activeAssigneeIds).toEqual([ids.maya]);
    expect(JSON.stringify(status)).not.toContain("+1555");
  });
  it("ST-11: real command router handles pending YES and STATUS with the worker absent", async () => {
    const { t, ids, message, proposal } = await fixture(); await proposal();
    await t.mutation(internal.commands.route, { messageId: await message(ids.jordan, "YES") });
    await t.mutation(internal.commands.route, { messageId: await message(ids.jordan, "STATUS") });
    expect((await t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([ids.jordan]);
    expect(await t.run(ctx => ctx.db.query("reasoningJobs").collect())).toEqual([]);
    expect((await t.run(ctx => ctx.db.query("outboundMessages").collect())).some(row => row.content.includes("1 accepted"))).toBe(true);
  });
});

describe("Lane B setup and approvals (simulation)", () => {
  it("creates idempotent drafts/tasks, validates inputs, and bumps only the confirmed event", async () => {
    const f = await fixture(), alex = f.t.withIdentity({ subject: "fixture|alex" });
    const input = { title: "Another event", kind: "event" as const, startsAt: Date.now() + 86400000, timezone: "America/New_York", idempotencyKey: "create-event" };
    const eventId = await alex.mutation(api.events.create, input);
    expect(await alex.mutation(api.events.create, input)).toBe(eventId);
    await expect(alex.mutation(api.events.create, { ...input, title: "Conflicting retry" })).rejects.toMatchObject({ data: { version: 1, code: "IDEMPOTENCY_CONFLICT" } });
    await expect(alex.mutation(api.events.create, { ...input, timezone: "invalid", idempotencyKey: "invalid" })).rejects.toMatchObject({ data: { version: 1, code: "INVALID_INPUT" } });
    const taskInput = { eventId, title: "setup", windowStart: input.startsAt, windowEnd: input.startsAt + 3600000, expectedEventVersion: 1, idempotencyKey: "new-task" };
    const taskId = await alex.mutation(api.tasks.create, taskInput);
    expect(await alex.mutation(api.tasks.create, taskInput)).toBe(taskId);
    await expect(alex.mutation(api.tasks.create, { ...taskInput, windowEnd: input.startsAt, idempotencyKey: "bad-window" })).rejects.toMatchObject({ data: { version: 1, code: "INVALID_INPUT" } });
    expect(await f.t.run(ctx => ctx.db.get(eventId))).toMatchObject({ status: "draft", version: 1 });
    await alex.mutation(api.events.confirmDraft, { eventId, expectedVersion: 1 });
    await alex.mutation(api.events.confirmDraft, { eventId, expectedVersion: 1 });
    expect(await f.t.run(ctx => ctx.db.get(eventId))).toMatchObject({ status: "scheduled", version: 2 });
    expect(await f.t.run(ctx => ctx.db.get(taskId))).toMatchObject({ status: "unassigned", version: 1 });
    expect((await alex.query(api.events.detail, { eventId })).tasks[0]?.displayLabel).toBe("needs_coverage");
    expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
  it("ST-10: outsiders, invited users, and missing events return the same authorization error", async () => {
    const f = await fixture();
    const outsider = await f.t.run(ctx => ctx.db.insert("users", { authSubject: "fixture|outsider", displayName: "Outsider", messagingState: "active", createdAt: Date.now(), settings: {} }));
    const missingEvent = await f.t.run(async ctx => { const id = await ctx.db.insert("events", { title: "Deleted", kind: "event", startsAt: Date.now(), timezone: "UTC", ownerId: outsider, status: "draft", version: 1 }); await ctx.db.delete(id); return id; });
    const client = f.t.withIdentity({ subject: "fixture|outsider" });
    for (const eventId of [f.ids.event, missingEvent]) await expect(client.query(api.events.detail, { eventId })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
    await f.t.run(ctx => ctx.db.insert("memberships", { userId: outsider, eventId: f.ids.event, role: "member", state: "invited", notificationsEnabled: false }));
    expect(await client.query(api.events.myEvents, {})).toEqual([]);
    await expect(client.query(api.events.detail, { eventId: f.ids.event })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
    await expect(client.mutation(api.tasks.create, { eventId: f.ids.event, title: "bad", expectedEventVersion: 1, idempotencyKey: "bad" })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
  });
  it("bootstrap is authenticated, idempotent, labeled, and never fabricates consent or commitments", async () => {
    const f = await fixture(), alex = f.t.withIdentity({ subject: "fixture|alex" });
    await expect(f.t.mutation(internal.seed.bootstrap, {})).rejects.toThrow("UNAUTHORIZED");
    const seeded = await alex.mutation(internal.seed.bootstrap, {});
    expect(await alex.mutation(internal.seed.bootstrap, {})).toEqual(seeded);
    expect(seeded.eventIds).toHaveLength(2); expect(seeded.taskIds).toHaveLength(2); expect(seeded.invitationIds).toHaveLength(4);
    for (const id of seeded.eventIds) {
      const detail = await alex.query(api.events.detail, { eventId: id });
      expect(detail.event.title).toContain("[Simulation]"); expect(detail.event.status).toBe("draft");
      expect(detail.tasks.every(t => t.status === "unassigned" && t.activeAssigneeIds.length === 0)).toBe(true);
      expect(detail.members.filter(m => m.role === "member").every(m => m.state === "invited")).toBe(true);
    }
    expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
  it("cross-person member requests need organizer approval before contacting the target, then the target's YES", async () => {
    const f = await fixture(), p = await f.proposal(f.ids.jordan, "reassignment", f.ids.maya);
    let outbox = await f.t.run(ctx => ctx.db.query("outboundMessages").collect());
    expect(outbox.map(o => o.recipientUserId)).toEqual([f.ids.alex]);
    await expect(f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.jordan, sourceMessageId: await f.message(f.ids.jordan, "YES"), response: "accept" })).rejects.toThrow("ORGANIZER_APPROVAL_REQUIRED");
    await f.t.run(ctx => ctx.db.patch(f.ids.maya, { authSubject: "fixture|maya" }));
    await expect(f.t.withIdentity({ subject: "fixture|maya" }).mutation(api.proposals.approve, { proposalId: p })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
    const alex = f.t.withIdentity({ subject: "fixture|alex" });
    await alex.mutation(api.proposals.approve, { proposalId: p }); await alex.mutation(api.proposals.approve, { proposalId: p });
    outbox = await f.t.run(ctx => ctx.db.query("outboundMessages").collect());
    expect(outbox.filter(o => o.recipientUserId === f.ids.jordan)).toHaveLength(1);
    expect((await f.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([f.ids.maya]);
    await f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.jordan, sourceMessageId: await f.message(f.ids.jordan, "YES"), response: "accept" });
    expect((await f.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([f.ids.jordan]);
  });
  it("capacity two keeps two offers valid and supersedes the third acceptance", async () => {
    const f = await fixture(2), offers = await Promise.all([f.proposal(f.ids.maya), f.proposal(f.ids.jordan), f.proposal(f.ids.sam)]);
    for (const [i, actorId] of [f.ids.maya, f.ids.jordan, f.ids.sam].entries()) {
      expect(await f.t.mutation(internal.proposals.respond, { proposalId: offers[i]!, actorId, sourceMessageId: await f.message(actorId, "YES"), response: "accept" })).toBe(i < 2 ? "accepted" : "superseded");
    }
    expect((await f.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active")).toHaveLength(2);
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ status: "confirmed", version: 3 });
  });
  it.each(["YES", "NO"])("task change waits for every participant; second %s decides whether it applies", async response => {
    const f = await fixture(2);
    await f.t.run(async ctx => { for (const participantId of [f.ids.maya, f.ids.jordan]) await ctx.db.insert("commitments", { eventId: f.ids.event, taskId: f.ids.task, participantId, state: "active", createdAt: Date.now() }); await ctx.db.patch(f.ids.task, { status: "confirmed" }); });
    const p = await f.t.mutation(internal.proposals.create, { eventId: f.ids.event, originatorId: f.ids.alex, sourceMessageId: f.request, type: "task_change", targetTaskId: f.ids.task, targetUserId: f.ids.maya, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 60000, idempotencyKey: "change-location", taskChangeJson: JSON.stringify({ type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "location", newValue: "Indoor room" }) });
    const siblings = await f.t.run(ctx => ctx.db.query("proposals").collect()); expect(siblings).toHaveLength(2);
    await f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.maya, sourceMessageId: await f.message(f.ids.maya, "YES"), response: "accept" });
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ version: 1 });
    const q = siblings.find(q => q.targetUserId === f.ids.jordan)!;
    await f.t.mutation(internal.proposals.respond, { proposalId: q._id, actorId: f.ids.jordan, sourceMessageId: await f.message(f.ids.jordan, response), response: response === "YES" ? "accept" : "decline" });
    const task = await f.t.run(ctx => ctx.db.get(f.ids.task));
    expect(task?.version).toBe(response === "YES" ? 2 : 1); expect(task?.location).toBe(response === "YES" ? "Indoor room" : undefined);
    expect((await f.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active")).toHaveLength(2);
  });
  it("self-cancellation is idempotent; false third-person text cannot cancel the sender", async () => {
    const f = await fixture();
    const args = { eventId: f.ids.event, actorId: f.ids.maya, participantId: f.ids.maya, taskId: f.ids.task, expectedEventVersion: 1 };
    await expect(f.t.mutation(internal.commitments.reportUnavailable, { ...args, sourceMessageId: await f.message(f.ids.maya, "Jordan can't make it") })).rejects.toThrow("UNAVAILABILITY_EVIDENCE_REQUIRED");
    const sourceMessageId = await f.message(f.ids.maya, "I can't make setup");
    const changed = await f.t.mutation(internal.commitments.reportUnavailable, { ...args, sourceMessageId });
    expect(await f.t.mutation(internal.commitments.reportUnavailable, { ...args, sourceMessageId })).toEqual(changed);
    expect(await f.t.run(ctx => ctx.db.get(changed[0]!))).toMatchObject({ state: "canceled_by_participant", endedByActorId: f.ids.maya });
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ status: "needs_coverage", version: 2 });
    expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toHaveLength(1);
  });
  it("STOP/LEAVE cancel pending offers without changing accepted commitments", async () => {
    for (const reason of ["stopped", "left"] as const) {
      const f = await fixture(), p = await f.proposal(), text = reason === "stopped" ? "STOP" : "LEAVE Charity 5K", sourceMessageId = await f.message(f.ids.jordan, text);
      await f.t.mutation(internal.commands.route, { messageId: sourceMessageId });
      const args = { userId: f.ids.jordan, ...(reason === "left" ? { eventId: f.ids.event } : {}), sourceMessageId, reason };
      expect(await f.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
      // The router already canceled atomically; direct retries are no-ops.
      expect(await f.t.mutation(internal.proposals.cancelForUser, args)).toEqual([]);
      expect(await f.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
      expect((await f.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([f.ids.maya]);
    }
  });
  it("planner no-match leaves the gap; a recommendation waits for organizer approval", async () => {
    const f = await fixture(2), args = { eventId: f.ids.event, taskId: f.ids.task, actorId: f.ids.alex, sourceMessageId: f.request, expectedEventVersion: 1, expectedTaskVersion: 1 };
    await f.t.run(ctx => ctx.db.patch(f.ids.task, { requiredSkills: ["medical"], status: "needs_coverage" }));
    const none = await f.t.mutation(internal.proposals.recommendReplacement, args);
    expect(none).toEqual({ participantId: null, proposalId: null, reasonCodes: ["NO_ELIGIBLE_CANDIDATE"] });
    expect(await f.t.run(ctx => ctx.db.query("proposals").collect())).toEqual([]);
    await f.t.run(ctx => ctx.db.patch(f.ids.jordan, { settings: { skills: ["medical"] } }));
    const planned = await f.t.mutation(internal.proposals.recommendReplacement, { ...args, sourceMessageId: await f.message(f.ids.alex, "Find a replacement for setup") });
    expect(planned.participantId).toBe(f.ids.jordan);
    expect(await f.t.run(ctx => ctx.db.get(planned.proposalId!))).toMatchObject({ requiresOrganizerApproval: true, state: "pending" });
    expect((await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).filter(m => m.recipientUserId === f.ids.jordan)).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("commitments").collect())).toEqual([]);
  });
  it("acceptance rechecks a new conflict without changing Maya's assignment", async () => {
    const f = await fixture(), p = await f.proposal(), task = (await f.t.run(ctx => ctx.db.get(f.ids.task)))!;
    await f.t.run(async ctx => {
      const other = await ctx.db.insert("tasks", { eventId: f.ids.event, title: "overlapping shift", windowStart: task.windowStart!, windowEnd: task.windowEnd!, capacity: 1, status: "confirmed", version: 1 });
      await ctx.db.insert("commitments", { eventId: f.ids.event, taskId: other, participantId: f.ids.jordan, state: "active", createdAt: Date.now() });
    });
    expect(await f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.jordan, sourceMessageId: await f.message(f.ids.jordan, "YES"), response: "accept" })).toBe("canceled");
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ version: 1, status: "confirmed" });
  });
  it("task changes cannot break a dependent task's schedule", async () => {
    const f = await fixture(), task = (await f.t.run(ctx => ctx.db.get(f.ids.task)))!;
    await f.t.run(ctx => ctx.db.insert("tasks", { eventId: f.ids.event, title: "start race", windowStart: task.windowEnd!, windowEnd: task.windowEnd! + 3600000, dependsOnTaskIds: [f.ids.task], capacity: 1, status: "unassigned", version: 1 }));
    const change = { type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "time", newValue: { startsAt: new Date(task.windowStart! + 3600000).toISOString(), endsAt: new Date(task.windowEnd! + 3600000).toISOString() } };
    const p = await f.t.mutation(internal.proposals.create, { eventId: f.ids.event, originatorId: f.ids.alex, sourceMessageId: f.request, type: "task_change", targetTaskId: f.ids.task, targetUserId: f.ids.maya, taskChangeJson: JSON.stringify(change), expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 60000, idempotencyKey: "dependent-change" });
    await expect(f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.maya, sourceMessageId: await f.message(f.ids.maya, "YES"), response: "accept" })).rejects.toThrow("CHANGE_DEPENDENCY_CONFLICT");
    expect(await f.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "pending" });
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ windowStart: task.windowStart, windowEnd: task.windowEnd, version: 1 });
  });
  it("stale pending offers disappear from derived pending status without altering persisted labels", async () => {
    const f = await fixture(); const p = await f.proposal();
    let detail = await f.t.withIdentity({ subject: "fixture|alex" }).query(api.events.detail, { eventId: f.ids.event });
    expect(detail.tasks[0]?.displayLabel).toBe("awaiting_participant");
    await f.t.run(ctx => ctx.db.patch(f.ids.task, { version: 2 }));
    detail = await f.t.withIdentity({ subject: "fixture|alex" }).query(api.events.detail, { eventId: f.ids.event });
    expect(detail.proposals.find(q => q._id === p)?.state).toBe("expired");
    expect(detail.tasks[0]?.displayLabel).toBe("confirmed");
    expect((await f.t.run(ctx => ctx.db.get(f.ids.task))) as unknown as Record<string, unknown>).not.toHaveProperty("displayLabel");
  });
  it("an old YES cannot authorize a newly created offer", async () => {
    const f = await fixture(), sourceMessageId = await f.message(f.ids.jordan, "YES");
    vi.advanceTimersByTime(1000); const p = await f.proposal();
    await expect(f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.jordan, sourceMessageId, response: "accept" })).rejects.toThrow("RESPONSE_PREDATES_PROPOSAL");
    expect(await f.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "pending" });
  });
  it("one YES proof cannot be reused to accept two different offers", async () => {
    const f = await fixture(2), first = await f.proposal();
    const task = (await f.t.run(ctx => ctx.db.get(f.ids.task)))!;
    const secondTask = await f.t.run(ctx => ctx.db.insert("tasks", { eventId: f.ids.event, title: "cleanup", windowStart: task.windowEnd!, windowEnd: task.windowEnd! + 3600000, capacity: 1, status: "unassigned", version: 1 }));
    const second = await f.t.mutation(internal.proposals.create, { eventId: f.ids.event, originatorId: f.ids.alex, sourceMessageId: f.request, type: "assignment", targetTaskId: secondTask, targetUserId: f.ids.jordan, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 60000, idempotencyKey: "second-offer" });
    const sourceMessageId = await f.message(f.ids.jordan, "YES");
    await f.t.mutation(internal.proposals.respond, { proposalId: first, actorId: f.ids.jordan, sourceMessageId, response: "accept" });
    await expect(f.t.mutation(internal.proposals.respond, { proposalId: second, actorId: f.ids.jordan, sourceMessageId, response: "accept" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(await f.t.run(ctx => ctx.db.get(second))).toMatchObject({ state: "pending" });
  });
});

describe("untrusted decision execution (simulated worker)", () => {
  it("a model proposal never confirms anyone and replay executes once even after lease expiry", async () => {
    const f = await fixture(), jobId = await job(f, "Can Jordan cover setup?");
    const input = { jobId, decisionJson: JSON.stringify(decision(f.ids.event, [{ type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" }])) };
    const result = await f.t.mutation(internal.domain.executeDecision, input);
    vi.advanceTimersByTime(60001);
    expect(await f.t.mutation(internal.domain.executeDecision, input)).toEqual(result);
    expect(result.proposalIds).toHaveLength(1); expect(result.commitmentIds).toEqual([]);
    expect((await f.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.state === "active").map(c => c.participantId)).toEqual([f.ids.maya]);
    expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toHaveLength(1);
    await expect(f.t.mutation(internal.domain.executeDecision, { ...input, decisionJson: JSON.stringify(decision(f.ids.event, [{ type: "REQUEST_STATUS" }])) })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it.each(["scope", "event-version", "task-version", "unknown-task", "unknown-person", "lease", "forbidden", "unsupported", "unscoped"])("fails closed for %s without writes", async invalid => {
    const f = await fixture(), jobId = await job(f, "Can Jordan cover setup?", f.ids.alex, invalid !== "unscoped");
    const d = decision(f.ids.event, [{ type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" }]);
    if (invalid === "scope") d.eventCandidateId = "another-event";
    if (invalid === "unscoped") d.eventCandidateId = null;
    if (invalid === "event-version") await f.t.run(ctx => ctx.db.patch(f.ids.event, { version: 2 }));
    if (invalid === "task-version") await f.t.run(ctx => ctx.db.patch(f.ids.task, { version: 2 }));
    if (invalid === "lease") await f.t.run(ctx => ctx.db.patch(jobId, { leaseUntil: Date.now() - 1 }));
    if (invalid === "unknown-task") d.actions = [{ type: "PROPOSE_ASSIGNMENT", taskRef: "private-task", toParticipantRef: "Jordan" }];
    if (invalid === "unknown-person") d.actions = [{ type: "PROPOSE_ASSIGNMENT", taskRef: "setup", toParticipantRef: "private-person" }];
    if (invalid === "unsupported") d.confidenceClass = "unsupported";
    const decisionJson = invalid === "forbidden" ? JSON.stringify({ ...d, actions: [{ type: "MARK_CONFIRMED" }] }) : JSON.stringify(d);
    await expect(f.t.mutation(internal.domain.executeDecision, { jobId, decisionJson })).rejects.toThrow();
    expect(await f.t.run(ctx => ctx.db.query("proposals").collect())).toEqual([]);
    expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
  it("rolls back earlier actions if a later reference is unauthorized", async () => {
    const f = await fixture(), jobId = await job(f, "Can Jordan cover setup?");
    const d = decision(f.ids.event, [{ type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" }, { type: "ADD_INVITEE_DRAFT", contactRef: "private-contact" }]);
    await expect(f.t.mutation(internal.domain.executeDecision, { jobId, decisionJson: JSON.stringify(d) })).rejects.toThrow("UNRESOLVED_SELECTED_CONTACT");
    expect(await f.t.run(ctx => ctx.db.query("proposals").collect())).toEqual([]); expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
  it.each(["Can Jordan cover setup?", "I can maybe do setup", "I can't do setup"])("model self-commitment cannot turn '%s' into acceptance", async text => {
    const f = await fixture(2), jobId = await job(f, text, f.ids.jordan);
    await expect(f.t.mutation(internal.domain.executeDecision, { jobId, decisionJson: JSON.stringify(decision(f.ids.event, [{ type: "RECORD_SELF_COMMITMENT", taskRef: "setup" }])) })).rejects.toThrow("SELF_ACCEPTANCE_REQUIRED");
    expect(await f.t.run(ctx => ctx.db.query("commitments").collect())).toEqual([]);
  });
  it("explicit self acceptance commits only the sender once", async () => {
    const f = await fixture(2), jobId = await job(f, "I can do setup", f.ids.jordan);
    const args = { jobId, decisionJson: JSON.stringify(decision(f.ids.event, [{ type: "RECORD_SELF_COMMITMENT", taskRef: "setup" }])) };
    const r = await f.t.mutation(internal.domain.executeDecision, args);
    expect(await f.t.mutation(internal.domain.executeDecision, args)).toEqual(r);
    expect(await f.t.run(ctx => ctx.db.get(r.commitmentIds[0]!))).toMatchObject({ participantId: f.ids.jordan, state: "active" });
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ version: 2, status: "needs_coverage" });
  });
  it("unscoped draft creation grants no phone consent or existing-event access", async () => {
    const f = await fixture(), jobId = await job(f, "Create a Picnic", f.ids.jordan, false);
    const r = await f.t.mutation(internal.domain.executeDecision, { jobId, decisionJson: JSON.stringify(decision(null, [{ type: "CREATE_EVENT_DRAFT", title: "Picnic", startsAt: new Date(Date.now() + 86400000).toISOString(), timezone: "America/New_York" }])) });
    expect(r.proposalIds).toEqual([]); expect(r.commitmentIds).toEqual([]);
    const created = (await f.t.run(ctx => ctx.db.query("events").collect())).find(e => e.title === "Picnic")!;
    expect(created).toMatchObject({ status: "draft", ownerId: f.ids.jordan });
    const membership = await f.t.run(ctx => ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", created._id).eq("userId", f.ids.jordan)).unique());
    expect(membership).toMatchObject({ role: "organizer", notificationsEnabled: false }); expect(membership?.consentAt).toBeUndefined();
  });
  it("records availability only from the sender's explicit statement", async () => {
    const f = await fixture(2), window = { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString() };
    const d = decision(f.ids.event, [{ type: "RECORD_AVAILABILITY", kind: "available", window }]);
    const fabricated = await job(f, "Jordan is free", f.ids.maya);
    await expect(f.t.mutation(internal.domain.executeDecision, { jobId: fabricated, decisionJson: JSON.stringify(d) })).rejects.toThrow("SELF_AVAILABILITY_EVIDENCE_REQUIRED");
    const own = await job(f, "I am available for setup", f.ids.jordan);
    await f.t.mutation(internal.domain.executeDecision, { jobId: own, decisionJson: JSON.stringify(d) });
    expect(await f.t.run(ctx => ctx.db.query("availability").collect())).toMatchObject([{ userId: f.ids.jordan, source: "self_reported", kind: "available" }]);
  });
  it("adds only an organizer's explicitly selected contact as invited, with no cold send or invented phone verification", async () => {
    const f = await fixture();
    const selected = await f.t.run(ctx => ctx.db.insert("contactSelections", { ownerUserId: f.ids.alex, eventId: f.ids.event, displayName: "Taylor", phoneE164: "+15550000005", selectedAt: Date.now() }));
    const d = decision(f.ids.event, [{ type: "ADD_INVITEE_DRAFT", contactRef: selected }]);
    const ordinary = await job(f, "Invite Taylor", f.ids.maya);
    await expect(f.t.mutation(internal.domain.executeDecision, { jobId: ordinary, decisionJson: JSON.stringify(d) })).rejects.toThrow("UNAUTHORIZED");
    const authorized = await job(f, "Invite Taylor");
    await f.t.mutation(internal.domain.executeDecision, { jobId: authorized, decisionJson: JSON.stringify(d) });
    const invitation = (await f.t.run(ctx => ctx.db.query("invitations").collect()))[0]!;
    const target = await f.t.run(ctx => ctx.db.get(invitation.targetUserId!));
    expect(target?.verifiedPhoneE164).toBeUndefined();
    expect(await f.t.run(ctx => ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", f.ids.event).eq("userId", target!._id)).unique())).toMatchObject({ state: "invited", notificationsEnabled: false });
    expect(await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
});
