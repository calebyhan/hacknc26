import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { harness, messagingHarness } from "./harness";
import { phoneSetupErrorCopy } from "../../packages/shared/phoneSetup";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T14:00:00Z"));
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
type Harness = Awaited<ReturnType<typeof messagingHarness>>;
async function create(h: Harness, title = "Sunday picnic", confirmation = "yes, create it") {
  for (const text of ["create an event", title, "Oct 18, 2026 at 2 PM", "Eastern", "Campus lawn"]) await h.receive(h.phones.alex, text);
  expect(h.fake.sends.at(-1)!.content).toContain("yes, create it");
  expect(h.fake.sends.at(-1)!.content).toContain("updates");
  expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(0);
  const source = await h.receive(h.phones.alex, confirmation, "guided-create-confirmation");
  return { event: (await h.t.run(ctx => ctx.db.query("events").unique()))!, source };
}

describe("guided phone setup — signed simulated messages and fake delivery", () => {
  it.each(["yes, create it", "  YES,   create   it!!?  "])("reviews details and records matching app consent from the signed confirmation %s", async confirmation => {
    const h = await messagingHarness();
    const { event, source } = await create(h, "Sunday picnic", confirmation);
    expect(event).toMatchObject({ title: "Sunday picnic", status: "scheduled", timezone: "America/New_York", startsAt: Date.parse("2026-10-18T18:00:00Z") });
    const membership = await h.t.run(ctx => ctx.db.query("memberships").unique());
    expect(membership).toMatchObject({ userId: event.ownerId, notificationsEnabled: true, consentSourceMessageId: source });
    const count = h.fake.sends.length;
    await h.receive(h.phones.alex, "yes, create it", "guided-create-confirmation");
    expect(h.fake.sends).toHaveLength(count);
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(1);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)!.content).toContain("Sunday picnic");
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toHaveLength(0);
    const app = h.t.withIdentity({ subject: "fixture|guided-organizer" });
    await app.mutation(api.accounts.register, { displayName: "Alex" });
    const challenge = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: h.phones.alex, idempotencyKey: "link-guided" });
    await h.receive(h.phones.alex, `JOIN ${challenge.code}`);
    expect(await app.mutation(api.accounts.completePhoneLink, { invitationId: challenge.invitationId })).toBe(event.ownerId);
    expect((await app.query(api.appStatus.event, { eventId: event._id })).messaging).toMatchObject({ consentRecorded: true, canReceiveMessages: true });
  });
  it("persists each step, rejects ambiguous fields, keeps YES for proposals and expires abandoned setup", async () => {
    const h = await messagingHarness();
    await h.receive(h.phones.alex, "plan an event", "guided-start");
    await h.receive(h.phones.alex, "plan an event", "guided-start");
    expect(h.fake.sends).toHaveLength(1);
    expect(await h.t.run(ctx => ctx.db.query("phoneSetupSessions").collect())).toHaveLength(1);
    await h.receive(h.phones.alex, "Picnic");
    await h.receive(h.phones.alex, "10/11 at 2");
    expect(h.fake.sends.at(-1)!.content).toContain("Oct 18, 2026 at 2 PM");
    await h.receive(h.phones.alex, "Oct 18, 2026 at 2 PM");
    await h.receive(h.phones.alex, "Mars");
    expect(h.fake.sends.at(-1)!.content).toContain("timezone");
    await h.receive(h.phones.alex, "Eastern");
    await h.receive(h.phones.alex, "skip");
    await h.receive(h.phones.alex, "YES");
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1);
    await h.receive(h.phones.alex, "yes, create it");
    expect(h.fake.sends.at(-1)!.content).toContain("expired");
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(0);
  });
  it("authorizes only the exact reviewed sender reply and stores a hash-only setup receipt", async () => {
    const h = await messagingHarness();
    const source = await h.receive(h.phones.alex, "create an event");
    const receipt = (await h.t.run(ctx => ctx.db.query("phoneSetupReceipts").unique()))!;
    expect(Object.keys(receipt).sort()).toEqual(["_creationTime", "_id", "contentHash", "createdAt", "messageId", "userId"]);
    expect(receipt.messageId).toBe(source);
    expect(receipt.contentHash).toMatch(/^[a-f\d]{64}$/u);
    await expect(h.t.mutation(internal.outbox.enqueue, { recipientUserId: receipt.userId, directReplyToMessageId: source, content: "Unreviewed message containing a selected contact", idempotencyKey: "tampered-guided-content" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
    await h.receive(h.phones.maya, "HELP");
    const maya = (await h.t.run(ctx => ctx.db.query("users").withIndex("by_phone", q => q.eq("verifiedPhoneE164", h.phones.maya)).unique()))!;
    await expect(h.t.mutation(internal.outbox.enqueue, { recipientUserId: maya._id, directReplyToMessageId: source, content: h.fake.sends[0]!.content, idempotencyKey: "wrong-guided-recipient" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
    await h.receive(h.phones.alex, "STOP");
    await expect(h.t.mutation(internal.outbox.enqueue, { recipientUserId: receipt.userId, directReplyToMessageId: source, content: h.fake.sends[0]!.content, idempotencyKey: "stopped-guided-recipient" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
  });
  it("returns a permitted fixed error when a reviewed guided write is rejected without leaving partial invitation state", async () => {
    const h = await messagingHarness(); await create(h);
    for (const text of ["invite someone", "Alex", h.phones.alex]) await h.receive(h.phones.alex, text);
    const rejected = await h.receive(h.phones.alex, "yes, invite them");
    expect((await h.t.run(ctx => ctx.db.get(rejected)))!.processingState).toBe("processed");
    expect(h.fake.sends.at(-1)!.content).toBe(phoneSetupErrorCopy);
    expect(await h.t.run(ctx => ctx.db.query("invitations").collect())).toHaveLength(0);
    expect(await h.t.run(ctx => ctx.db.query("memberships").collect())).toHaveLength(1);
    expect(await h.t.run(ctx => ctx.db.query("phoneSetupReceipts").withIndex("by_message", q => q.eq("messageId", rejected)).unique())).toBeNull();
    await h.receive(h.phones.alex, "cancel setup");
    expect(await h.t.run(ctx => ctx.db.query("phoneSetupSessions").collect())).toHaveLength(0);
  });
  it("reviews only the selected invitation, normalizes a phone and enrolls only its signed matching sender by title", async () => {
    const h = await messagingHarness(); const { event } = await create(h, "Sunday picnic!");
    for (const text of ["invite someone", "Maya", "5550000002"]) await h.receive(h.phones.alex, text);
    expect(h.fake.sends.at(-1)!.content).toContain("country code");
    await h.receive(h.phones.alex, "+1 (555) 000-0002");
    expect(h.fake.sends.at(-1)!.content).not.toContain("+15550000002");
    expect(await h.t.run(ctx => ctx.db.query("invitations").collect())).toHaveLength(0);
    await h.receive(h.phones.alex, "yes, invite them");
    expect(h.fake.sends.at(-1)!.content).toContain("join Sunday picnic!");
    expect(h.fake.sends.some(send => send.toPhoneE164 === h.phones.maya)).toBe(false);
    await h.receive(h.phones.jordan, "join Sunday picnic!");
    expect(h.fake.sends.at(-1)!.content).not.toContain("Sunday picnic");
    expect((await h.t.run(ctx => ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", event._id)).collect())).filter(row => row.state === "enrolled")).toHaveLength(1);
    const joined = await h.receive(h.phones.maya, "join Sunday picnic!", "guided-join-maya");
    const members = await h.t.run(ctx => ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", event._id)).collect());
    expect(members.filter(row => row.state === "enrolled")).toHaveLength(2);
    expect(members.find(row => row.role === "member")).toMatchObject({ consentSourceMessageId: joined });
    const count = h.fake.sends.length;
    await h.receive(h.phones.maya, "join Sunday picnic!", "guided-join-maya");
    expect(h.fake.sends).toHaveLength(count);
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toHaveLength(0);
  });
  it("creates reviewed parallel tasks with capacity while preserving unassigned state", async () => {
    const h = await messagingHarness(); const { event } = await create(h);
    for (const title of ["setup", "check-in"]) {
      for (const text of ["add a task", title, "1 PM", "2 PM", "3"]) await h.receive(h.phones.alex, text);
      expect(h.fake.sends.at(-1)!.content).toContain("3 people");
      expect(h.fake.sends.at(-1)!.content).toContain("yes, add it");
      await h.receive(h.phones.alex, "yes, add it");
    }
    const tasks = await h.t.run(ctx => ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", event._id)).collect());
    expect(tasks).toHaveLength(2);
    for (const task of tasks) expect(task).toMatchObject({ capacity: 3, status: "unassigned", windowStart: Date.parse("2026-10-18T17:00:00Z"), windowEnd: Date.parse("2026-10-18T18:00:00Z") });
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toHaveLength(0);
  });
  it("rejects named JOIN evidence predating selection and mismatched contact bindings", async () => {
    const h = await harness(), newPhone = "+15550000005";
    await h.receive(newPhone, "join Integration Charity 5K", "join-before-selection", false);
    vi.setSystemTime(new Date(Date.now() + 10));
    const [invite] = await h.app.mutation(api.invitations.createForContacts, { eventId: h.ids.event, contacts: [{ displayName: "Taylor", phoneE164: newPhone }], idempotencyKey: "named-boundary" });
    await h.drain();
    expect((await h.t.run(ctx => ctx.db.get(invite!.invitationId)))!.state).toBe("pending");
    await h.t.run(ctx => ctx.db.patch(invite!.contactSelectionId, { ownerUserId: h.ids.sam }));
    await h.receive(newPhone, "join Integration Charity 5K");
    expect((await h.t.run(ctx => ctx.db.get(invite!.invitationId)))!.state).toBe("pending");
    await h.t.run(ctx => ctx.db.patch(invite!.contactSelectionId, { ownerUserId: h.ids.alex }));
    await h.receive(newPhone, "join Integration Charity 5K");
    expect((await h.t.run(ctx => ctx.db.get(invite!.invitationId)))!.state).toBe("redeemed");
  });
  it("approves a uniquely named task only for its organizer, without substituting participant acceptance", async () => {
    const h = await harness();
    const sourceMessageId = await h.receive(h.phones.sam, "Could Jordan cover setup?");
    const task = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const proposalId = await h.t.mutation(internal.proposals.create, { eventId: h.ids.event, originatorId: h.ids.sam, sourceMessageId, type: "reassignment", subjectId: h.ids.maya, targetUserId: h.ids.jordan, targetTaskId: h.ids.task, expectedEventVersion: 2, expectedTaskVersion: task.version, expiresAt: Date.now() + 600_000, idempotencyKey: "friendly-approval" });
    await h.drain();
    await h.receive(h.phones.jordan, "approve setup");
    expect((await h.t.run(ctx => ctx.db.get(proposalId)))!.organizerApprovedAt).toBeUndefined();
    await h.receive(h.phones.alex, "approve setup for Integration Charity 5K", "friendly-approved");
    expect((await h.t.run(ctx => ctx.db.get(proposalId)))!.organizerApprovedAt).toBeDefined();
    const count = h.fake.sends.length;
    await h.receive(h.phones.alex, "approve setup for Integration Charity 5K", "friendly-approved");
    expect(h.fake.sends).toHaveLength(count);
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
    expect(h.fake.sends.filter(send => send.proposalId === proposalId && send.recipientUserId === h.ids.jordan)).toHaveLength(1);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.jordan]);
  });
  it("gives an organizer approving their own offer one actionable request and still waits for their YES", async () => {
    const h = await harness();
    const sourceMessageId = await h.receive(h.phones.sam, "Could Alex cover setup?");
    const task = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const proposalId = await h.t.mutation(internal.proposals.create, { eventId: h.ids.event, originatorId: h.ids.sam, sourceMessageId, type: "reassignment", subjectId: h.ids.maya, targetUserId: h.ids.alex, targetTaskId: h.ids.task, expectedEventVersion: 2, expectedTaskVersion: task.version, expiresAt: Date.now() + 600_000, idempotencyKey: "friendly-self-approval" });
    await h.drain();
    const before = h.fake.sends.length;
    await h.receive(h.phones.alex, `approve ${proposalId.slice(-6).toUpperCase()}`);
    const ownReplies = h.fake.sends.slice(before).filter(send => send.recipientUserId === h.ids.alex);
    expect(ownReplies).toHaveLength(1);
    expect(ownReplies[0]!.content).toContain("YES");
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
    expect((await h.t.run(ctx => ctx.db.get(proposalId)))!.organizerApprovedAt).toBeDefined();
    await h.receive(h.phones.alex, "YES");
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.alex]);
  });
  it("asks for explicit disambiguation when organizer requests share a task name or short reference", async () => {
    const h = await harness();
    const sourceMessageId = await h.receive(h.phones.sam, "Could someone cover setup?");
    const task = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const proposals: Id<"proposals">[] = [];
    for (const targetUserId of [h.ids.alex, h.ids.jordan]) proposals.push(await h.t.mutation(internal.proposals.create, { eventId: h.ids.event, originatorId: h.ids.sam, sourceMessageId, type: "reassignment", subjectId: h.ids.maya, targetUserId, targetTaskId: h.ids.task, expectedEventVersion: 2, expectedTaskVersion: task.version, expiresAt: Date.now() + 600_000, idempotencyKey: `ambiguous-approval-${targetUserId}` }));
    await h.drain();
    await h.receive(h.phones.alex, "approve setup");
    expect(h.fake.sends.at(-1)!.content).toContain("Choose one current organizer request");
    for (const id of proposals) expect((await h.t.run(ctx => ctx.db.get(id)))!.organizerApprovedAt).toBeUndefined();
    await h.receive(h.phones.alex, `approve ${proposals[1]!.slice(-6).toUpperCase()}`);
    // convex-test IDs end in the table name, deliberately exercising a suffix
    // collision. A short reference must never pick the first matching offer.
    expect(proposals[0]!.slice(-6)).toBe(proposals[1]!.slice(-6));
    for (const id of proposals) expect((await h.t.run(ctx => ctx.db.get(id)))!.organizerApprovedAt).toBeUndefined();
    await h.receive(h.phones.alex, "approve setup for Jordan at Integration Charity 5K");
    expect((await h.t.run(ctx => ctx.db.get(proposals[0]!)))!.organizerApprovedAt).toBeUndefined();
    expect((await h.t.run(ctx => ctx.db.get(proposals[1]!)))!.organizerApprovedAt).toBeDefined();
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
  });
});
