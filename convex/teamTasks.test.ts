import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sealEnvelope } from "./lib/messaging";
import { FakeMessagingAdapter } from "../packages/shared/adapters";
import { deliverWithAdapter } from "./lib/messagingDelivery";
import { createProposal, getApprovalOptions, warnSelfVolunteerOverlap } from "./lib/proposalEngine";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T12:00:00Z")); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

/** No provider calls: all sender identities and consent below are fixtures. */
async function fixture(capacity = 2) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const users = await Promise.all(["Alex", "Maya", "Jordan", "Sam", "Taylor"].map((displayName, i) => ctx.db.insert("users", { displayName, verifiedPhoneE164: `+1555000000${i + 1}`, createdAt: Date.now(), messagingState: "active", settings: {} })));
    const [owner, maya, jordan, sam, taylor] = users as [Id<"users">, Id<"users">, Id<"users">, Id<"users">, Id<"users">];
    const event = await ctx.db.insert("events", { title: "Fixture group", kind: "event", ownerId: owner, startsAt: Date.now() + 86400000, timezone: "America/New_York", status: "scheduled", version: 1 });
    const task = await ctx.db.insert("tasks", { eventId: event, title: "setup", windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, capacity, status: "unassigned", version: 1 });
    return { owner, maya, jordan, sam, taylor, event, task };
  });
  async function message(actor: Id<"users">, text: string) {
    const user = (await t.run(ctx => ctx.db.get(actor)))!, providerMessageId = crypto.randomUUID();
    const encrypted = await sealEnvelope({ text, spaceId: `fixture:${actor}`, linePhone: "shared" }, `spectrum:${providerMessageId}:${user.verifiedPhoneE164}`);
    return t.run(ctx => ctx.db.insert("inboundMessages", { provider: "spectrum", providerMessageId, senderPhone: user.verifiedPhoneE164!, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted: encrypted, processingState: "processed" }));
  }
  for (const actor of [ids.owner, ids.maya, ids.jordan, ids.sam, ids.taylor]) {
    const consentSourceMessageId = await message(actor, "JOIN fixture");
    await t.run(ctx => ctx.db.insert("memberships", { userId: actor, eventId: ids.event, role: actor === ids.owner ? "organizer" : "member", state: "enrolled", notificationsEnabled: true, consentAt: Date.now(), consentSourceMessageId }));
  }
  async function offer(target = ids.jordan, subject?: Id<"users">, change?: string) {
    const task = (await t.run(ctx => ctx.db.get(ids.task)))!;
    return t.mutation(internal.proposals.create, { eventId: ids.event, originatorId: ids.owner, sourceMessageId: await message(ids.owner, "Could someone cover setup?"), type: change ? "task_change" : subject ? "reassignment" : "assignment", targetTaskId: ids.task, targetUserId: target, ...(subject ? { subjectId: subject } : {}), ...(change ? { taskChangeJson: change } : {}), expectedEventVersion: 1, expectedTaskVersion: task.version, expiresAt: Date.now() + 600000, idempotencyKey: crypto.randomUUID() });
  }
  async function respond(proposalId: Id<"proposals">, actor = ids.jordan, text = "YES") {
    const sourceMessageId = await message(actor, text);
    return { result: await t.mutation(internal.proposals.respond, { proposalId, actorId: actor, sourceMessageId, response: /^NO\b/iu.test(text) ? "decline" : "accept" }), sourceMessageId };
  }
  async function conflict(actor = ids.jordan, privateEvent = false, startOffset = 86400000) {
    return t.run(async ctx => {
      const eventId = privateEvent ? await ctx.db.insert("events", { title: "Secret unrelated event", kind: "event", ownerId: actor, startsAt: Date.now() + startOffset, timezone: "UTC", status: "scheduled", version: 1 }) : ids.event;
      const taskId = await ctx.db.insert("tasks", { eventId, title: privateEvent ? "Secret private responsibility" : "registration", windowStart: Date.now() + startOffset, windowEnd: Date.now() + startOffset + 3600000, capacity: 1, status: "confirmed", version: 1 });
      const commitmentId = await ctx.db.insert("commitments", { eventId, taskId, participantId: actor, state: "active", createdAt: Date.now() });
      return { taskId, commitmentId };
    });
  }
  const active = () => t.run(async ctx => (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", ids.task)).collect()).filter(c => c.state === "active"));
  return { t, ids, message, offer, respond, conflict, active };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function extraScope(f: Fixture, title: string) {
  return f.t.run(async ctx => {
    const event = await ctx.db.insert("events", { title, kind: "event", ownerId: f.ids.owner, startsAt: Date.now() + 86400000, timezone: "America/New_York", status: "scheduled", version: 1 });
    const task = await ctx.db.insert("tasks", { eventId: event, title: "setup", windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, capacity: 2, status: "unassigned", version: 1 });
    // Explicit fixture memberships, never a live or fabricated provider claim.
    for (const userId of [f.ids.owner, f.ids.jordan]) {
      const prior = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", f.ids.event).eq("userId", userId)).unique())!;
      const { _id: _unusedId, _creationTime: _unusedTime, ...membership } = prior;
      await ctx.db.insert("memberships", { ...membership, eventId: event });
    }
    return { event, task };
  });
}
async function scopedOffer(f: Fixture, scope = { event: f.ids.event, task: f.ids.task }, needsApproval = true) {
  const sourceMessageId = await f.message(f.ids.owner, "Could Jordan cover setup?");
  return f.t.run(ctx => createProposal(ctx, { eventId: scope.event, originatorId: f.ids.owner, sourceMessageId, type: "assignment", targetTaskId: scope.task, targetUserId: f.ids.jordan, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 600000, idempotencyKey: crypto.randomUUID() }, needsApproval));
}

describe("team capacity and explicit overlap consent (simulation)", () => {
  it("names the requested participant/task and keeps organizer approval separate from their own acceptance", async () => {
    const f = await fixture(), sourceMessageId = await f.message(f.ids.owner, "Could someone cover setup?");
    const p = await f.t.run(ctx => createProposal(ctx, { eventId: f.ids.event, originatorId: f.ids.owner, sourceMessageId, type: "assignment", targetTaskId: f.ids.task, targetUserId: f.ids.owner, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 600000, idempotencyKey: crypto.randomUUID() }, true));
    const rows = await f.t.run(ctx => ctx.db.query("outboundMessages").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toContain("Alex to cover setup");
    expect(rows[0]!.content).toContain("APPROVE setup");
    expect(rows[0]!.content).not.toContain(p);
    expect(rows[0]!.content).toContain("reply YES separately");
    expect(await f.active()).toHaveLength(0);
  });

  it.each(["Second group", "Fixture group"])("uses readable approval scope before codes, retaining exact references for duplicate event names (%s)", async title => {
    const f = await fixture(), first = await scopedOffer(f), scope = await extraScope(f, title), second = await scopedOffer(f, scope);
    const options = await f.t.run(ctx => getApprovalOptions(ctx, f.ids.owner));
    expect(options).toHaveLength(2);
    expect(options.find(option => option.proposal._id === second)!.reference).toBe(title === "Second group" ? "setup for Second group" : second);
    const notice = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).find(row => row.proposalId === second)!;
    expect(notice.content).toContain(`APPROVE ${title === "Second group" ? "setup for Second group" : second}`);
    expect((await f.t.run(ctx => ctx.db.get(first)))!.state).toBe("pending");
    expect(await f.active()).toHaveLength(0);
  });

  it.each(["expiry", "event version", "task version", "organizer consent"])("does not let an invalid approval scope force an opaque reference (%s)", async stale => {
    const f = await fixture(), first = await scopedOffer(f), scope = await extraScope(f, "Fixture group");
    await f.t.run(async ctx => {
      if (stale === "expiry") await ctx.db.patch(first, { expiresAt: Date.now() });
      if (stale === "event version") await ctx.db.patch(f.ids.event, { version: 2 });
      if (stale === "task version") await ctx.db.patch(f.ids.task, { version: 2 });
      if (stale === "organizer consent") {
        const membership = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", f.ids.event).eq("userId", f.ids.owner)).unique())!;
        await ctx.db.patch(membership._id, { consentAt: undefined, consentSourceMessageId: undefined });
      }
    });
    const second = await scopedOffer(f, scope);
    const options = await f.t.run(ctx => getApprovalOptions(ctx, f.ids.owner));
    expect(options.map(option => option.proposal._id)).toEqual([second]);
    expect(options[0]!.reference).toBe("setup");
  });

  it.each(["Second group", "Fixture group"])("uses a human overlap scope unless task and event names both collide (%s)", async title => {
    const f = await fixture(); await f.conflict(); const first = await scopedOffer(f, undefined, false);
    const scope = await extraScope(f, title); await scopedOffer(f, scope, false);
    await expect(f.respond(first, f.ids.jordan, "YES setup")).rejects.toThrow("INVALID_RESPONSE_REFERENCE");
    await f.respond(first, f.ids.jordan, `YES ${first}`);
    const notice = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).find(row => row.proposalId === first && row.content.includes("CONFIRM OVERLAP"))!;
    const reference = title === "Second group" ? "setup for Fixture group" : first;
    expect(notice.content).toContain(`CONFIRM OVERLAP ${reference}`);
    expect((await f.respond(first, f.ids.jordan, `CONFIRM OVERLAP ${reference}`)).result).toBe("accepted");
  });

  it("fills two slots independently, preserves compatible pending offers and prevents a third or duplicate assignment", async () => {
    const f = await fixture(), a = await f.offer(), b = await f.offer(f.ids.sam), c = await f.offer(f.ids.taylor), duplicate = await f.offer();
    await f.respond(a);
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ status: "needs_coverage", version: 2 });
    expect(await f.t.run(ctx => ctx.db.get(b))).toMatchObject({ state: "pending", taskVersionAtCreation: 2 });
    expect(await f.t.run(ctx => ctx.db.get(duplicate))).toMatchObject({ state: "superseded" });
    const queued = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).find(row => row.proposalId === b)!;
    const fake = new FakeMessagingAdapter(); await f.t.action(ctx => deliverWithAdapter(ctx, queued._id, () => fake));
    expect(fake.sends).toHaveLength(1);
    await f.respond(b, f.ids.sam); await f.respond(c, f.ids.taylor); await f.respond(a);
    expect((await f.active()).map(c => c.participantId).sort()).toEqual([f.ids.jordan, f.ids.sam].sort());
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ status: "confirmed", version: 3 });
    expect(await f.t.run(ctx => ctx.db.get(c))).toMatchObject({ state: "superseded" });
    const closed = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).filter(row => row.proposalId === c && row.idempotencyKey.includes(":closed:"));
    expect(closed).toHaveLength(2);
    for (const row of closed) {
      expect(row.content).toContain("Jordan"); expect(row.content).toContain("Sam");
      expect(row.content).toContain("fully staffed"); expect(row.content).toContain("offer is closed");
      expect(row.content).not.toMatch(/ask for a new offer|no new assignment was made/iu);
    }
  });

  it("keeps independent replacements for separate members of a team valid", async () => {
    const f = await fixture(); await f.respond(await f.offer(f.ids.maya), f.ids.maya); await f.respond(await f.offer());
    const a = await f.offer(f.ids.sam, f.ids.maya), b = await f.offer(f.ids.taylor, f.ids.jordan);
    await f.respond(a, f.ids.sam);
    expect(await f.t.run(ctx => ctx.db.get(b))).toMatchObject({ state: "pending", taskVersionAtCreation: 4 });
    await f.respond(b, f.ids.taylor);
    expect((await f.active()).map(c => c.participantId).sort()).toEqual([f.ids.sam, f.ids.taylor].sort());
  });

  it("warns on YES, never treats another YES as overlap approval, then accepts one signed explicit confirmation", async () => {
    const f = await fixture(), conflict = await f.conflict(), p = await f.offer();
    expect((await f.respond(p)).result).toBe("pending");
    expect(await f.active()).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ version: 1, status: "unassigned" });
    expect((await f.respond(p)).result).toBe("pending");
    const warning = await f.t.run(ctx => ctx.db.get(p));
    expect(warning?.overlapWarningJson).toBeDefined();
    const { result, sourceMessageId } = await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`);
    expect(result).toBe("accepted");
    expect(await f.active()).toHaveLength(1);
    expect(await f.t.run(ctx => ctx.db.get(conflict.commitmentId))).toMatchObject({ state: "active" });
    expect(await f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.jordan, sourceMessageId, response: "accept" })).toBe("accepted");
    expect(await f.active()).toHaveLength(1);
  });

  it("requires a prior warning and the actual target's confirmation", async () => {
    const f = await fixture(); await f.conflict(); const p = await f.offer();
    await expect(f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).rejects.toThrow("OVERLAP_WARNING_REQUIRED");
    await f.respond(p);
    await expect(f.respond(p, f.ids.sam, `CONFIRM OVERLAP ${p}`)).rejects.toThrow("UNAUTHORIZED");
    expect(await f.active()).toHaveLength(0);
  });

  it("warns an explicit self-volunteer without assigning them or dispatching an obsolete ordinary offer", async () => {
    const f = await fixture(); await f.conflict();
    const sourceMessageId = await f.message(f.ids.jordan, "I can help with setup");
    const p = await f.t.mutation(internal.proposals.create, { eventId: f.ids.event, originatorId: f.ids.jordan, sourceMessageId, type: "assignment", targetTaskId: f.ids.task, targetUserId: f.ids.jordan, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 600000, idempotencyKey: crypto.randomUUID() });
    await f.t.run(ctx => warnSelfVolunteerOverlap(ctx, p, sourceMessageId));
    expect(await f.active()).toHaveLength(0);
    const rows = await f.t.run(ctx => ctx.db.query("outboundMessages").collect());
    const fake = new FakeMessagingAdapter();
    for (const row of rows) await f.t.action(ctx => deliverWithAdapter(ctx, row._id, () => fake));
    expect(fake.sends).toHaveLength(1); expect(fake.sends[0]!.content).toContain("CONFIRM OVERLAP");
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("accepted");
    expect(await f.active()).toHaveLength(1);
  });

  it.each(["Maybe I can help with setup", "I can ask Sam to help with setup", "I can cover setupdesk"])("does not infer self-volunteering from '%s'", async text => {
    const f = await fixture(); await f.conflict(); const sourceMessageId = await f.message(f.ids.jordan, text);
    const p = await f.t.mutation(internal.proposals.create, { eventId: f.ids.event, originatorId: f.ids.jordan, sourceMessageId, type: "assignment", targetTaskId: f.ids.task, targetUserId: f.ids.jordan, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt: Date.now() + 600000, idempotencyKey: crypto.randomUUID() });
    await expect(f.t.run(ctx => warnSelfVolunteerOverlap(ctx, p, sourceMessageId))).rejects.toThrow("SELF_ACCEPTANCE_REQUIRED");
    expect(await f.active()).toHaveLength(0);
  });

  it("keeps a queued overlap warning valid when another teammate fills an independent slot", async () => {
    const f = await fixture(); await f.conflict(); const p = await f.offer(), q = await f.offer(f.ids.sam); await f.respond(p);
    const warning = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).find(row => row.content.includes("CONFIRM OVERLAP"))!;
    await f.respond(q, f.ids.sam);
    const fake = new FakeMessagingAdapter(); await f.t.action(ctx => deliverWithAdapter(ctx, warning._id, () => fake));
    expect(fake.sends).toHaveLength(1);
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("accepted");
    expect(await f.active()).toHaveLength(2);
  });

  it("rejects a delayed confirmation that was already received before the warning", async () => {
    const f = await fixture(); await f.conflict(); const p = await f.offer();
    const sourceMessageId = await f.message(f.ids.jordan, `CONFIRM OVERLAP ${p}`);
    vi.setSystemTime(Date.now() + 1000); await f.respond(p);
    await expect(f.t.mutation(internal.proposals.respond, { proposalId: p, actorId: f.ids.jordan, sourceMessageId, response: "accept" })).rejects.toThrow("OVERLAP_WARNING_REQUIRED");
    expect(await f.active()).toHaveLength(0);
  });

  it("independently binds targeted YES/NO to one current offer and permits its unique short reference", async () => {
    const f = await fixture(), p = await f.offer(), q = await f.offer();
    await expect(f.respond(p, f.ids.jordan, "YES setup")).rejects.toThrow("INVALID_RESPONSE_REFERENCE");
    await expect(f.respond(p, f.ids.jordan, `YES ${q}`)).rejects.toThrow("INVALID_RESPONSE_REFERENCE");
    await expect(f.respond(p, f.ids.jordan, "NO registration")).rejects.toThrow("INVALID_RESPONSE_REFERENCE");
    expect(await f.active()).toHaveLength(0);
    // convex-test IDs share a table suffix, so these short references collide.
    await expect(f.respond(p, f.ids.jordan, `YES ${p.slice(-6)}`)).rejects.toThrow("INVALID_RESPONSE_REFERENCE");
    expect((await f.respond(p, f.ids.jordan, `YES ${p}`)).result).toBe("accepted");
  });

  it("accepts explicit overlap confirmation by an unambiguous task title or short reference", async () => {
    const f = await fixture(); await f.conflict(); const p = await f.offer();
    await f.respond(p, f.ids.jordan, "YES setup");
    const warning = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).find(row => row.content.includes("CONFIRM OVERLAP"))!;
    expect(warning.content).toContain("CONFIRM OVERLAP setup");
    expect(warning.content).not.toContain(p);
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p.slice(-6)}`)).result).toBe("accepted");
  });

  it("does not let an unconsented event's offer make a permitted task reply ambiguous", async () => {
    const f = await fixture(), p = await f.offer();
    await f.t.run(async ctx => {
      const eventId = await ctx.db.insert("events", { title: "Unconsented fixture", kind: "event", ownerId: f.ids.owner, startsAt: Date.now() + 86400000, timezone: "UTC", status: "scheduled", version: 1 });
      const taskId = await ctx.db.insert("tasks", { eventId, title: "setup", windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, capacity: 1, status: "unassigned", version: 1 });
      await ctx.db.insert("memberships", { userId: f.ids.jordan, eventId, role: "member", state: "enrolled", notificationsEnabled: false });
      await ctx.db.insert("proposals", { eventId, type: "assignment", originatorId: f.ids.owner, targetTaskId: taskId, targetUserId: f.ids.jordan, state: "pending", requiresOrganizerApproval: false, eventVersionAtCreation: 1, taskVersionAtCreation: 1, expiresAt: Date.now() + 600000, idempotencyKey: "unconsented-fixture" });
    });
    expect((await f.respond(p, f.ids.jordan, "YES setup")).result).toBe("accepted");
    expect(await f.active()).toHaveLength(1);
  });

  it.each(["new conflict", "conflict changed", "conflict canceled"])("requires renewed consent after the warning snapshot changes (%s)", async change => {
    const f = await fixture(), conflict = await f.conflict(), p = await f.offer(); await f.respond(p);
    if (change === "new conflict") await f.conflict();
    if (change === "conflict changed") await f.t.run(ctx => ctx.db.patch(conflict.taskId, { version: 2, windowStart: Date.now() + 87000000 }));
    if (change === "conflict canceled") await f.t.run(ctx => ctx.db.patch(conflict.commitmentId, { state: "canceled_by_participant" }));
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("pending");
    expect(await f.active()).toHaveLength(0);
    expect((await f.respond(p, f.ids.jordan, change === "conflict canceled" ? "YES" : `CONFIRM OVERLAP ${p}`)).result).toBe("accepted");
  });

  it("warns about all private cross-event conflicts without exposing their event or task names", async () => {
    const f = await fixture(); await f.conflict(f.ids.jordan, true); const p = await f.offer(); await f.respond(p);
    const rows = await f.t.run(ctx => ctx.db.query("outboundMessages").collect());
    const warning = rows.find(row => row.content.includes("CONFIRM OVERLAP"))!;
    expect(warning.recipientUserId).toBe(f.ids.jordan);
    expect(warning.content).toContain("another event commitment"); expect(warning.content).not.toContain("Secret");
    expect(warning.content).toContain("Oct 12"); expect(warning.content).toContain("8:00 AM"); expect(warning.content).toContain("9:00 AM");
    expect(warning.content).not.toContain("+1555");
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("accepted");
  });

  it.each(["event", "task", "expiry"])("never accepts a stale overlap confirmation (%s)", async stale => {
    const f = await fixture(); await f.conflict(); const p = await f.offer(); await f.respond(p);
    await f.t.run(async ctx => { if (stale === "expiry") await ctx.db.patch(p, { expiresAt: Date.now() }); else await ctx.db.patch(stale === "event" ? f.ids.event : f.ids.task, { version: 2 }); });
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("expired");
    expect(await f.active()).toHaveLength(0);
  });

  it("does not let overlap approval exceed a slot another participant accepted", async () => {
    const f = await fixture(1); await f.conflict(); const p = await f.offer(), q = await f.offer(f.ids.sam); await f.respond(p); await f.respond(q, f.ids.sam);
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("superseded");
    expect((await f.active()).map(c => c.participantId)).toEqual([f.ids.sam]);
  });

  it.each(["stopped", "skills", "unavailable"])("keeps %s as a hard gate after an overlap warning", async gate => {
    const f = await fixture(); await f.conflict(); const p = await f.offer(); await f.respond(p);
    await f.t.run(async ctx => {
      if (gate === "stopped") await ctx.db.patch(f.ids.jordan, { messagingState: "stopped" });
      if (gate === "skills") await ctx.db.patch(f.ids.task, { requiredSkills: ["licensed driver"] });
      if (gate === "unavailable") await ctx.db.insert("availability", { eventId: f.ids.event, userId: f.ids.jordan, windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, kind: "unavailable", source: "self_reported", reportedByUserId: f.ids.jordan, recordedAt: Date.now() });
    });
    expect((await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`)).result).toBe("canceled");
    expect(await f.active()).toHaveLength(0);
  });

  it("requires each affected teammate to confirm overlaps before applying a task time change", async () => {
    const f = await fixture(); await f.respond(await f.offer()); await f.respond(await f.offer(f.ids.sam), f.ids.sam);
    await f.conflict(f.ids.jordan, false, 90000000);
    const change = JSON.stringify({ type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "time", newValue: { startsAt: new Date(Date.now() + 90000000).toISOString(), endsAt: new Date(Date.now() + 93600000).toISOString() } });
    const p = await f.offer(f.ids.jordan, undefined, change);
    const sibling = (await f.t.run(ctx => ctx.db.query("proposals").collect())).find(row => row.type === "task_change" && row.targetUserId === f.ids.sam)!;
    expect((await f.respond(p)).result).toBe("pending"); await f.respond(sibling._id, f.ids.sam);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.task)))!.windowStart).toBe(Date.now() + 86400000);
    await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.task)))!.windowStart).toBe(Date.now() + 90000000);
  });

  it("reopens an earlier task-change approval if that person's conflicts change before the final approval", async () => {
    const f = await fixture(); await f.respond(await f.offer()); await f.respond(await f.offer(f.ids.sam), f.ids.sam);
    const change = JSON.stringify({ type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "time", newValue: { startsAt: new Date(Date.now() + 90000000).toISOString(), endsAt: new Date(Date.now() + 93600000).toISOString() } });
    const p = await f.offer(f.ids.jordan, undefined, change);
    const sibling = (await f.t.run(ctx => ctx.db.query("proposals").collect())).find(row => row.type === "task_change" && row.targetUserId === f.ids.sam)!;
    await f.respond(p); await f.conflict(f.ids.jordan, false, 90000000); await f.respond(sibling._id, f.ids.sam);
    expect(await f.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "pending" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.task)))!.windowStart).toBe(Date.now() + 86400000);
    await f.conflict(f.ids.sam, false, 90000000);
    await f.respond(p, f.ids.jordan, `CONFIRM OVERLAP ${p}`);
    expect(await f.t.run(ctx => ctx.db.get(sibling._id))).toMatchObject({ state: "pending" });
    expect((await f.t.run(ctx => ctx.db.get(f.ids.task)))!.windowStart).toBe(Date.now() + 86400000);
    await f.respond(sibling._id, f.ids.sam, `CONFIRM OVERLAP ${sibling._id}`);
    expect((await f.t.run(ctx => ctx.db.get(f.ids.task)))!.windowStart).toBe(Date.now() + 90000000);
  });

  it.each(["closed", "superseded warning", "conflict changed"])("does not dispatch an outdated overlap warning (%s)", async stale => {
    const f = await fixture(); const conflict = await f.conflict(), p = await f.offer(); await f.respond(p);
    const warning = (await f.t.run(ctx => ctx.db.query("outboundMessages").collect())).find(row => row.content.includes("CONFIRM OVERLAP"))!;
    if (stale === "closed") await f.respond(p, f.ids.jordan, "NO");
    if (stale === "superseded warning") await f.respond(p);
    if (stale === "conflict changed") await f.t.run(ctx => ctx.db.patch(conflict.taskId, { version: 2 }));
    const fake = new FakeMessagingAdapter(); await f.t.action(ctx => deliverWithAdapter(ctx, warning._id, () => fake));
    expect(fake.sends).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.get(warning._id))).toMatchObject({ state: "failed", attemptCount: 0 });
  });

  it("cancels one teammate without releasing the rest or inventing replacement coverage", async () => {
    const f = await fixture(); await f.respond(await f.offer()); await f.respond(await f.offer(f.ids.sam), f.ids.sam);
    await f.t.mutation(internal.commitments.reportUnavailable, { eventId: f.ids.event, actorId: f.ids.jordan, participantId: f.ids.jordan, taskId: f.ids.task, sourceMessageId: await f.message(f.ids.jordan, "I can't do setup anymore"), expectedEventVersion: 1 });
    expect((await f.active()).map(c => c.participantId)).toEqual([f.ids.sam]);
    expect(await f.t.run(ctx => ctx.db.get(f.ids.task))).toMatchObject({ status: "needs_coverage", version: 4 });
  });
});
