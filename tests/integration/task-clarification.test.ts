import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./harness";
import { api, internal } from "../../convex/_generated/api";
import { resolveMessageJob } from "../../convex/context";

const credentials = { workerToken: "fixture-clarification-worker-".repeat(3), workerId: "fixture-worker" };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
  vi.stubEnv("RALLY_WORKER_TOKEN", credentials.workerToken);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const h = await harness();
  const start = Date.now() + 100_000_000;
  const speakers = await h.app.mutation(api.tasks.create, { eventId: h.ids.event, title: "speakers", capacity: 3, windowStart: start, windowEnd: start + 3600000, expectedEventVersion: 2, idempotencyKey: "speakers" });
  const offer = await h.offer(h.ids.maya, "assignment", speakers);
  // Fixture setup requests are not under test; remove them before claiming.
  await h.t.run(async ctx => { for (const job of await ctx.db.query("reasoningJobs").collect()) await ctx.db.patch(job._id, { status: "failed" }); });
  return { ...h, speakers, offer };
}
function decision(event: string, taskRef: string) {
  return JSON.stringify({ schemaVersion: 1, eventCandidateId: event, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef, toParticipantRef: "Alex" }], responseStyle: "concise", reasonCodes: [] });
}

describe("task clarification (signed synthetic DMs; no live model/provider)", () => {
  it("asks before inference when accepted setup and offered speakers both fit a vague cover request", async () => {
    const h = await setup();
    const message = await h.receive(h.phones.maya, "can Alex cover for me instead?");
    expect(await h.t.run(ctx => ctx.db.query("reasoningJobs").withIndex("by_message", q => q.eq("messageId", message)).collect())).toEqual([]);
    const replies = (await h.outbox()).filter(row => row.directReplyToMessageId === message);
    expect(replies.at(-1)?.content).toContain("which task do you mean?");
    expect(replies.at(-1)?.content).toContain("setup"); expect(replies.at(-1)?.content).toContain("speakers");
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
    expect(await h.t.run(ctx => ctx.db.get(h.offer))).toMatchObject({ state: "pending" });
  });
  it("binds a task-name follow-up to the signed original and waits for organizer approval without moving setup", async () => {
    const h = await setup();
    const original = await h.receive(h.phones.maya, "can Alex cover for me instead?");
    const answer = await h.receive(h.phones.maya, "speakers");
    expect(await h.t.run(ctx => ctx.db.get(answer))).toMatchObject({ clarifiesMessageId: original, clarifiedTaskId: h.speakers });
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    expect(job).not.toBeNull();
    expect(JSON.parse(job.packetJson)).toMatchObject({ incomingText: "can Alex cover for me instead?", selectedTaskId: h.speakers, recentTaskFocusId: h.speakers, currentTime: expect.any(String), relevantTasks: expect.arrayContaining([{ id: h.speakers, name: "speakers", capacity: 3, window: expect.any(Object), status: expect.any(String), version: expect.any(Number), activeAssigneeIds: [] }]), pendingProposalsForSender: expect.arrayContaining([expect.objectContaining({ targetTaskId: h.speakers, taskName: "speakers" })]) });
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: decision(h.ids.event, h.speakers) });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    const offers = (await h.t.run(ctx => ctx.db.query("proposals").collect())).filter(row => row.targetUserId === h.ids.alex && row.state === "pending");
    expect(offers).toHaveLength(1); expect(offers[0]).toMatchObject({ targetTaskId: h.speakers, requiresOrganizerApproval: true });
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
    expect((await h.outbox()).some(row => row.recipientUserId === h.ids.maya && row.content.includes("Offer created for Alex to cover speakers") && row.content.includes("organizer approval"))).toBe(true);
  });
  it("lets an explicit different event override an outstanding task question", async () => {
    const h = await setup(); await h.receive(h.phones.maya, "can Alex cover for me instead?");
    const other = await h.t.run(async ctx => {
      const existing = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.maya)).unique())!;
      const eventId = await ctx.db.insert("events", { title: "Other picnic", kind: "event", startsAt: Date.now() + 86400000, timezone: "UTC", ownerId: h.ids.alex, status: "scheduled", version: 1 });
      await ctx.db.insert("memberships", { eventId, userId: h.ids.maya, role: "member", state: "enrolled", notificationsEnabled: true, consentAt: existing.consentAt!, consentSourceMessageId: existing.consentSourceMessageId! });
      return eventId;
    });
    const request = await h.receive(h.phones.maya, "Other picnic");
    const job = await h.t.run(ctx => ctx.db.query("reasoningJobs").withIndex("by_message", q => q.eq("messageId", request)).unique());
    expect(job).toMatchObject({ eventId: other });
    expect(await h.t.run(ctx => ctx.db.get(request))).not.toHaveProperty("clarifiesMessageId");
    expect((await h.outbox()).filter(row => row.directReplyToMessageId === request).some(row => row.content.includes("which task"))).toBe(false);
  });
  it("does not bind a later short reply to an already resolved question", async () => {
    const h = await setup();
    await h.receive(h.phones.maya, "can Alex cover for me instead?"); await h.receive(h.phones.maya, "speakers");
    const thanks = await h.receive(h.phones.maya, "thanks");
    expect(await h.t.run(ctx => ctx.db.get(thanks))).not.toHaveProperty("clarifiesMessageId");
    expect((await h.outbox()).filter(row => row.directReplyToMessageId === thanks).some(row => row.content.includes("which task"))).toBe(false);
  });
  it("turns a self-volunteer overlap into a warning, then commits only after exact confirmation", async () => {
    const h = await setup();
    await h.t.run(async ctx => { const setup = (await ctx.db.get(h.ids.task))!; await ctx.db.patch(h.speakers, { windowStart: setup.windowStart!, windowEnd: setup.windowEnd! }); });
    await h.receive(h.phones.maya, "I can bring speakers");
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const self = JSON.parse(decision(h.ids.event, h.speakers)); self.actions = [{ type: "RECORD_SELF_COMMITMENT", taskRef: "speakers" }];
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify(self) }); await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    const pending = (await h.t.run(ctx => ctx.db.query("proposals").collect())).find(row => row.originatorId === h.ids.maya && row.targetTaskId === h.speakers)!;
    expect(pending).toMatchObject({ state: "pending", overlapWarningJson: expect.any(String) });
    expect((await h.t.run(ctx => ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", h.speakers)).collect())).filter(row => row.state === "active")).toEqual([]);
    expect((await h.outbox()).some(row => row.proposalId === pending._id && row.content.includes("CONFIRM OVERLAP"))).toBe(true);
    await h.receive(h.phones.maya, `CONFIRM OVERLAP ${pending._id}`);
    expect((await h.t.run(ctx => ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", h.speakers)).collect())).filter(row => row.state === "active")).toMatchObject([{ participantId: h.ids.maya }]);
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
  });
  it("resolves an opaque self-volunteer task ID to the signed task name and preserves compatible team offers", async () => {
    const h = await setup();
    await h.receive(h.phones.sam, "I can bring speakers");
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const self = JSON.parse(decision(h.ids.event, h.speakers)); self.actions = [{ type: "RECORD_SELF_COMMITMENT", taskRef: h.speakers }];
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify(self) });
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    expect((await h.t.run(ctx => ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", h.speakers)).collect())).filter(row => row.state === "active")).toMatchObject([{ participantId: h.ids.sam }]);
    const task = (await h.t.run(ctx => ctx.db.get(h.speakers)))!;
    expect(await h.t.run(ctx => ctx.db.get(h.offer))).toMatchObject({ state: "pending", taskVersionAtCreation: task.version });
  });
  it("does not treat offering to ask another person as self-acceptance", async () => {
    const h = await setup();
    await h.receive(h.phones.sam, "I can ask Alex to help with speakers");
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const self = JSON.parse(decision(h.ids.event, h.speakers)); self.actions = [{ type: "RECORD_SELF_COMMITMENT", taskRef: "speakers" }];
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify(self) });
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "failed" });
    expect((await h.t.run(ctx => ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", h.speakers)).collect())).filter(row => row.state === "active")).toEqual([]);
  });
  it("rejects a model that changes the chosen task", async () => {
    const h = await setup();
    await h.receive(h.phones.maya, "can Alex cover for me instead?"); await h.receive(h.phones.maya, "speakers");
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: decision(h.ids.event, h.ids.task) });
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "failed" });
    expect((await h.active()).map(row => row.participantId)).toEqual([h.ids.maya]);
  });
  it.each(["version", "expiry"])("requires a fresh request after clarification %s changes", async (kind) => {
    const h = await setup(); await h.receive(h.phones.maya, "can Alex cover for me instead?");
    if (kind === "version") await h.t.run(async ctx => { const task = (await ctx.db.get(h.speakers))!; await ctx.db.patch(task._id, { version: task.version + 1 }); });
    else await h.t.run(async ctx => { const focus = (await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", h.ids.maya)).unique())!; await ctx.db.patch(focus._id, { pendingTaskClarification: { ...focus.pendingTaskClarification!, expiresAt: Date.now() - 1 } }); });
    const answer = await h.receive(h.phones.maya, "speakers");
    expect(await h.t.run(ctx => ctx.db.get(answer))).not.toHaveProperty("clarifiedTaskId");
    expect((await h.outbox()).find(row => row.directReplyToMessageId === answer)?.content).toContain("Please send your full request again");
  });
  it("guards execution too when a job bypasses the command prequeue clarification", async () => {
    const h = await setup();
    const messageId = await h.receive(h.phones.maya, "can Alex cover for me instead?", "bypass-router", false);
    const args = await h.t.run(ctx => resolveMessageJob(ctx, messageId));
    await h.t.mutation(internal.reasoningJobs.enqueue, args);
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: decision(h.ids.event, h.speakers) });
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed", executionResultJson: expect.stringContaining('"needsClarification":true') });
    expect((await h.t.run(ctx => ctx.db.query("proposals").collect())).filter(row => row.targetUserId === h.ids.alex)).toEqual([]);
  });
});
