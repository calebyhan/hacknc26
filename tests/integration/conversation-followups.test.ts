import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./harness";
import { api, internal } from "../../convex/_generated/api";

const credentials = { workerToken: "fixture-followup-worker-".repeat(3), workerId: "fixture-followup" };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
  vi.stubEnv("RALLY_WORKER_TOKEN", credentials.workerToken);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function pendingQuestion() {
  const h = await harness();
  await h.t.run(async ctx => { for (const job of await ctx.db.query("reasoningJobs").collect()) await ctx.db.patch(job._id, { status: "failed" }); });
  const messageId = await h.receive(h.phones.alex, "speakers");
  const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
  expect(job).not.toBeNull();
  const decisionJson = JSON.stringify({ schemaVersion: 1, eventCandidateId: h.ids.event, confidenceClass: "ambiguous", needsClarification: true, clarificationQuestion: "Which task?", actions: [{ type: "ASK_CLARIFICATION", question: "Which task?" }], responseStyle: "concise", reasonCodes: [] });
  return { ...h, messageId, job, decisionJson };
}

describe("conversation follow-ups — signed simulation, no live sends", () => {
  it("does not interrupt a newer task wizard with an old model question", async () => {
    const h = await pendingQuestion();
    await h.receive(h.phones.alex, "add a task");
    const before = h.fake.sends.length;
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: h.job.jobId, leaseToken: h.job.leaseToken, decisionJson: h.decisionJson });
    await h.drain();
    expect(h.fake.sends).toHaveLength(before);
    expect(await h.t.run(ctx => ctx.db.get(h.job.jobId))).toMatchObject({ status: "completed" });
    const state = await h.t.run(ctx => ctx.db.query("phoneSetupSessions").withIndex("by_user", q => q.eq("userId", h.ids.alex)).unique());
    expect(JSON.parse(state!.stateJson).step).toBe("title");
  });

  it("rechecks queued old questions at dispatch, even after the newer wizard ends", async () => {
    const h = await pendingQuestion();
    await h.t.run(ctx => ctx.db.patch(h.job.jobId, { executedDecisionJson: h.decisionJson }));
    const oldReply = await h.t.run(ctx => ctx.db.insert("outboundMessages", { recipientUserId: h.ids.alex, eventId: h.ids.event, directReplyToMessageId: h.messageId, idempotencyKey: `job:${h.job.jobId}:0:reply`, content: "For this event, name the task and who should help.", state: "queued", attemptCount: 0 }));
    await h.receive(h.phones.alex, "add a task");
    await h.receive(h.phones.alex, "cancel setup");
    expect(await h.t.mutation(internal.outbox.claim, { outboundMessageId: oldReply })).toBeNull();
    expect(await h.t.run(ctx => ctx.db.get(oldReply))).toMatchObject({ state: "failed", attemptCount: 0 });
  });

  it("preserves a requested status reply when a newer wizard starts", async () => {
    const h = await pendingQuestion();
    const status = JSON.parse(h.decisionJson);
    Object.assign(status, { confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions: [{ type: "REQUEST_STATUS" }] });
    await h.t.run(ctx => ctx.db.patch(h.job.jobId, { executedDecisionJson: JSON.stringify(status) }));
    const reply = await h.t.run(ctx => ctx.db.insert("outboundMessages", { recipientUserId: h.ids.alex, eventId: h.ids.event, directReplyToMessageId: h.messageId, idempotencyKey: `job:${h.job.jobId}:0:reply`, content: "Setup: Maya confirmed", state: "queued", attemptCount: 0 }));
    await h.receive(h.phones.alex, "add a task");
    expect(await h.t.mutation(internal.outbox.claim, { outboundMessageId: reply })).not.toBeNull();
  });

  it("still answers a current model question without a newer setup interaction", async () => {
    const h = await pendingQuestion();
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: h.job.jobId, leaseToken: h.job.leaseToken, decisionJson: h.decisionJson });
    await h.drain();
    expect(h.fake.sends.at(-1)!.content).toContain("name the task");
  });

  it("rejects a model's replacement or cancellation plan for an explicit extra teammate", async () => {
    const h = await harness();
    await h.t.run(async ctx => {
      for (const job of await ctx.db.query("reasoningJobs").collect()) await ctx.db.patch(job._id, { status: "failed" });
      await ctx.db.patch(h.ids.task, { capacity: 2 });
    });
    await h.receive(h.phones.alex, "Can Jordan also join Maya on setup? We need two people.");
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const before = await h.t.run(ctx => ctx.db.query("proposals").collect());
    const decisionJson = JSON.stringify({ schemaVersion: 1, eventCandidateId: h.ids.event, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions: [
      { type: "REPORT_UNAVAILABILITY", participantRef: h.ids.maya, taskRef: h.ids.task },
      { type: "PROPOSE_REASSIGNMENT", taskRef: h.ids.task, fromParticipantRef: h.ids.maya, toParticipantRef: h.ids.jordan },
    ], responseStyle: "concise", reasonCodes: [] });
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson });
    await h.drain();
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    expect(await h.t.run(ctx => ctx.db.query("proposals").collect())).toHaveLength(before.length);
    expect(h.fake.sends.at(-1)!.content).toContain("You asked to add a teammate");
  });

  it("allows adding and accepting a teammate without releasing the first person", async () => {
    const h = await harness();
    await h.t.run(async ctx => {
      for (const job of await ctx.db.query("reasoningJobs").collect()) await ctx.db.patch(job._id, { status: "failed" });
      await ctx.db.patch(h.ids.task, { capacity: 2 });
    });
    await h.receive(h.phones.alex, "Can Jordan also join Maya on setup? We need two people.");
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const decisionJson = JSON.stringify({ schemaVersion: 1, eventCandidateId: h.ids.event, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions: [{ type: "PROPOSE_ASSIGNMENT", taskRef: h.ids.task, toParticipantRef: h.ids.jordan }], responseStyle: "concise", reasonCodes: [] });
    await h.t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson });
    await h.drain(); await h.receive(h.phones.jordan, "YES setup");
    expect((await h.active()).map(c => c.participantId).sort()).toEqual([h.ids.maya, h.ids.jordan].sort());
    expect(await h.t.run(ctx => ctx.db.get(h.ids.task))).toMatchObject({ capacity: 2, status: "confirmed" });
  });
});
