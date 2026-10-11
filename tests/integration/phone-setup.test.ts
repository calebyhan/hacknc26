import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messagingHarness } from "./harness";
import { api, internal } from "../../convex/_generated/api";

const credentials = { workerToken: "fixture-ai-worker-token-".repeat(3), workerId: "fixture-worker" };
const create = "CREATE EVENT Picnic | 2026-10-12T18:00:00Z | America/New_York | Park";
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T18:00:00Z"));
  vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
  vi.stubEnv("RALLY_WORKER_TOKEN", credentials.workerToken);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("phone-only setup (signed simulated DMs, fake delivery, no app identity)", () => {
  async function draft(h: Awaited<ReturnType<typeof messagingHarness>>) {
    await h.receive(h.phones.alex, create, "create-picnic");
    const event = (await h.t.run(ctx => ctx.db.query("events").unique()))!;
    const reply = h.fake.sends.at(-1)!.content;
    const code = /JOIN ([A-F0-9]{32})/.exec(reply)![1]!;
    return { event, code };
  }
  async function enrolled(h: Awaited<ReturnType<typeof messagingHarness>>) {
    const result = await draft(h);
    await h.receive(h.phones.alex, `JOIN ${result.code}`);
    await h.receive(h.phones.alex, `CONFIRM ${result.event._id} 1`);
    return result;
  }
  it("creates one draft, requires JOIN and exact owner confirmation, and keeps app APIs protected", async () => {
    const h = await messagingHarness(); const { event, code } = await draft(h);
    expect(event.status).toBe("draft");
    expect(await h.t.run(ctx => ctx.db.query("memberships").unique())).toMatchObject({ role: "organizer", notificationsEnabled: false });
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)!.content).not.toContain("Picnic");
    const sendCount = h.fake.sends.length;
    await h.receive(h.phones.alex, create, "create-picnic");
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(1);
    expect(h.fake.sends).toHaveLength(sendCount);
    await h.receive(h.phones.jordan, `JOIN ${code}`);
    await h.receive(h.phones.jordan, `CONFIRM ${event._id} 1`);
    await h.receive(h.phones.alex, `CONFIRM ${event._id} 1`);
    expect((await h.t.run(ctx => ctx.db.get(event._id)))!.status).toBe("draft");
    const join = await h.receive(h.phones.alex, `JOIN ${code}`);
    expect(await h.t.run(ctx => ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", event._id).eq("userId", event.ownerId)).unique())).toMatchObject({ consentSourceMessageId: join, notificationsEnabled: true });
    await h.receive(h.phones.alex, `CONFIRM ${event._id} 7`);
    expect((await h.t.run(ctx => ctx.db.get(event._id)))!.status).toBe("draft");
    await h.receive(h.phones.alex, `CONFIRM ${event._id} 1`, "confirm-picnic");
    await h.receive(h.phones.alex, `CONFIRM ${event._id} 1`, "confirm-picnic");
    expect(await h.t.run(ctx => ctx.db.get(event._id))).toMatchObject({ status: "scheduled", version: 2 });
    await expect(h.t.query(api.events.myEvents, {})).rejects.toThrow("UNAUTHORIZED");
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").collect())).toHaveLength(0);
  });
  it("handles STOP and RESUME before any event exists without enabling event consent", async () => {
    const h = await messagingHarness();
    await h.receive(h.phones.alex, "STOP"); await h.receive(h.phones.alex, create);
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(0);
    await h.receive(h.phones.alex, "RESUME"); await draft(h);
    expect(await h.t.run(ctx => ctx.db.query("memberships").unique())).toMatchObject({ notificationsEnabled: false });
  });
  it("keeps STATUS available for joined events when another draft has no messaging consent", async () => {
    const h = await messagingHarness(); await enrolled(h);
    await h.receive(h.phones.alex, create.replace("Picnic", "Other draft"));
    await h.receive(h.phones.alex, "STATUS");
    expect(h.fake.sends.at(-1)!.content).toContain("Picnic:");
    expect(h.fake.sends.at(-1)!.content).not.toContain("Other draft");
    expect(h.fake.sends.at(-1)!.content).not.toContain("available yet");
  });
  it("binds organizer approval to the correct signed sender and never treats it as participant acceptance", async () => {
    const h = await messagingHarness(); const { event } = await enrolled(h);
    await h.receive(h.phones.alex, "TASK Picnic | setup | 2026-10-12T17:00:00Z | 2026-10-12T18:00:00Z");
    for (const [name, phone] of [["Jordan", h.phones.jordan], ["Sam", h.phones.sam]]) {
      await h.receive(h.phones.alex, `INVITE Picnic | ${name} | ${phone}`);
      const code = /JOIN ([A-F0-9]{32})/.exec(h.fake.sends.at(-1)!.content)![1]!;
      await h.receive(phone!, `JOIN ${code}`);
    }
    const sends = h.fake.sends.length;
    await h.receive(h.phones.sam, "Could Jordan cover setup at Picnic?");
    const job = (await h.t.mutation(api.reasoningJobs.claim, credentials))!;
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify({ schemaVersion: 1, eventCandidateId: event._id, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "setup", toParticipantRef: "Jordan" }], responseStyle: "concise", reasonCodes: [] }) }); await h.drain();
    const offer = (await h.t.run(ctx => ctx.db.query("proposals").unique()))!;
    expect(h.fake.sends.slice(sends).filter(s => s.toPhoneE164 === h.phones.jordan)).toHaveLength(0);
    await h.receive(h.phones.sam, `APPROVE ${offer._id}`);
    expect((await h.t.run(ctx => ctx.db.get(offer._id)))!.organizerApprovedAt).toBeUndefined();
    await h.receive(h.phones.alex, `APPROVE ${offer._id}`, "approval");
    const count = h.fake.sends.length; await h.receive(h.phones.alex, `APPROVE ${offer._id}`, "approval");
    expect(h.fake.sends).toHaveLength(count);
    expect(h.fake.sends.slice(sends).filter(s => s.toPhoneE164 === h.phones.jordan)).toHaveLength(1);
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toHaveLength(0);
    await h.receive(h.phones.jordan, "YES");
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toMatchObject([{ state: "active" }]);
  });
  it("sets up a timed task and invitation without cold outreach, then commits only the target's YES", async () => {
    const h = await messagingHarness(); const { event } = await enrolled(h);
    await h.receive(h.phones.alex, "TASK Picnic | setup | 2026-10-12T17:00:00Z | 2026-10-12T18:00:00Z", "task-setup");
    await h.receive(h.phones.alex, "TASK Picnic | setup | 2026-10-12T17:00:00Z | 2026-10-12T18:00:00Z", "task-setup");
    const task = (await h.t.run(ctx => ctx.db.query("tasks").unique()))!;
    expect(task).toMatchObject({ status: "unassigned", version: 1 });
    // A friend may have already said hi before receiving their invitation.
    await h.receive(h.phones.jordan, "hi");
    const contactSendCount = h.fake.sends.length;
    await h.receive(h.phones.alex, `INVITE Picnic | Jordan | ${h.phones.jordan}`);
    const invitationCode = /JOIN ([A-F0-9]{32})/.exec(h.fake.sends.at(-1)!.content)![1]!;
    expect(h.fake.sends.slice(contactSendCount).every(send => send.toPhoneE164 === h.phones.alex)).toBe(true);
    await h.receive(h.phones.jordan, `JOIN ${invitationCode}`);
    await h.receive(h.phones.jordan, "TASK Picnic | forbidden | 2026-10-12T17:00:00Z | 2026-10-12T18:00:00Z");
    expect(await h.t.run(ctx => ctx.db.query("tasks").collect())).toHaveLength(1);
    await h.receive(h.phones.alex, "Can Jordan cover setup for Picnic?");
    const job = (await h.t.mutation(api.reasoningJobs.claim, credentials))!;
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify({ schemaVersion: 1, eventCandidateId: event._id, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: "setup", toParticipantRef: "Jordan" }], responseStyle: "concise", reasonCodes: [] }) });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toHaveLength(0);
    await h.receive(h.phones.alex, "YES");
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toHaveLength(0);
    await h.receive(h.phones.jordan, "YES", "target-yes");
    await h.receive(h.phones.jordan, "YES", "target-yes");
    expect(await h.t.run(ctx => ctx.db.query("commitments").collect())).toMatchObject([{ state: "active", taskId: task._id }]);
  });
  it.each([ ["Rally participant", "Jordan"], ["Existing name", "Existing name"] ])("updates only a placeholder name after the correct participant JOIN (%s)", async (originalName, expectedName) => {
    const h = await messagingHarness(); await enrolled(h);
    await h.receive(h.phones.jordan, "hi");
    const before = (await h.t.run(ctx => ctx.db.query("users").withIndex("by_phone", q => q.eq("verifiedPhoneE164", h.phones.jordan)).unique()))!;
    await h.t.run(ctx => ctx.db.patch(before._id, { displayName: originalName }));
    await h.receive(h.phones.alex, `INVITE Picnic | Jordan | ${h.phones.jordan}`);
    const code = /JOIN ([A-F0-9]{32})/.exec(h.fake.sends.at(-1)!.content)![1]!;
    expect((await h.t.run(ctx => ctx.db.get(before._id)))!.displayName).toBe(originalName);
    await h.receive(h.phones.sam, `JOIN ${code}`);
    expect((await h.t.run(ctx => ctx.db.get(before._id)))!.displayName).toBe(originalName);
    await h.receive(h.phones.jordan, `JOIN ${code}`);
    expect(await h.t.run(ctx => ctx.db.get(before._id))).toMatchObject({ displayName: expectedName, verifiedPhoneE164: h.phones.jordan });
  });
  it("rejects malformed setup, past dates, arbitrary replies, foreign scopes, and STOP before setup", async () => {
    const h = await messagingHarness();
    await h.receive(h.phones.alex, "CREATE EVENT Bad | tomorrow | UTC");
    await h.receive(h.phones.alex, "CREATE EVENT Past | 2020-01-01T12:00:00Z | UTC");
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(0);
    const { event } = await draft(h);
    const source = (await h.t.run(ctx => ctx.db.query("inboundMessages").withIndex("by_provider_message_id", q => q.eq("provider", "spectrum").eq("providerMessageId", "create-picnic")).unique()))!;
    await expect(h.t.mutation(internal.outbox.enqueue, { idempotencyKey: "arbitrary", recipientUserId: event.ownerId, directReplyToMessageId: source._id, content: "Arbitrary outreach" })).rejects.toThrow("MESSAGING_NOT_PERMITTED");
    await h.receive(h.phones.jordan, `INVITE ${event._id} | Sam | ${h.phones.sam}`);
    expect(await h.t.run(ctx => ctx.db.query("invitations").collect())).toHaveLength(1);
    await h.receive(h.phones.alex, "STOP");
    const count = h.fake.sends.length;
    await h.receive(h.phones.alex, create);
    expect(await h.t.run(ctx => ctx.db.query("events").collect())).toHaveLength(1);
    expect(h.fake.sends).toHaveLength(count);
  });
});
