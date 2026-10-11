import { convexTest } from "convex-test";
import spectrumTest from "@spectrum-ts/convex/test";
import { expect, vi } from "vitest";
import { v } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import { internalAction } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { FakeMessagingAdapter } from "../../packages/shared/adapters";
import { deliverWithAdapter } from "../../convex/lib/messagingDelivery";


const modules = import.meta.glob(["../../convex/**/*.ts", "!../../convex/**/*.test.ts"]);
export async function messagingHarness() {
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
  async function receive(phone: string, text: string, providerMessageId: string = crypto.randomUUID(), route = true) {
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
  const outbox = () => t.run(ctx => ctx.db.query("outboundMessages").collect());
  return { t, phones, fake, drain, receive, outbox };
}

export async function harness() {
  const { t, phones, fake, drain, receive, outbox } = await messagingHarness();
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
  const active = () => t.run(async ctx => (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", ids.task)).collect()).filter(c => c.state === "active"));
  return { t, app, ids, phones, receive, drain, offer, fake, outbox, active };
}
