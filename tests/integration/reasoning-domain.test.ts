import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./harness";
import { api } from "../../convex/_generated/api";
import type { AgentAction } from "../../packages/shared/agentDecision";

const credentials = { workerToken: "fixture-ai-worker-token-".repeat(3), workerId: "fixture-worker" };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32));
  vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", "integration-webhook-secret");
  vi.stubEnv("RALLY_WORKER_TOKEN", credentials.workerToken);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("signed DM -> leased worker decision -> actual Domain (simulated provider/model)", () => {
  async function request(h: Awaited<ReturnType<typeof harness>>, text: string, actions: AgentAction[], phone = h.phones.alex) {
    // Dispose of older manual-setup requests whose task snapshots are stale.
    await h.receive(phone, text);
    const job = (await h.t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    expect(job).not.toBeNull();
    const args = { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify({ schemaVersion: 1, eventCandidateId: h.ids.event, confidenceClass: "clear", needsClarification: false, clarificationQuestion: null, actions, responseStyle: "concise", reasonCodes: [] }) };
    await h.t.mutation(api.reasoningJobs.complete, args); await h.drain();
    return { job, args };
  }
  it("creates one pending offer, commits only on target YES, and ignores duplicate worker completion", async () => {
    const h = await harness();
    const { job, args } = await request(h, "Can Jordan cover setup?", [{ type: "PROPOSE_REASSIGNMENT", taskRef: h.ids.task, fromParticipantRef: h.ids.maya, toParticipantRef: h.ids.jordan }]);
    expect(JSON.parse(job.packetJson)).toMatchObject({ relevantParticipants: expect.arrayContaining([{ userId: h.ids.jordan, displayName: "Jordan", role: "member" }]) });
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
    const offers = await h.t.run(ctx => ctx.db.query("proposals").collect());
    const pending = offers.filter(p => p.state === "pending"); expect(pending).toHaveLength(1);
    const sendCount = h.fake.sends.length;
    await h.t.mutation(api.reasoningJobs.complete, args); await h.drain();
    expect(h.fake.sends).toHaveLength(sendCount);
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
  });
  it("member suggestion waits for organizer approval before contacting the target", async () => {
    const h = await harness();
    const { job } = await request(h, "Can Jordan cover setup?", [{ type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" }], h.phones.sam);
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    const pending = (await h.t.run(ctx => ctx.db.query("proposals").collect())).filter(p => p.state === "pending");
    expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({ requiresOrganizerApproval: true });
    expect(h.fake.sends.filter(r => r.proposalId === pending[0]!._id && r.recipientUserId === h.ids.jordan)).toHaveLength(0);
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it("maps self unavailability to the verified sender and cancels only their commitment", async () => {
    const h = await harness();
    const { job } = await request(h, "I can't do setup", [{ type: "REPORT_UNAVAILABILITY", participantRef: "self", taskRef: "setup" }], h.phones.maya);
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    expect(await h.active()).toHaveLength(0);
    expect(await h.t.run(ctx => ctx.db.get(h.ids.task))).toMatchObject({ status: "needs_coverage" });
    expect((await h.t.run(ctx => ctx.db.query("commitments").collect())).filter(c => c.participantId === h.ids.maya)).toMatchObject([{ state: "canceled_by_participant" }]);
  });
  it("rolls back an earlier valid action and scheduled notices if a later reference is invalid", async () => {
    const h = await harness();
    const { job } = await request(h, "Can Jordan cover setup? Taylor can't make it", [
      { type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" },
      { type: "REPORT_UNAVAILABILITY", participantRef: "Taylor" },
    ]);
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "failed" });
    expect((await h.t.run(ctx => ctx.db.query("proposals").collect())).filter(p => p.state === "pending")).toHaveLength(0);
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
  it("organizer reports cancellation, then offers coverage without inventing target acceptance", async () => {
    const h = await harness();
    const { job } = await request(h, "Maya can't do setup. Could Jordan cover it?", [
      { type: "REPORT_UNAVAILABILITY", participantRef: "Maya", taskRef: "setup" },
      { type: "PROPOSE_ASSIGNMENT", taskRef: "setup", toParticipantRef: "Jordan" },
    ]);
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    expect(await h.active()).toHaveLength(0);
    const pending = (await h.t.run(ctx => ctx.db.query("proposals").collect())).filter(p => p.state === "pending");
    expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({ type: "assignment", targetUserId: h.ids.jordan });
    expect((await h.t.run(ctx => ctx.db.query("commitments").collect())).find(c => c.participantId === h.ids.maya)).toMatchObject({ state: "released" });
    await h.receive(h.phones.jordan, "YES");
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.jordan]);
  });
  it("records both a self-volunteer and availability from one verified compound statement exactly once", async () => {
    const h = await harness();
    const start = Date.now() + 86400000, end = start + 3600000;
    const speakers = await h.app.mutation(api.tasks.create, { eventId: h.ids.event, title: "speakers", windowStart: start, windowEnd: end, expectedEventVersion: 2, idempotencyKey: "speakers" });
    const { job, args } = await request(h, "I can bring speakers and I'm available tomorrow from 13:00 to 14:00 UTC", [
      { type: "RECORD_SELF_COMMITMENT", taskRef: "speakers" },
      { type: "RECORD_AVAILABILITY", kind: "available", window: { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() } },
    ], h.phones.sam);
    expect(await h.t.run(ctx => ctx.db.get(job.jobId))).toMatchObject({ status: "completed" });
    await h.t.mutation(api.reasoningJobs.complete, args); await h.drain();
    expect(await h.t.run(ctx => ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", speakers)).collect())).toMatchObject([{ participantId: h.ids.sam, state: "active" }]);
    expect(await h.t.run(ctx => ctx.db.query("availability").withIndex("by_event_user", q => q.eq("eventId", h.ids.event).eq("userId", h.ids.sam)).collect())).toMatchObject([{ kind: "available", windowStart: start, windowEnd: end, reportedByUserId: h.ids.sam }]);
    expect((await h.active()).map(c => c.participantId)).toEqual([h.ids.maya]);
  });
});
