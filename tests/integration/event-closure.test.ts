import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { overlappingCommitments } from "../../convex/lib/domain";
import { harness } from "./harness";

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32)); vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret"); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const close = 'close event Integration Charity 5K';
describe("reviewed event closure (signed synthetic DMs, fake delivery, no model)", () => {
  it("reviews without changing domain state, then closes only after exact confirmation and preserves history", async () => {
    const h = await harness(); const proposal = await h.offer();
    const invitation = (await h.app.mutation(api.invitations.createForContacts, { eventId: h.ids.event, contacts: [{ displayName: "Unjoined", phoneE164: "+15550000009" }], idempotencyKey: "close-pending-invite" }))[0]!;
    await h.receive(h.phones.alex, close);
    expect(h.fake.sends.at(-1)!.content).toContain('yes, close it');
    expect(h.fake.sends.at(-1)!.content).toContain('1 active assignment');
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled", version: 2 });
    expect(await h.active()).toHaveLength(1);
    const confirm = await h.receive(h.phones.alex, 'yes, close it', 'closure-confirm');
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "canceled", version: 3 });
    expect(await h.t.run(ctx => ctx.db.get(h.ids.task))).toMatchObject({ status: "canceled" });
    expect(await h.t.run(ctx => ctx.db.get(proposal))).toMatchObject({ state: "canceled" });
    expect(await h.t.run(ctx => ctx.db.get(invitation.invitationId))).toMatchObject({ state: "revoked" });
    const records = await h.t.run(ctx => ctx.db.query("commitments").withIndex("by_event", q => q.eq("eventId", h.ids.event)).collect());
    expect(records).toMatchObject([{ participantId: h.ids.maya, state: "released", endedByActorId: h.ids.alex }]);
    const before = h.fake.sends.length;
    await h.receive(h.phones.alex, 'yes, close it', 'closure-confirm'); expect(h.fake.sends).toHaveLength(before);
    await h.receive(h.phones.alex, 'yes, close it');
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ version: 3 });
    const notices = (await h.outbox()).filter(row => row.idempotencyKey.startsWith(`event-close:${confirm}:`));
    expect(new Set(notices.map(row => row.recipientUserId))).toEqual(new Set([h.ids.maya, h.ids.jordan, h.ids.sam]));
    expect(h.fake.sends.some(send => send.toPhoneE164 === "+15550000009")).toBe(false);
  });
  it("requires a consented organizer and never lets another sender confirm the review", async () => {
    const h = await harness(); await h.receive(h.phones.maya, close);
    expect(h.fake.sends.at(-1)!.content).toContain("organizer");
    await h.receive(h.phones.alex, close); await h.receive(h.phones.maya, "yes, close it");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
    await h.t.run(async ctx => { const member = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.alex)).unique())!; await ctx.db.patch(member._id, { role: "member" }); });
    await h.receive(h.phones.alex, "yes, close it");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
  });
  it("suppresses an old queued offer when closure commits before its send", async () => {
    const h = await harness();
    const proposal = await h.offer(h.ids.jordan, "reassignment", h.ids.task, false);
    const review = await h.receive(h.phones.alex, close, crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId: review });
    const confirm = await h.receive(h.phones.alex, "yes, close it", crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId: confirm });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(proposal))).toMatchObject({ state: "canceled" });
    expect(h.fake.sends.some(send => send.idempotencyKey === `proposal:${proposal}:request:${h.ids.jordan}`)).toBe(false);
    expect((await h.outbox()).find(row => row.idempotencyKey === `proposal:${proposal}:request:${h.ids.jordan}`)).toMatchObject({ state: "failed", attemptCount: 0 });
  });
  it("rejects a confirmation already queued after the request but before the review was persisted", async () => {
    const h = await harness();
    const request = await h.receive(h.phones.alex, close, crypto.randomUUID(), false);
    const speculative = await h.receive(h.phones.alex, "yes, close it", crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId: request });
    const review = (await h.t.run(ctx => ctx.db.query("phoneEventClosures").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique()))!;
    const inbound = (await h.t.run(ctx => ctx.db.get(speculative)))!;
    expect(inbound.receivedAt).toBe(review.createdAt);
    expect(inbound._creationTime).toBeLessThan(review._creationTime);
    await h.t.mutation(internal.commands.route, { messageId: speculative });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled", version: 2 });
    expect(await h.active()).toHaveLength(1);
    expect(await h.t.run(ctx => ctx.db.get(review._id))).not.toBeNull();
    expect(h.fake.sends.at(-1)!.content).toContain("before");
    await h.receive(h.phones.alex, "yes, close it");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "canceled", version: 3 });
  });
  it("accepts a newly received confirmation after the persisted review in the same millisecond", async () => {
    const h = await harness();
    const request = await h.receive(h.phones.alex, close, crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId: request });
    const review = (await h.t.run(ctx => ctx.db.query("phoneEventClosures").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique()))!;
    const confirmation = await h.receive(h.phones.alex, "yes, close it", crypto.randomUUID(), false);
    const inbound = (await h.t.run(ctx => ctx.db.get(confirmation)))!;
    expect(inbound.receivedAt).toBe(review.createdAt);
    expect(inbound._creationTime).toBeGreaterThan(review._creationTime);
    await h.t.mutation(internal.commands.route, { messageId: confirmation });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "canceled", version: 3 });
  });
  it("cancel close discards the review and bare YES or a question never closes the event", async () => {
    const h = await harness(); await h.receive(h.phones.alex, close); await h.receive(h.phones.alex, "YES");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
    await h.receive(h.phones.alex, "yes, close it?");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
    await h.receive(h.phones.alex, "cancel close"); await h.receive(h.phones.alex, "yes, close it");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
  });
  it("rechecks organizer consent and does not notify members who withdrew consent", async () => {
    const h = await harness(); await h.receive(h.phones.alex, close);
    const organizer = (await h.t.run(ctx => ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.alex)).unique()))!;
    await h.t.run(async ctx => {
      const member = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.alex)).unique())!;
      await ctx.db.patch(member._id, { consentSourceMessageId: undefined });
    });
    await h.receive(h.phones.alex, "yes, close it");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
    // Restore the original signed fixture consent to test recipient revocation independently.
    await h.t.run(ctx => ctx.db.patch(organizer._id, { consentSourceMessageId: organizer.consentSourceMessageId }));
    await h.receive(h.phones.alex, close);
    await h.t.run(async ctx => {
      const member = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.sam)).unique())!;
      await ctx.db.patch(member._id, { consentSourceMessageId: undefined });
    });
    const confirm = await h.receive(h.phones.alex, "yes, close it");
    const notices = (await h.outbox()).filter(row => row.idempotencyKey.startsWith(`event-close:${confirm}:`));
    expect(new Set(notices.map(row => row.recipientUserId))).toEqual(new Set([h.ids.maya, h.ids.jordan]));
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "canceled" });
  });
  it.each(["yes, close it", close, "cancel close"])("ignores an earlier queued %s when a newer review exists in the same millisecond", async text => {
    const h = await harness();
    const earlier = await h.receive(h.phones.alex, text, crypto.randomUUID(), false);
    const later = await h.receive(h.phones.alex, close, crypto.randomUUID(), false);
    await h.t.run(async ctx => {
      const first = (await ctx.db.get(earlier))!, second = (await ctx.db.get(later))!;
      expect(first._creationTime).toBeLessThan(second._creationTime);
      await ctx.db.patch(earlier, { receivedAt: second.receivedAt });
    });
    await h.t.mutation(internal.commands.route, { messageId: later });
    await h.t.mutation(internal.commands.route, { messageId: earlier });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
    expect(await h.t.run(ctx => ctx.db.query("phoneEventClosures").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique())).toMatchObject({ sourceMessageId: later });
  });
  it("clears the organizer's setup focus for the closed event", async () => {
    const h = await harness(); await h.receive(h.phones.alex, "add a task");
    expect(await h.t.run(ctx => ctx.db.query("phoneSetupSessions").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique())).not.toBeNull();
    await h.t.run(async ctx => {
      const focus = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique();
      if (focus) await ctx.db.patch(focus._id, { lastEventId: h.ids.event });
      else await ctx.db.insert("conversationFocus", { userId: h.ids.alex, lastEventId: h.ids.event, updatedAt: Date.now(), expiresAt: Date.now() + 600000 });
    });
    await h.receive(h.phones.alex, close); await h.receive(h.phones.alex, "yes, close it");
    expect(await h.t.run(ctx => ctx.db.query("phoneSetupSessions").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique())).toBeNull();
    expect(await h.t.run(ctx => ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique())).toBeNull();
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)!.content).toBe("You have no active events. Closed events remain available in the app.");
  });
  it("refuses ambiguous exact event names", async () => {
    const h = await harness();
    await h.t.run(async ctx => { const event = (await ctx.db.get(h.ids.event))!, member = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.alex)).unique())!; const duplicate = await ctx.db.insert("events", { title: event.title, kind: event.kind, startsAt: event.startsAt, timezone: event.timezone, ownerId: h.ids.alex, status: "scheduled", version: 1 }); await ctx.db.insert("memberships", { eventId: duplicate, userId: h.ids.alex, role: "organizer", state: "enrolled", notificationsEnabled: true, consentAt: member.consentAt!, consentSourceMessageId: member.consentSourceMessageId! }); });
    await h.receive(h.phones.alex, close); expect(h.fake.sends.at(-1)!.content).toContain("More than one");
    await h.receive(h.phones.alex, "yes, close it");
    expect((await h.t.run(ctx => ctx.db.query("events").collect())).every(event => event.status === "scheduled")).toBe(true);
  });
  it.each(["task", "commitment", "offer", "expiry"])("requires a fresh review after %s changes", async kind => {
    const h = await harness(); await h.receive(h.phones.alex, close);
    await h.t.run(async ctx => {
      if (kind === "task") { const task = (await ctx.db.get(h.ids.task))!; await ctx.db.patch(task._id, { version: task.version + 1 }); }
      else if (kind === "commitment") { const commitment = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", h.ids.task)).unique())!; await ctx.db.patch(commitment._id, { state: "released" }); }
      else if (kind === "offer") await ctx.db.insert("proposals", { eventId: h.ids.event, originatorId: h.ids.alex, targetTaskId: h.ids.task, targetUserId: h.ids.jordan, state: "pending", requiresOrganizerApproval: false, eventVersionAtCreation: 2, taskVersionAtCreation: 2, type: "assignment", expiresAt: Date.now() + 600000, idempotencyKey: "after-review" });
      else { const review = (await ctx.db.query("phoneEventClosures").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique())!; await ctx.db.patch(review._id, { expiresAt: Date.now() - 1 }); }
    });
    await h.receive(h.phones.alex, "yes, close it");
    expect(h.fake.sends.at(-1)!.content).toContain("review");
    expect(await h.t.run(ctx => ctx.db.get(h.ids.event))).toMatchObject({ status: "scheduled" });
  });
  it("releases old cross-event overlap without changing the newer event or its focus", async () => {
    const h = await harness();
    const other = await h.app.mutation(api.events.create, { title: "Newer picnic", kind: "event", startsAt: Date.now() + 86400000, timezone: "UTC", idempotencyKey: "newer" });
    const nextTask = await h.app.mutation(api.tasks.create, { eventId: other, title: "New setup", windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, expectedEventVersion: 1, idempotencyKey: "newer-task" });
    await h.app.mutation(api.events.confirmDraft, { eventId: other, expectedVersion: 1 });
    const otherInvitation = await h.app.mutation(api.events.organizerInvitation, { eventId: other, idempotencyKey: "newer-consent" });
    await h.receive(h.phones.alex, `JOIN ${otherInvitation.code}`);
    await h.t.run(async ctx => { const old = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique(); if (old) await ctx.db.patch(old._id, { lastEventId: other }); else await ctx.db.insert("conversationFocus", { userId: h.ids.alex, lastEventId: other, updatedAt: Date.now(), expiresAt: Date.now() + 600000 }); });
    expect(await h.t.run(async ctx => overlappingCommitments(ctx, (await ctx.db.get(nextTask))!, h.ids.maya))).toHaveLength(1);
    await h.receive(h.phones.alex, close); await h.receive(h.phones.alex, "yes, close it");
    expect(await h.t.run(async ctx => overlappingCommitments(ctx, (await ctx.db.get(nextTask))!, h.ids.maya))).toEqual([]);
    expect(await h.t.run(ctx => ctx.db.get(other))).toMatchObject({ status: "scheduled", version: 2 });
    expect(await h.t.run(ctx => ctx.db.get(nextTask))).toMatchObject({ status: "unassigned", version: 1 });
    expect(await h.t.run(ctx => ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique())).toMatchObject({ lastEventId: other });
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)!.content).toContain("Newer picnic");
    expect(h.fake.sends.at(-1)!.content).not.toContain("Integration Charity 5K");
  });
});
