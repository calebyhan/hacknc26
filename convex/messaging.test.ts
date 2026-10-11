import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import spectrumTest from "@spectrum-ts/convex/test";
import { openEnvelope, sealEnvelope } from "./lib/messaging";
import { deliverWithAdapter } from "./lib/messagingDelivery";
import { FakeMessagingAdapter } from "../packages/shared/adapters";
import { onboardingCopy } from "../packages/shared/copy";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { statusSummary } from "./lib/validators";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "fixture-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

function setup(overrides: Record<string, () => Promise<Record<string, unknown>>> = {}) {
  const t = convexTest(schema, { ...modules, ...overrides });
  spectrumTest.register(t);
  return t;
}
async function inbound(t: ReturnType<typeof setup>, text: string, phone = "+15550000001", providerMessageId = crypto.randomUUID()) {
  const bodyRedactedOrEncrypted = await sealEnvelope({ text, spaceId: `iMessage;-;${phone}` }, `spectrum:${providerMessageId}:${phone}`);
  const result = await t.mutation(internal.inbound.ingest, { provider: "spectrum", providerMessageId, senderPhone: phone, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted });
  return result.messageId;
}
async function organizer(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { displayName: "Organizer", authSubject: "fixture-organizer", verifiedPhoneE164: "+15550000002", createdAt: Date.now(), messagingState: "active", settings: {} });
    const eventId = await ctx.db.insert("events", { title: "Fixture Charity 5K", kind: "event", startsAt: Date.now() + 86_400_000, timezone: "America/New_York", ownerId: userId, status: "scheduled", version: 1 });
    await ctx.db.insert("memberships", { userId, eventId, role: "organizer", state: "enrolled", notificationsEnabled: true });
    return { userId, eventId };
  });
}
async function invite(t: ReturnType<typeof setup>, eventId: Id<"events">, phone = "+15550000001", key = "fixture-invite") {
  const result = await t.withIdentity({ subject: "fixture-organizer" }).mutation(api.invitations.createForContacts, { eventId, contacts: [{ displayName: "Taylor", phoneE164: phone }], idempotencyKey: key });
  return result[0]!;
}
async function enroll(t: ReturnType<typeof setup>) {
  const owner = await organizer(t);
  const invitation = await invite(t, owner.eventId);
  const messageId = await inbound(t, `JOIN ${invitation.code}`);
  const redeemed = await t.mutation(internal.invitations.redeem, { messageId, code: invitation.code });
  if (!redeemed.redeemed) throw new Error("Fixture enrollment failed");
  return { ...owner, memberId: redeemed.userId, messageId };
}

describe("Lane A inbox and consent (simulation)", () => {
  it("ST-07: stores a duplicate provider ID once and schedules routing once", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const args = { provider: "fake", providerMessageId: "fake-1", senderPhone: "+15550000001", receivedAt: Date.now(), contentType: "text/plain" };
    const first = await t.mutation(internal.inbound.ingest, args);
    const replay = await t.mutation(internal.inbound.ingest, args);
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ messageId: first.messageId, duplicate: true });
    expect(await t.run((ctx) => ctx.db.query("inboundMessages").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);
  });
  it("ST-02: refuses an invited recipient before creating an outbox row", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { displayName: "Taylor", verifiedPhoneE164: "+15550000001", createdAt: Date.now(), messagingState: "active", settings: {} });
      const eventId = await ctx.db.insert("events", { title: "Fixture", kind: "event", startsAt: Date.now(), timezone: "America/New_York", ownerId: userId, status: "scheduled", version: 1 });
      await ctx.db.insert("memberships", { userId, eventId, role: "member", state: "invited", notificationsEnabled: false });
      return { userId, eventId };
    });
    await expect(t.mutation(internal.outbox.enqueue, { recipientUserId: ids.userId, eventId: ids.eventId, content: "Fixture", idempotencyKey: "test" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
    expect(await t.run((ctx) => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
});

describe("Lane A native webhook (signed synthetic fixtures)", () => {
  it("checks action encryption and mutation decryption/hashing without writes or sends", async () => {
    const t = setup();
    expect(await t.action(internal.spectrum.checkRuntime, {})).toMatchObject({ cryptoReady: true });
    expect(await t.run((ctx) => ctx.db.query("inboundMessages").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("outboundMessages").collect())).toEqual([]);
  });
  async function signedRequest(t: ReturnType<typeof setup>, payload: unknown, valid = true) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-webhook-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${body}`)));
    const signature = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
    return t.fetch("/spectrum/webhook", { method: "POST", body, headers: { "x-spectrum-timestamp": timestamp, "x-spectrum-signature": `v0=${valid ? signature : "00".repeat(32)}` } });
  }
  const payload = { event: "message", message: { id: "fixture-webhook-1", platform: "imessage", direction: "inbound", sender: { id: "+15550000001" }, space: { id: "iMessage;-;+15550000001", type: "dm" }, content: { type: "text", text: "HELP" } } };
  it("rejects a forged signature with no durable side effects", async () => {
    const t = setup();
    expect((await signedRequest(t, payload, false)).status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("inboundMessages").collect())).toEqual([]);
  });
  it("persists encrypted inbound before 200 and ignores duplicate delivery", async () => {
    const t = setup();
    expect((await signedRequest(t, payload)).status).toBe(200);
    expect((await signedRequest(t, payload)).status).toBe(200);
    const messages = await t.run((ctx) => ctx.db.query("inboundMessages").collect());
    expect(messages).toHaveLength(1);
    expect(messages[0]!.bodyRedactedOrEncrypted).not.toContain("HELP");
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);
  });
  it("accepts Photon's documented iMessage platform spelling and shared-line routing", async () => {
    const t = setup();
    const space = { id: "any;-;+15550000001", platform: "iMessage", type: "dm", phone: "shared" };
    const native = { event: "messages", space, message: { ...payload.message, platform: "iMessage", sender: { ...payload.message.sender, platform: "iMessage" }, space } };
    expect((await signedRequest(t, native)).status).toBe(200);
    const messages = await t.run((ctx) => ctx.db.query("inboundMessages").collect());
    expect(messages).toHaveLength(1);
    expect(await openEnvelope(messages[0]!)).toEqual({ text: "HELP", spaceId: space.id, linePhone: "shared" });
  });
  it("does not process outgoing messages, groups, receipts or body-supplied identities", async () => {
    const t = setup();
    for (const message of [
      { ...payload.message, platform: "telegram" },
      { ...payload.message, direction: "outbound" },
      { ...payload.message, space: { ...payload.message.space, type: "group" } },
      { ...payload.message, content: { type: "read" } },
      { ...payload.message, sender: { id: "Taylor" }, content: { type: "text", text: "I'm +15550000001" } },
    ]) expect((await signedRequest(t, { event: "message", message })).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("inboundMessages").collect())).toEqual([]);
  });
  it("keeps YES and a following message as distinct inbox entries", async () => {
    const t = setup();
    for (const [id, text] of [["yes", "YES"], ["followup", "another question"]]) {
      expect((await signedRequest(t, { event: "message", message: { ...payload.message, id, content: { type: "text", text } } })).status).toBe(200);
    }
    expect(await t.run((ctx) => ctx.db.query("inboundMessages").collect())).toHaveLength(2);
  });
});

describe("Lane A invitations and routing (simulation)", () => {
  it("ST-01: unknown STATUS gets onboarding only, once on replay", async () => {
    const t = setup();
    const messageId = await inbound(t, "STATUS");
    await t.mutation(internal.commands.route, { messageId });
    await t.mutation(internal.commands.route, { messageId });
    const rows = await t.run((ctx) => ctx.db.query("outboundMessages").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe(onboardingCopy);
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toEqual([]);
  });
  it("creates only hashed invitations, no sends, and exact retries return the same code", async () => {
    const t = setup();
    const owner = await organizer(t);
    await expect(t.mutation(api.invitations.createForContacts, { eventId: owner.eventId, contacts: [], idempotencyKey: "fixture" })).rejects.toMatchObject({ data: { version: 1, code: "AUTHENTICATION_REQUIRED" } });
    const first = await invite(t, owner.eventId);
    expect(await invite(t, owner.eventId)).toEqual(first);
    const invitations = await t.run((ctx) => ctx.db.query("invitations").collect());
    expect(invitations).toHaveLength(1);
    expect(JSON.stringify(invitations)).not.toContain(first.code);
    expect(await t.run((ctx) => ctx.db.query("outboundMessages").collect())).toEqual([]);
    const user = await t.run((ctx) => ctx.db.get(invitations[0]!.targetUserId!));
    expect(user!.verifiedPhoneE164).toBeUndefined();
  });
  it("requires organizer role, not just an authenticated client or supplied event ID", async () => {
    const t = setup();
    const owner = await organizer(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { displayName: "Member", authSubject: "fixture-member", createdAt: Date.now(), messagingState: "active", settings: {} });
      await ctx.db.insert("memberships", { userId, eventId: owner.eventId, role: "member", state: "enrolled", notificationsEnabled: false });
    });
    await expect(t.withIdentity({ subject: "fixture-member" }).mutation(api.invitations.createForContacts, { eventId: owner.eventId, contacts: [], idempotencyKey: "fixture" })).rejects.toMatchObject({ data: { version: 1, code: "ACCESS_DENIED" } });
  });
  it("enrolls only the selected sender, records consent and rejects invitation replay", async () => {
    const t = setup();
    const owner = await organizer(t);
    const invitation = await invite(t, owner.eventId);
    const wrongMessage = await inbound(t, `JOIN ${invitation.code}`, "+15550000009");
    expect(await t.mutation(internal.invitations.redeem, { messageId: wrongMessage, code: invitation.code })).toEqual({ redeemed: false });
    const messageId = await inbound(t, `JOIN ${invitation.code}`);
    await t.mutation(internal.commands.route, { messageId });
    const stored = await t.run((ctx) => ctx.db.get(invitation.invitationId));
    expect(stored).toMatchObject({ state: "redeemed", failedAttempts: 1 });
    const membership = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", owner.eventId).eq("userId", stored!.targetUserId!)).unique());
    expect(membership).toMatchObject({ state: "enrolled", consentSourceMessageId: messageId });
    expect(membership!.consentAt).toBeTypeOf("number");
    expect(await t.mutation(internal.invitations.redeem, { messageId, code: invitation.code })).toEqual({ redeemed: false });
  });
  it("handles onboarding before JOIN without creating duplicate phone identities", async () => {
    const t = setup();
    const owner = await organizer(t);
    const invitation = await invite(t, owner.eventId);
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "HELP") });
    await t.mutation(internal.commands.route, { messageId: await inbound(t, `JOIN ${invitation.code}`) });
    const users = await t.run((ctx) => ctx.db.query("users").withIndex("by_phone", (q) => q.eq("verifiedPhoneE164", "+15550000001")).collect());
    expect(users).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(invitation.invitationId))).toMatchObject({ state: "redeemed", targetUserId: users[0]!._id });
  });
  it("rejects expired invitations and locks after five wrong-sender attempts", async () => {
    const t = setup();
    const owner = await organizer(t);
    const invitation = await invite(t, owner.eventId);
    for (let i = 0; i < 6; i++) {
      const messageId = await inbound(t, `JOIN ${invitation.code}`, "+15550000009");
      expect(await t.mutation(internal.invitations.redeem, { messageId, code: invitation.code })).toEqual({ redeemed: false });
    }
    expect(await t.run((ctx) => ctx.db.get(invitation.invitationId))).toMatchObject({ failedAttempts: 5 });
    const expired = await invite(t, owner.eventId, "+15550000003", "fixture-expired");
    await t.run((ctx) => ctx.db.patch(expired.invitationId, { expiresAt: Date.now() - 1 }));
    expect(await t.mutation(internal.invitations.redeem, { messageId: await inbound(t, `JOIN ${expired.code}`, "+15550000003"), code: expired.code })).toEqual({ redeemed: false });
    expect(await t.run((ctx) => ctx.db.get(expired.invitationId))).toMatchObject({ state: "expired" });
  });
  it("STOP blocks a queued send; PAUSE and RESUME preserve event consent", async () => {
    const t = setup();
    const member = await enroll(t);
    const queued = await t.mutation(internal.outbox.enqueue, { recipientUserId: member.memberId, eventId: member.eventId, content: "Fixture reminder", idempotencyKey: "fixture-reminder" });
    for (const [command, state] of [["PAUSE", "paused"], ["RESUME", "active"], ["STOP", "stopped"]] as const) {
      const messageId = await inbound(t, command);
      await t.mutation(internal.commands.route, { messageId });
      expect(await t.run((ctx) => ctx.db.get(member.memberId))).toMatchObject({ messagingState: state });
    }
    expect(await t.run((ctx) => ctx.db.get(queued))).toMatchObject({ state: "failed", attemptCount: 0 });
    await expect(t.mutation(internal.outbox.enqueue, { recipientUserId: member.memberId, eventId: member.eventId, content: "Fixture reminder", idempotencyKey: "fixture-after-stop" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
  });
  it("LEAVE revokes only the named membership and calls domain cancellation", async () => {
    const t = setup();
    const member = await enroll(t);
    // Organizer fixture intentionally has no messaging consent; no cold notice.
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "LEAVE Fixture Charity 5K") });
    const membership = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", member.eventId).eq("userId", member.memberId)).unique());
    expect(membership).toMatchObject({ state: "left", notificationsEnabled: false });
    expect((await t.run((ctx) => ctx.db.query("outboundMessages").collect())).some((m) => m.content.startsWith("You've left"))).toBe(true);
  });
  it("reports a simulated status outage truthfully, without invoking a model", async () => {
    const t = setup({ "./domain.ts": async () => ({ statusFor: internalQuery({
      args: { userId: v.id("users"), eventId: v.optional(v.id("events")) },
      returns: statusSummary,
      handler: async () => { throw new Error("SIMULATED_DOMAIN_FAILURE"); },
    }) }) });
    await enroll(t);
    const messageId = await inbound(t, "STATUS");
    await t.mutation(internal.commands.route, { messageId });
    expect(await t.run((ctx) => ctx.db.get(messageId))).toMatchObject({ processingState: "failed" });
    expect((await t.run((ctx) => ctx.db.query("outboundMessages").collect()))[0]!.content).toContain("isn't available yet");
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toEqual([]);
  });
});

describe("Lane A outbox with FakeMessagingAdapter (simulation)", () => {
  it.each(["sent", "timeout", "failed"] as const)("deduplicates %s attempts and holds unknown outcomes without retries", async (outcome) => {
    const t = setup();
    const member = await enroll(t);
    const args = { recipientUserId: member.memberId, eventId: member.eventId, content: "Fixture request", idempotencyKey: "fixture-send" };
    const outboundMessageId = await t.mutation(internal.outbox.enqueue, args);
    expect(await t.mutation(internal.outbox.enqueue, args)).toBe(outboundMessageId);
    const fake = new FakeMessagingAdapter({ outcome });
    await t.run((ctx) => deliverWithAdapter(ctx, outboundMessageId, () => fake));
    await t.run((ctx) => deliverWithAdapter(ctx, outboundMessageId, () => fake));
    expect(fake.sends).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(outboundMessageId))).toMatchObject({ state: outcome === "timeout" ? "unknown" : outcome, attemptCount: 1 });
    expect(await t.mutation(internal.outbox.enqueue, args)).toBe(outboundMessageId);
    await expect(t.mutation(internal.outbox.enqueue, { ...args, content: "Different content" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("rechecks opt-out at dispatch and rejects direct-reply bypasses", async () => {
    const t = setup();
    const member = await enroll(t);
    const outboundMessageId = await t.mutation(internal.outbox.enqueue, { recipientUserId: member.memberId, eventId: member.eventId, content: "Fixture reminder", idempotencyKey: "fixture-queued" });
    await t.run((ctx) => ctx.db.patch(member.memberId, { messagingState: "stopped" }));
    const fake = new FakeMessagingAdapter();
    await t.run((ctx) => deliverWithAdapter(ctx, outboundMessageId, () => fake));
    expect(fake.sends).toEqual([]);
    await expect(t.mutation(internal.outbox.enqueue, { recipientUserId: member.memberId, content: "Private event data", directReplyToMessageId: member.messageId, idempotencyKey: "fixture-bypass" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
  });
});

describe("Lane A routing against explicit Lane B/C test doubles", () => {
  it("renders structured STATUS from a domain double and rejects unrelated event output", async () => {
    let response: Infer<typeof statusSummary> = { events: [] };
    let requestedUser: Id<"users"> | undefined;
    const t = setup({ "./domain.ts": async () => ({ statusFor: internalQuery({
      args: { userId: v.id("users"), eventId: v.optional(v.id("events")) }, returns: statusSummary,
      handler: async (_ctx, args) => { requestedUser = args.userId; return response; },
    }) }) });
    const member = await enroll(t);
    const taskId = await t.run((ctx) => ctx.db.insert("tasks", { eventId: member.eventId, title: "setup", capacity: 1, status: "confirmed", version: 1 }));
    const proposalId = await t.run((ctx) => ctx.db.insert("proposals", { eventId: member.eventId, type: "reassignment", originatorId: member.userId, targetUserId: member.memberId, targetTaskId: taskId, state: "pending", requiresOrganizerApproval: false, eventVersionAtCreation: 1, taskVersionAtCreation: 1, expiresAt: Date.now() + 60_000, idempotencyKey: "fixture-pending" }));
    response = { events: [{ event: { _id: member.eventId, title: "Fixture Charity 5K", kind: "event", startsAt: Date.now(), timezone: "America/New_York", status: "scheduled", version: 1, role: "member" }, tasks: [{ _id: taskId, eventId: member.eventId, title: "setup", capacity: 1, status: "confirmed", version: 1, activeAssigneeIds: [member.userId] }], members: [], proposals: [{ _id: proposalId, eventId: member.eventId, type: "reassignment", targetTaskId: taskId, targetUserId: member.memberId, state: "pending", requiresOrganizerApproval: false, expiresAt: Date.now() + 60_000 }] }] };
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "STATUS") });
    expect(requestedUser).toBe(member.memberId);
    expect((await t.run((ctx) => ctx.db.query("outboundMessages").collect()))[0]!.content).toContain("confirmed (1 accepted); 1 awaiting response");
    const unrelated = await t.run((ctx) => ctx.db.insert("events", { title: "Private unrelated event", kind: "event", startsAt: Date.now(), timezone: "America/New_York", ownerId: member.userId, status: "scheduled", version: 1 }));
    response.events[0]!.event._id = unrelated;
    response.events[0]!.event.title = "Private unrelated event";
    const messageId = await inbound(t, "STATUS");
    await t.mutation(internal.commands.route, { messageId });
    expect(await t.run((ctx) => ctx.db.get(messageId))).toMatchObject({ processingState: "failed" });
    expect(JSON.stringify(await t.run((ctx) => ctx.db.query("outboundMessages").collect()))).not.toContain("Private unrelated event");
  });
  it.each(["YES", "NO"] as const)("routes %s to only the verified target's offer, once", async (command) => {
    const calls: { actorId: Id<"users">; sourceMessageId: Id<"inboundMessages">; proposalId: Id<"proposals">; response: "accept" | "decline" }[] = [];
    const t = setup({ "./proposals.ts": async () => ({ respond: internalMutation({
      args: { proposalId: v.id("proposals"), actorId: v.id("users"), sourceMessageId: v.id("inboundMessages"), response: v.union(v.literal("accept"), v.literal("decline")) },
      returns: v.union(v.literal("accepted"), v.literal("declined")),
      handler: async (_ctx, args) => { calls.push(args); return args.response === "accept" ? "accepted" as const : "declined" as const; },
    }) }) });
    const member = await enroll(t);
    const proposalId = await t.run((ctx) => ctx.db.insert("proposals", { eventId: member.eventId, type: "assignment", originatorId: member.userId, targetUserId: member.memberId, state: "pending", requiresOrganizerApproval: false, eventVersionAtCreation: 1, expiresAt: Date.now() + 60_000, idempotencyKey: "fixture-offer" }));
    const messageId = await inbound(t, command);
    await t.mutation(internal.commands.route, { messageId });
    await t.mutation(internal.commands.route, { messageId });
    expect(calls).toEqual([{ proposalId, actorId: member.memberId, sourceMessageId: messageId, response: command === "YES" ? "accept" : "decline" }]);
    // The double does not commit domain state. This proves routing only.
    expect(await t.run((ctx) => ctx.db.query("commitments").collect())).toEqual([]);
  });
  it("queues one unknown request via a reasoning double and preserves equivocal replies", async () => {
    const t = setup({ "./reasoningJobs.ts": async () => ({ enqueue: internalMutation({
      args: { messageId: v.id("inboundMessages"), eventId: v.union(v.id("events"), v.null()), contextVersion: v.union(v.number(), v.null()), taskVersions: v.array(v.object({ taskId: v.id("tasks"), version: v.number() })) }, returns: v.id("reasoningJobs"),
      handler: async (ctx, args) => ctx.db.insert("reasoningJobs", { ...args, status: "queued", attempts: 0 }),
    }) }) });
    const member = await enroll(t);
    const messageId = await inbound(t, "Can someone cover setup?");
    await t.mutation(internal.commands.route, { messageId });
    await t.mutation(internal.commands.route, { messageId });
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.query("outboundMessages").collect())).filter((row) => row.content === "Got it. I’ll check the plan.")).toHaveLength(1);
    await t.run((ctx) => ctx.db.insert("proposals", { eventId: member.eventId, type: "assignment", originatorId: member.userId, targetUserId: member.memberId, state: "pending", requiresOrganizerApproval: false, eventVersionAtCreation: 1, expiresAt: Date.now() + 60_000, idempotencyKey: "fixture-maybe" }));
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "Maybe?") });
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.query("outboundMessages").collect())).some((row) => row.content.includes("No acceptance recorded"))).toBe(true);
    const secondEvent = await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", { title: "Fixture Hack Night", kind: "event", startsAt: Date.now(), timezone: "America/New_York", ownerId: member.userId, status: "scheduled", version: 1 });
      await ctx.db.insert("memberships", { userId: member.memberId, eventId, role: "member", state: "enrolled", notificationsEnabled: true, consentAt: Date.now(), consentSourceMessageId: member.messageId });
      return eventId;
    });
    // Recent event focus now persists. Expire it to exercise genuine ambiguity.
    await t.run(async ctx => { const focus = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", member.memberId)).unique(); if (focus) await ctx.db.patch(focus._id, { expiresAt: Date.now() - 1 }); });
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "Can someone cover setup?") });
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(1);
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "For Fixture Hack Night, can someone cover setup?") });
    const jobs = await t.run((ctx) => ctx.db.query("reasoningJobs").collect());
    expect(jobs).toHaveLength(2);
    expect(jobs[1]!.eventId).toBe(secondEvent);
    await t.mutation(internal.commands.route, { messageId: await inbound(t, "Fixture Hack Night or Fixture Charity 5K?") });
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(2);
  });
});
