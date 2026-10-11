import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sealEnvelope } from "./lib/messaging";
import { deliverWithAdapter } from "./lib/messagingDelivery";
import { FakeMessagingAdapter } from "../packages/shared/adapters";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T23:55:00Z"));
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

/** Explicit simulation: encrypted fixture evidence and a fake provider only. */
async function fixture(timezone = "America/New_York", type: "assignment" | "task_change" = "assignment") {
  const t = convexTest(schema, modules), fake = new FakeMessagingAdapter();
  const ids = await t.run(async ctx => {
    const owner = await ctx.db.insert("users", { displayName: "Organizer", verifiedPhoneE164: "+15550000001", createdAt: Date.now(), messagingState: "active", settings: {} });
    const target = await ctx.db.insert("users", { displayName: "Participant", verifiedPhoneE164: "+15550000002", createdAt: Date.now(), messagingState: "active", settings: {} });
    const event = await ctx.db.insert("events", { title: "Fixture event", kind: "event", ownerId: owner, status: "scheduled", version: 1, startsAt: Date.now() + 86400000, timezone });
    const task = await ctx.db.insert("tasks", { eventId: event, title: "setup", capacity: 1, status: type === "task_change" ? "confirmed" : "unassigned", version: 1, windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000 });
    if (type === "task_change") await ctx.db.insert("commitments", { eventId: event, taskId: task, participantId: target, state: "active", createdAt: Date.now() });
    return { owner, target, event, task };
  });
  async function message(userId: Id<"users">, text: string) {
    const user = (await t.run(ctx => ctx.db.get(userId)))!, providerMessageId = crypto.randomUUID();
    const encrypted = await sealEnvelope({ text, spaceId: `fixture:${userId}`, linePhone: "shared" }, `spectrum:${providerMessageId}:${user.verifiedPhoneE164}`);
    return t.run(ctx => ctx.db.insert("inboundMessages", { provider: "spectrum", providerMessageId, senderPhone: user.verifiedPhoneE164!, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted: encrypted, processingState: "processed" }));
  }
  for (const userId of [ids.owner, ids.target]) {
    const consentSourceMessageId = await message(userId, "JOIN fixture");
    await t.run(ctx => ctx.db.insert("memberships", { eventId: ids.event, userId, role: userId === ids.owner ? "organizer" : "member", state: "enrolled", notificationsEnabled: true, consentAt: Date.now(), consentSourceMessageId }));
  }
  const expiresAt = Date.now() + 600000;
  const proposal = await t.mutation(internal.proposals.create, {
    eventId: ids.event, originatorId: ids.owner, sourceMessageId: await message(ids.owner, "Could the participant cover setup?"),
    type, targetTaskId: ids.task, targetUserId: ids.target, expectedEventVersion: 1, expectedTaskVersion: 1, expiresAt, idempotencyKey: "fixture-offer",
    ...(type === "task_change" ? { taskChangeJson: JSON.stringify({ type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "location", newValue: "Fixture room" }) } : {}),
  });
  const request = (await t.run(ctx => ctx.db.query("outboundMessages").collect()))[0]!;
  async function deliver(outboundMessageId = request._id) {
    await t.action(ctx => deliverWithAdapter(ctx, outboundMessageId, () => fake));
  }
  return { t, fake, ids, proposal, request, expiresAt, message, deliver };
}

describe("queued proposal delivery (simulation)", () => {
  it.each(["accepted", "declined", "expired", "superseded", "canceled"] as const)("never dispatches a queued request after its proposal is %s", async state => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.proposal, { state }));
    await f.deliver(); await f.deliver();
    expect(f.fake.sends).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.get(f.request._id))).toMatchObject({ state: "failed", attemptCount: 0 });
  });

  it.each(["deadline", "event version", "task version", "event closed", "task closed", "approval missing", "proposal missing", "task missing", "target changed"])("holds a queued request when %s invalidates it", async invalid => {
    const f = await fixture();
    await f.t.run(async ctx => {
      if (invalid === "deadline") await ctx.db.patch(f.proposal, { expiresAt: Date.now() });
      if (invalid === "event version") await ctx.db.patch(f.ids.event, { version: 2 });
      if (invalid === "task version") await ctx.db.patch(f.ids.task, { version: 2 });
      if (invalid === "event closed") await ctx.db.patch(f.ids.event, { status: "canceled" });
      if (invalid === "task closed") await ctx.db.patch(f.ids.task, { status: "completed" });
      if (invalid === "approval missing") await ctx.db.patch(f.proposal, { requiresOrganizerApproval: true });
      if (invalid === "proposal missing") await ctx.db.delete(f.proposal);
      if (invalid === "task missing") await ctx.db.delete(f.ids.task);
      if (invalid === "target changed") await ctx.db.patch(f.proposal, { targetUserId: f.ids.owner });
    });
    await f.deliver();
    expect(f.fake.sends).toHaveLength(0);
    expect(await f.t.run(ctx => ctx.db.get(f.request._id))).toMatchObject({ state: "failed", attemptCount: 0 });
  });

  it("dispatches a current request once after required organizer approval", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.proposal, { requiresOrganizerApproval: true, organizerApprovedAt: Date.now() }));
    await f.deliver(); await f.deliver();
    expect(f.fake.sends).toHaveLength(1);
    expect(await f.t.run(ctx => ctx.db.get(f.request._id))).toMatchObject({ state: "sent", attemptCount: 1 });
  });

  it.each(["pending", "approved", "expired"] as const)("dispatches an organizer approval request only while approval is still needed (%s)", async state => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.proposal, { requiresOrganizerApproval: true, ...(state === "approved" ? { organizerApprovedAt: Date.now() } : {}), ...(state === "expired" ? { expiresAt: Date.now() } : {}) }));
    const approval = await f.t.mutation(internal.outbox.enqueue, { recipientUserId: f.ids.owner, eventId: f.ids.event, proposalId: f.proposal, idempotencyKey: `proposal:${f.proposal}:approval:${f.ids.owner}`, content: "Fixture organizer approval request" });
    await f.deliver(approval);
    expect(f.fake.sends).toHaveLength(state === "pending" ? 1 : 0);
  });

  it.each(["accept", "decline", "expire"] as const)("still delivers terminal %s notices while suppressing the old queued request", async action => {
    const f = await fixture();
    if (action === "expire") {
      await f.t.run(ctx => ctx.db.patch(f.proposal, { expiresAt: Date.now() }));
      await f.t.mutation(internal.proposals.expire, { proposalId: f.proposal });
    } else {
      await f.t.mutation(internal.proposals.respond, { proposalId: f.proposal, actorId: f.ids.target, sourceMessageId: await f.message(f.ids.target, action === "accept" ? "YES" : "NO"), response: action });
    }
    const rows = await f.t.run(ctx => ctx.db.query("outboundMessages").collect());
    expect(rows).toHaveLength(3);
    for (const row of rows) await f.deliver(row._id);
    expect(f.fake.sends).toHaveLength(2);
    expect(f.fake.sends.every(send => send.idempotencyKey !== f.request.idempotencyKey)).toBe(true);
    expect(await f.t.run(ctx => ctx.db.get(f.request._id))).toMatchObject({ state: "failed", attemptCount: 0 });
    for (const row of rows.filter(row => row._id !== f.request._id)) expect(await f.t.run(ctx => ctx.db.get(row._id))).toMatchObject({ state: "sent", attemptCount: 1 });
  });

  it.each(["assignment", "task_change"] as const)("shows the absolute %s reply deadline in the event timezone", async type => {
    const f = await fixture("America/New_York", type);
    expect(f.request.content).toContain("Reply YES or NO by Oct 10, 8:05 PM (America/New_York)");
    expect(f.request.content).not.toContain("Oct 11, 12:05 AM");
  });
});
