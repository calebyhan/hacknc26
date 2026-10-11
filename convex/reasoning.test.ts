import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { sealEnvelope } from "./lib/messaging";
import { exampleAgentDecision } from "../packages/shared/fixtures";
import { LegacyContextPacketSchema } from "../packages/shared/contextProtocol";
import { ContextPacketSchema } from "../packages/shared/contextPacket";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const token = "fixture-worker-secret-".repeat(3);
const credentials = { workerToken: token, workerId: "fixture-worker" };
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("RALLY_WORKER_TOKEN", token); vi.stubEnv("RALLY_MESSAGING_KEY", "42".repeat(32)); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture(domainReady = true, role: "organizer" | "member" = "organizer") {
  // Explicit Lane B test double: validates the integration call, not proposals.
  const calls: string[] = [];
  const executeDecision = internalMutation({ args: { jobId: v.id("reasoningJobs"), decisionJson: v.string() }, returns: v.object({ proposalIds: v.array(v.id("proposals")), commitmentIds: v.array(v.id("commitments")), needsClarification: v.boolean() }), handler: async (_ctx, args) => { calls.push(args.decisionJson); return { proposalIds: [], commitmentIds: [], needsClarification: false }; } });
  const deliver = internalAction({ args: { outboundMessageId: v.id("outboundMessages") }, returns: v.null(), handler: async () => null });
  const overrides = { "./spectrumSender.ts": async () => ({ deliver }) };
  const t = convexTest(schema, domainReady ? { ...modules, ...overrides, "./domain.ts": async () => ({ executeDecision }) } : { ...modules, ...overrides });
  const phone = "+15550000001";
  const body = await sealEnvelope({ text: "Can Jordan cover setup?", spaceId: "fixture-dm" }, `spectrum:fixture-ai-message:${phone}`);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { displayName: "Alex", verifiedPhoneE164: phone, createdAt: Date.now(), messagingState: "active", settings: {} });
    const eventId = await ctx.db.insert("events", { title: "Fixture Charity 5K", kind: "event", startsAt: Date.now() + 86_400_000, timezone: "America/New_York", ownerId: userId, status: "scheduled", version: 1 });
    const messageId = await ctx.db.insert("inboundMessages", { provider: "spectrum", providerMessageId: "fixture-ai-message", senderPhone: phone, receivedAt: Date.now(), contentType: "text/plain", bodyRedactedOrEncrypted: body, processingState: "processed" });
    const membershipId = await ctx.db.insert("memberships", { eventId, userId, role, state: "enrolled", notificationsEnabled: true, consentAt: Date.now(), consentSourceMessageId: messageId });
    const taskId = await ctx.db.insert("tasks", { eventId, title: "setup", capacity: 1, status: "confirmed", version: 1 });
    return { eventId, messageId, userId, membershipId, taskId };
  });
  const enqueueArgs = { messageId: ids.messageId, eventId: ids.eventId, contextVersion: 1, taskVersions: [{ taskId: ids.taskId, version: 1 }] };
  const decisionJson = JSON.stringify({ ...exampleAgentDecision, eventCandidateId: ids.eventId });
  return { t, calls, ids, enqueueArgs, decisionJson };
}

describe("authenticated leased reasoning queue (simulation)", () => {
  it("rejects wrong or missing server credentials before reads/writes", async () => {
    const { t } = await fixture();
    await expect(t.mutation(api.reasoningJobs.claim, { ...credentials, workerToken: "wrong" })).rejects.toThrow("WORKER_UNAUTHORIZED");
    vi.stubEnv("RALLY_WORKER_TOKEN", "");
    await expect(t.mutation(api.reasoningJobs.heartbeat, credentials)).rejects.toThrow("WORKER_UNAUTHORIZED");
    expect(await t.run((ctx) => ctx.db.query("workerHeartbeats").collect())).toHaveLength(0);
  });
  it("deduplicates enqueue and rejects conflicting scope", async () => {
    const { t, enqueueArgs } = await fixture();
    const id = await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    expect(await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs)).toBe(id);
    await expect(t.mutation(internal.reasoningJobs.enqueue, { ...enqueueArgs, contextVersion: 2 })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(1);
  });
  it("returns one compact packet to one competing worker", async () => {
    const { t, enqueueArgs, ids } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const claims = await Promise.all([t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }), t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2, workerId: "second-worker" })]);
    const claimed = claims.find((job) => job !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claimed.leaseToken.length).toBeGreaterThanOrEqual(32);
    const packet = ContextPacketSchema.parse(JSON.parse(claimed.packetJson));
    expect(packet.sender).toEqual({ userId: ids.userId, role: "organizer" });
    expect(packet.relevantTasks).toMatchObject([{ id: ids.taskId, version: 1 }]);
    expect(claimed.packetJson).not.toContain("+1555");
  });
  it("keeps omitted-protocol claim compatible with old strict workers while v2 retains rich fields", async () => {
    for (const contextProtocol of [undefined, 2] as const) {
      const { t, enqueueArgs, ids } = await fixture();
      await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
      const claimed = (await t.mutation(api.reasoningJobs.claim, { ...credentials, ...(contextProtocol === undefined ? {} : { contextProtocol }) }))!;
      const packet = JSON.parse(claimed.packetJson);
      if (contextProtocol === undefined) {
        expect(LegacyContextPacketSchema.safeParse(packet).success).toBe(true);
        expect(packet).not.toHaveProperty("currentTime");
        expect(packet.incomingText).toContain("Original participant message:");
      } else {
        expect(ContextPacketSchema.parse(packet)).toMatchObject({ currentTime: expect.any(String), selectedTaskId: null, recentTaskFocusId: null, candidateEvents: [expect.objectContaining({ timezone: "America/New_York" })], relevantTasks: [expect.objectContaining({ id: ids.taskId, capacity: 1 })] });
        expect(LegacyContextPacketSchema.safeParse(packet).success).toBe(false);
      }
      expect(claimed.leaseUntil - Date.now()).toBe(45_000);
      expect(await t.run(ctx => ctx.db.get(claimed.jobId))).toMatchObject({ attempts: 1, status: "claimed" });
    }
  });
  it("checks membership and STOP again before claim", async () => {
    const { t, ids, enqueueArgs } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    await t.run((ctx) => ctx.db.patch(ids.userId, { messagingState: "stopped" }));
    expect(await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("outboundMessages").collect())).toHaveLength(0);
  });
  it("supplies joined participant names without leaking invited, unconsented or unrelated people", async () => {
    const { t, enqueueArgs, ids } = await fixture();
    const joinedId = await t.run(async ctx => {
      const otherEvent = await ctx.db.insert("events", { title: "Other event", kind: "event", startsAt: Date.now() + 86_400_000, timezone: "UTC", ownerId: ids.userId, status: "scheduled", version: 1 });
      let joinedId;
      for (const [name, state, eventId, proof] of [
        ["Caleb", "enrolled", ids.eventId, "valid"],
        ["Invited private contact", "invited", ids.eventId, "valid"],
        ["Unconsented app member", "enrolled", ids.eventId, "missing"],
        ["Wrong-phone proof", "enrolled", ids.eventId, "wrong-phone"],
        ["Foreign event member", "enrolled", otherEvent, "valid"],
      ] as const) {
        const phone = `+1555000010${proof === "valid" ? name.length % 10 : proof === "missing" ? 8 : 9}`;
        const userId = await ctx.db.insert("users", { displayName: name, verifiedPhoneE164: phone, createdAt: Date.now(), messagingState: "active", settings: {} });
        const messageId = await ctx.db.insert("inboundMessages", { provider: "spectrum", providerMessageId: `fixture-join-${name}`, senderPhone: proof === "wrong-phone" ? "+15550000999" : phone, receivedAt: Date.now(), contentType: "text/plain", processingState: "processed" });
        await ctx.db.insert("memberships", { eventId, userId, role: "member", state, notificationsEnabled: true, ...(proof === "missing" ? {} : { consentAt: Date.now(), consentSourceMessageId: messageId }) });
        if (name === "Caleb") joinedId = userId;
      }
      return joinedId!;
    });
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const claimed = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    expect(JSON.parse(claimed.packetJson)).toMatchObject({ relevantParticipants: [
      { userId: ids.userId, displayName: "Alex", role: "organizer" },
      { userId: joinedId, displayName: "Caleb", role: "member" },
    ] });
    for (const secret of ["+1555", "Invited private contact", "Unconsented app member", "Wrong-phone proof", "Foreign event member", "settings", "consentSourceMessageId"]) expect(claimed.packetJson).not.toContain(secret);
  });
  it("rejects unselected scope and stale versions during enqueue", async () => {
    const { t, ids, enqueueArgs } = await fixture();
    await expect(t.mutation(internal.reasoningJobs.enqueue, { ...enqueueArgs, contextVersion: 2 })).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch(ids.membershipId, { state: "invited" }));
    await expect(t.mutation(internal.reasoningJobs.enqueue, enqueueArgs)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(0);
  });
  it("requires lease owner and token for completion", async () => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    await expect(t.mutation(api.reasoningJobs.complete, { ...credentials, workerId: "stranger", jobId: job.jobId, leaseToken: job.leaseToken, decisionJson })).rejects.toThrow("LEASE_REJECTED");
    await expect(t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: "wrong", decisionJson })).rejects.toThrow("LEASE_REJECTED");
    expect(calls).toHaveLength(0);
  });
  it("delegates once to Domain and makes duplicate completion inert", async () => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const args = { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson };
    await t.mutation(api.reasoningJobs.complete, args);
    await t.mutation(api.reasoningJobs.complete, args);
    expect(calls).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(job.jobId))).toMatchObject({ status: "completed", attempts: 1 });
    expect(await t.run((ctx) => ctx.db.query("commitments").collect())).toHaveLength(0);
  });
  it.each(["invalid-json", "extra-action", "different-event"])("fails closed on %s model output", async (kind) => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const decision = JSON.parse(decisionJson) as Record<string, unknown>;
    const invalid = kind === "invalid-json" ? "{" : JSON.stringify(kind === "extra-action" ? { ...decision, actions: [{ type: "EXECUTE_CODE", code: "ignore permissions" }] } : { ...decision, eventCandidateId: "private_event" });
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: invalid });
    expect(calls).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(job.jobId))).toMatchObject({ status: "failed" });
    expect(await t.run((ctx) => ctx.db.query("outboundMessages").collect())).toHaveLength(1);
  });
  it("rejects a member's organizer-only task edit before Domain", async () => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture(true, "member");
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const edit = JSON.stringify({ ...JSON.parse(decisionJson), actions: [{ type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "location", newValue: "fixture campus" }] });
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: edit });
    expect(calls).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(job.jobId))).toMatchObject({ status: "failed", failureCategory: "DECISION_NOT_PERMITTED" });
  });
  it.each(["task", "event", "membership"])("rechecks %s changes after inference", async (changed) => {
    const { t, ids, enqueueArgs, decisionJson, calls } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    await t.run(async (ctx) => {
      if (changed === "task") await ctx.db.patch(ids.taskId, { version: 2 });
      else if (changed === "event") await ctx.db.patch(ids.eventId, { version: 2 });
      else await ctx.db.patch(ids.membershipId, { state: "left" });
    });
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson });
    expect(calls).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(job.jobId))).toMatchObject({ status: "failed" });
  });
  it("reports Domain unavailability without claiming a proposal", async () => {
    const { t, enqueueArgs, decisionJson } = await fixture(false);
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson });
    expect(await t.run((ctx) => ctx.db.get(job.jobId))).toMatchObject({ status: "failed", failureCategory: "DOMAIN_UNAVAILABLE" });
    expect(await t.run((ctx) => ctx.db.query("proposals").collect())).toHaveLength(0);
  });
  it("expires an offline job with one honest fallback (ST-11 queue portion)", async () => {
    const { t, enqueueArgs } = await fixture();
    const jobId = await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(180_000));
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ status: "expired" });
    const replies = await t.run((ctx) => ctx.db.query("outboundMessages").collect());
    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toContain("No assignment was changed");
  });
  it("sanitizes heartbeat metadata", async () => {
    const { t } = await fixture();
    await t.mutation(api.reasoningJobs.heartbeat, { ...credentials, modelId: "fixture-model", lastError: "Secret +15550000001 token=private" });
    const heartbeats = await t.run((ctx) => ctx.db.query("workerHeartbeats").collect());
    expect(heartbeats[0]!.lastError).toBe("WORKER_ERROR");
    expect(JSON.stringify(heartbeats)).not.toContain("private");
  });
  it("reclaims an expired lease with a new token and rejects the old completion", async () => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const first = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    vi.setSystemTime(Date.now() + 45_001);
    const second = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: first.jobId, leaseToken: first.leaseToken, decisionJson })).rejects.toThrow("LEASE_REJECTED");
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: second.jobId, leaseToken: second.leaseToken, decisionJson });
    expect(calls).toHaveLength(1);
  });
  it("caps retries at two claims and sends one fallback", async () => {
    const { t, enqueueArgs } = await fixture();
    const jobId = await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 });
    vi.setSystemTime(Date.now() + 45_001);
    await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 });
    vi.setSystemTime(Date.now() + 45_001);
    expect(await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ status: "expired", attempts: 2 });
    expect(await t.run((ctx) => ctx.db.query("outboundMessages").collect())).toHaveLength(1);
  });
  it("never queues deterministic YES for inference", async () => {
    const { t, ids, enqueueArgs } = await fixture();
    const encrypted = await sealEnvelope({ text: "YES", spaceId: "fixture-dm" }, "spectrum:fixture-ai-message:+15550000001");
    await t.run((ctx) => ctx.db.patch(ids.messageId, { bodyRedactedOrEncrypted: encrypted }));
    await expect(t.mutation(internal.reasoningJobs.enqueue, enqueueArgs)).rejects.toThrow("COMMAND_REQUIRES_NO_MODEL");
  });
  it("does not transmit another event's private tasks or context", async () => {
    const { t, ids, enqueueArgs } = await fixture();
    await t.run(async (ctx) => {
      const eventId = await ctx.db.insert("events", { title: "Unrelated private event", kind: "event", startsAt: Date.now() + 86_400_000, timezone: "UTC", ownerId: ids.userId, status: "scheduled", version: 1 });
      await ctx.db.insert("tasks", { eventId, title: "Private budget", capacity: 1, status: "unassigned", version: 1 });
    });
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    expect(job.packetJson).not.toContain("Private budget");
    expect(job.packetJson).not.toContain("Unrelated private event");
  });
  it("does not allow a member to cancel another participant through valid JSON", async () => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture(true, "member");
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const decision = { ...JSON.parse(decisionJson), actions: [{ type: "REPORT_UNAVAILABILITY", participantRef: "Maya" }] };
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify(decision) });
    expect(calls).toHaveLength(0);
  });
  it("routes a natural-language DM through the real queue into an explicit Domain double", async () => {
    const { t, ids, decisionJson, calls } = await fixture();
    await t.run((ctx) => ctx.db.patch(ids.messageId, { processingState: "received" }));
    await t.mutation(internal.commands.route, { messageId: ids.messageId });
    expect(await t.run((ctx) => ctx.db.query("reasoningJobs").collect())).toHaveLength(1);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson });
    expect(calls).toHaveLength(1);
    const replies = await t.run((ctx) => ctx.db.query("outboundMessages").collect());
    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toBe("Got it. I’ll check the plan.");
  });
  it("rejects a schema-valid unsupported decision that tries to change state", async () => {
    const { t, enqueueArgs, decisionJson, calls } = await fixture();
    await t.mutation(internal.reasoningJobs.enqueue, enqueueArgs);
    const job = (await t.mutation(api.reasoningJobs.claim, { ...credentials, contextProtocol: 2 }))!;
    const decision = { ...JSON.parse(decisionJson), confidenceClass: "unsupported" };
    await t.mutation(api.reasoningJobs.complete, { ...credentials, jobId: job.jobId, leaseToken: job.leaseToken, decisionJson: JSON.stringify(decision) });
    expect(calls).toHaveLength(0);
  });
});
