import { convexTest } from "convex-test";
import spectrumTest from "@spectrum-ts/convex/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import { internalAction } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { FakeMessagingAdapter } from "../../packages/shared/adapters";
import { deliverWithAdapter } from "../../convex/lib/messagingDelivery";

// Actual A+B functions, signed synthetic webhooks and actual scheduler. Only
// the external provider boundary is fake. No real phones, Photon or Claude.
const modules = import.meta.glob(["../../convex/**/*.ts", "!../../convex/**/*.test.ts"]);
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function harness() {
  const fake = new FakeMessagingAdapter();
  const t = convexTest(schema, { ...modules, "../../convex/spectrumSender.ts": async () => ({
    deliver: internalAction({ args: { outboundMessageId: v.id("outboundMessages") }, returns: v.null(),
      handler: (ctx, args) => deliverWithAdapter(ctx, args.outboundMessageId, () => fake),
    }),
  }) });
  spectrumTest.register(t, "spectrum");
  const phones = { alex: "+15550000001", maya: "+15550000002", jordan: "+15550000003", sam: "+15550000004" };
  async function drain() {
    // Drain only due jobs. Do not fast-forward offer TTLs or watchdogs.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(1); await t.finishInProgressScheduledFunctions();
      const jobs = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
      expect(jobs.filter(j => j.state.kind === "failed")).toEqual([]);
      if (!jobs.some(j => j.state.kind === "pending" && j.scheduledTime <= Date.now())) return;
    }
    throw new Error("Due scheduler jobs did not finish");
  }
  async function receive(phone: string, text: string, providerMessageId = crypto.randomUUID(), route = true) {
    const payload = { event: "message", message: { id: providerMessageId, platform: "iMessage", direction: "inbound", sender: { id: phone }, space: { id: `any;-;${phone}`, type: "dm", phone: "shared" }, content: { type: "text", text } } };
    const body = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000).toString();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("integration-webhook-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${body}`)));
    const signature = Array.from(mac, b => b.toString(16).padStart(2, "0")).join("");
    expect((await t.fetch("/spectrum/webhook", { method: "POST", body, headers: { "x-spectrum-timestamp": timestamp, "x-spectrum-signature": `v0=${signature}` } })).status).toBe(200);
    if (route) await drain();
    const message = await t.run(ctx => ctx.db.query("inboundMessages").withIndex("by_provider_message_id", q => q.eq("provider", "spectrum").eq("providerMessageId", providerMessageId)).unique());
    return message!._id;
  }
  const app = t.withIdentity({ subject: "simulation|integration-organizer" });
  const alex = await app.mutation(api.accounts.register, { displayName: "Alex" });
  const phoneProof = await app.mutation(api.accounts.beginPhoneLink, { phoneE164: phones.alex, idempotencyKey: "phone" });
  await receive(phones.alex, `JOIN ${phoneProof.code}`);
  await app.mutation(api.accounts.completePhoneLink, { invitationId: phoneProof.invitationId });
  const event = await app.mutation(api.events.create, { title: "Integration Charity 5K", kind: "event", startsAt: Date.now() + 86400000, timezone: "America/New_York", idempotencyKey: "event" });
  const task = await app.mutation(api.tasks.create, { eventId: event, title: "setup", windowStart: Date.now() + 86400000, windowEnd: Date.now() + 90000000, expectedEventVersion: 1, idempotencyKey: "task" });
  await app.mutation(api.events.confirmDraft, { eventId: event, expectedVersion: 1 });
  const organizerInvite = await app.mutation(api.events.organizerInvitation, { eventId: event, idempotencyKey: "organizer-opt-in" });
  await receive(phones.alex, `JOIN ${organizerInvite.code}`);
  const sendCount = fake.sends.length;
  const invitations = await app.mutation(api.invitations.createForContacts, { eventId: event, contacts: ["maya", "jordan", "sam"].map(name => ({ displayName: name[0]!.toUpperCase() + name.slice(1), phoneE164: phones[name as keyof typeof phones] })), idempotencyKey: "selected-contacts" });
  await drain(); expect(fake.sends).toHaveLength(sendCount); // selection is not consent
  const participants: Id<"users">[] = [];
  for (const [i, name] of ["maya", "jordan", "sam"].entries()) {
    await receive(phones[name as keyof typeof phones], `JOIN ${invitations[i]!.code}`);
    participants.push((await t.run(ctx => ctx.db.get(invitations[i]!.invitationId)))!.targetUserId!);
  }
  const ids = { alex, maya: participants[0]!, jordan: participants[1]!, sam: participants[2]!, event, task };
  let requestNumber = 0;
  async function offer(targetUserId = ids.jordan, type: "assignment" | "reassignment" = "reassignment", targetTaskId = ids.task, dispatch = true) {
    // Explicit simulated manual proposal setup while C is absent. Its source
    // is still an actual signed persisted fixture DM, not invented evidence.
    const sourceMessageId = await receive(phones.alex, "Can someone cover setup?");
    const currentTask = (await t.run(ctx => ctx.db.get(targetTaskId)))!;
    const proposalId = await t.mutation(internal.proposals.create, { eventId: ids.event, originatorId: ids.alex, sourceMessageId, type, ...(type === "reassignment" ? { subjectId: ids.maya } : {}), targetTaskId, targetUserId, expectedEventVersion: 2, expectedTaskVersion: currentTask.version, expiresAt: Date.now() + 600000, idempotencyKey: `integration-offer-${++requestNumber}` });
    if (dispatch) await drain(); return proposalId;
  }
  await offer(ids.maya, "assignment"); await receive(phones.maya, "YES");
  const outbox = () => t.run(ctx => ctx.db.query("outboundMessages").collect());
  const active = () => t.run(async ctx => (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", ids.task)).collect()).filter(c => c.state === "active"));
  return { t, app, ids, phones, receive, drain, offer, fake, outbox, active };
}

describe("Lane A+B full pipeline (simulation; no real provider/model)", () => {
  it("signed JOIN -> request -> YES -> STATUS commits once; duplicate webhook and repeated YES do not renotify", async () => {
    const h = await harness(), before = (await h.outbox()).length;
    const p = await h.offer();
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    const request = (await h.outbox()).filter(r => r.proposalId === p);
    expect(request).toHaveLength(1); expect(request[0]).toMatchObject({ recipientUserId: h.ids.jordan, state: "sent", attemptCount: 1 });
    const providerMessageId = crypto.randomUUID();
    await h.receive(h.phones.jordan, "YES", providerMessageId);
    const after = (await h.outbox()).length;
    await h.receive(h.phones.jordan, "YES", providerMessageId);
    expect(await h.outbox()).toHaveLength(after);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
    const proposalRows = (await h.outbox()).filter(r => r.proposalId === p);
    expect(proposalRows).toHaveLength(4);
    expect(proposalRows.every(r => r.state === "sent" && r.providerMessageId && r.attemptCount === 1)).toBe(true);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)?.content).toContain("setup: confirmed (1 accepted)");
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toEqual([]);
    expect((await h.outbox()).length).toBeGreaterThan(before);
  });
  it("signed NO preserves Maya and emits one truthful notice to organizer and target", async () => {
    const h = await harness(), p = await h.offer();
    await h.receive(h.phones.jordan, "NO");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "declined" });
    expect((await h.outbox()).filter(r => r.proposalId === p)).toHaveLength(3);
    expect(h.fake.sends.filter(r => r.recipientUserId === h.ids.alex).at(-1)?.content).toContain("declined");
  });
  it.each(["STOP", "LEAVE Integration Charity 5K"])("%s cancels pending offers before the command returns", async command => {
    const h = await harness(), p = await h.offer();
    const messageId = await h.receive(h.phones.jordan, command, crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId });
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it("STOP followed by immediate RESUME cannot revive an old offer", async () => {
    const h = await harness(), p = await h.offer();
    for (const text of ["STOP", "RESUME", "YES"]) {
      const messageId = await h.receive(h.phones.jordan, text, crypto.randomUUID(), false);
      await h.t.mutation(internal.commands.route, { messageId });
    }
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it.each(["version", "expiry"])("a stale %s offer cannot hide the target's one current offer", async kind => {
    const h = await harness(), stale = await h.offer();
    if (kind === "version") await h.t.run(ctx => ctx.db.patch(h.ids.task, { version: 3 })); // simulated concurrent task edit
    else await h.t.run(ctx => ctx.db.patch(stale, { expiresAt: Date.now() - 1 })); // expiry job has not run
    const current = await h.offer();
    await h.receive(h.phones.jordan, "YES");
    expect(await h.t.run(ctx => ctx.db.get(current))).toMatchObject({ state: "accepted" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
    expect((await h.t.query(internal.domain.statusFor, { userId: h.ids.alex })).events[0]?.proposals.find(p => p._id === stale)?.state).toBe(kind === "version" ? "expired" : "superseded");
  });
  it("two valid offers require clarification and make no commitment change", async () => {
    const h = await harness(); await h.offer();
    const currentTask = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const secondTask = await h.app.mutation(api.tasks.create, { eventId: h.ids.event, title: "cleanup", windowStart: currentTask.windowEnd!, windowEnd: currentTask.windowEnd! + 3600000, expectedEventVersion: 2, idempotencyKey: "cleanup" });
    await h.offer(h.ids.jordan, "assignment", secondTask); await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    expect(h.fake.sends.at(-1)?.content).toContain("several pending offers");
  });
  it("STOP revokes a queued request before the scheduled provider boundary runs", async () => {
    const h = await harness(), p = await h.offer(h.ids.jordan, "reassignment", h.ids.task, false);
    const messageId = await h.receive(h.phones.jordan, "STOP", crypto.randomUUID(), false);
    await h.t.mutation(internal.commands.route, { messageId }); await h.drain();
    expect((await h.outbox()).find(r => r.proposalId === p && r.recipientUserId === h.ids.jordan)).toMatchObject({ state: "failed", attemptCount: 0 });
    expect(h.fake.sends.filter(r => r.proposalId === p && r.recipientUserId === h.ids.jordan)).toEqual([]);
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "canceled" });
  });
  it("PAUSE ignores YES without losing consent; RESUME then YES commits once", async () => {
    const h = await harness(), p = await h.offer();
    await h.receive(h.phones.jordan, "PAUSE"); await h.receive(h.phones.jordan, "YES");
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "pending" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    await h.receive(h.phones.jordan, "RESUME"); await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toEqual([]);
  });
  it("actual scheduled expiry leaves the assignment intact and notifies only once", async () => {
    const h = await harness(), p = await h.offer();
    await vi.advanceTimersByTimeAsync(600001); await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(p))).toMatchObject({ state: "expired" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    const closed = (await h.outbox()).filter(r => r.proposalId === p);
    expect(closed).toHaveLength(3); // request, organizer and target expiry notice
    await h.t.mutation(internal.proposals.expire, { proposalId: p }); await h.drain();
    expect((await h.outbox()).filter(r => r.proposalId === p)).toHaveLength(3);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it("member suggestions contact only the organizer until app approval; target YES is still required", async () => {
    const h = await harness(), sourceMessageId = await h.receive(h.phones.maya, "Can Jordan cover setup?");
    const task = (await h.t.run(ctx => ctx.db.get(h.ids.task)))!;
    const p = await h.t.mutation(internal.proposals.create, { eventId: h.ids.event, originatorId: h.ids.maya, sourceMessageId, type: "reassignment", subjectId: h.ids.maya, targetTaskId: h.ids.task, targetUserId: h.ids.jordan, expectedEventVersion: 2, expectedTaskVersion: task.version, expiresAt: Date.now() + 600000, idempotencyKey: "member-suggestion" });
    await h.drain();
    expect(h.fake.sends.filter(r => r.proposalId === p).map(r => r.recipientUserId)).toEqual([h.ids.alex]);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)?.content).toContain("1 awaiting organizer approval");
    expect(h.fake.sends.at(-1)?.content).not.toContain("awaiting response");
    await h.app.mutation(api.proposals.approve, { proposalId: p }); await h.app.mutation(api.proposals.approve, { proposalId: p }); await h.drain();
    expect(h.fake.sends.filter(r => r.proposalId === p && r.recipientUserId === h.ids.jordan)).toHaveLength(1);
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)?.content).toContain("1 awaiting response");
    expect(h.fake.sends.at(-1)?.content).not.toContain("awaiting organizer approval");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
  });
  it("STATUS uses actual scoped domain reads and never exposes another organizer's private event", async () => {
    const h = await harness(), other = h.t.withIdentity({ subject: "simulation|unrelated-organizer" });
    await other.mutation(api.accounts.register, { displayName: "Other" });
    const privateEvent = await other.mutation(api.events.create, { title: "Private laboratory", kind: "event", startsAt: Date.now() + 86400000, timezone: "UTC", idempotencyKey: "private" });
    await other.mutation(api.tasks.create, { eventId: privateEvent, title: "Private budget", expectedEventVersion: 1, idempotencyKey: "private-task" });
    await h.receive(h.phones.jordan, "STATUS");
    const content = h.fake.sends.at(-1)!.content;
    expect(content).toContain("Integration Charity 5K"); expect(content).not.toContain("Private");
    await expect(h.app.query(api.events.detail, { eventId: privateEvent })).rejects.toThrow("UNAUTHORIZED");
  });
});
