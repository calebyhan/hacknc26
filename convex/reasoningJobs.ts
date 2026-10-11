import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { taskVersion } from "./lib/validators";
import { readJobContext } from "./context";
import { AgentDecisionSchema, type AgentDecision } from "../packages/shared/agentDecision";
import { unavailableCopy } from "../packages/shared/copy";

const LEASE_MS = 45_000;
const JOB_TTL_MS = 120_000;
const MAX_ATTEMPTS = 2;
const encoder = new TextEncoder();

function requireWorker(workerToken: string, workerId: string): void {
  const expected = process.env.RALLY_WORKER_TOKEN;
  if (!expected || expected.length < 32 || expected.length > 512 || workerToken.length > 512) throw new Error("WORKER_UNAUTHORIZED");
  let mismatch = workerToken.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ (workerToken.charCodeAt(i) || 0);
  if (mismatch) throw new Error("WORKER_UNAUTHORIZED");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workerId)) throw new Error("INVALID_WORKER_ID");
}

async function tokenFor(job: Doc<"reasoningJobs">, workerId: string, leaseUntil: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(process.env.RALLY_WORKER_TOKEN!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify([job._id, workerId, job.attempts + 1, leaseUntil])));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function failJob(ctx: MutationCtx, job: Doc<"reasoningJobs">, category: string, status: "failed" | "expired" = "failed"): Promise<void> {
  await ctx.db.patch(job._id, { status, failureCategory: category });
  // No model prose is sent. The existing Lane A gate rechecks current consent.
  if (!job.eventId) return;
  const message = await ctx.db.get(job.messageId);
  if (!message) return;
  const user = await ctx.db.query("users").withIndex("by_phone", (q) => q.eq("verifiedPhoneE164", message.senderPhone)).unique();
  if (!user) return;
  try {
    await ctx.runMutation(internal.outbox.enqueue, { idempotencyKey: `reasoning:${job._id}:fallback`, recipientUserId: user._id, eventId: job.eventId, directReplyToMessageId: job.messageId, content: unavailableCopy });
  } catch { /* Opt-out, revoked membership or unavailable route: preserve failure. */ }
}

export const enqueue = internalMutation({
  args: { messageId: v.id("inboundMessages"), eventId: v.union(v.id("events"), v.null()), contextVersion: v.union(v.number(), v.null()), taskVersions: v.array(taskVersion) },
  returns: v.id("reasoningJobs"),
  handler: async (ctx, args): Promise<Id<"reasoningJobs">> => {
    const existing = await ctx.db.query("reasoningJobs").withIndex("by_message", (q) => q.eq("messageId", args.messageId)).unique();
    if (existing) {
      if (existing.eventId !== args.eventId || existing.contextVersion !== args.contextVersion || JSON.stringify(existing.taskVersions) !== JSON.stringify(args.taskVersions)) throw new Error("JOB_IDEMPOTENCY_CONFLICT");
      return existing._id;
    }
    await readJobContext(ctx, args);
    const jobId = await ctx.db.insert("reasoningJobs", { ...args, status: "queued", attempts: 0 });
    await ctx.scheduler.runAfter(JOB_TTL_MS, internal.reasoningJobs.expire, { jobId });
    return jobId;
  },
});

const claimedJob = v.union(v.null(), v.object({ jobId: v.id("reasoningJobs"), leaseToken: v.string(), leaseUntil: v.number(), contextVersion: v.union(v.number(), v.null()), taskVersions: v.array(taskVersion), packetJson: v.string() }));

export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string() }, returns: claimedJob,
  handler: async (ctx, args): Promise<Infer<typeof claimedJob>> => {
    requireWorker(args.workerToken, args.workerId);
    const queued = await ctx.db.query("reasoningJobs").withIndex("by_status", (q) => q.eq("status", "queued")).order("asc").take(20);
    const claimed = await ctx.db.query("reasoningJobs").withIndex("by_status", (q) => q.eq("status", "claimed")).order("asc").take(20);
    if (claimed.some((job) => job.leaseOwner === args.workerId && (job.leaseUntil ?? 0) > Date.now())) return null;
    const candidates = [...queued, ...claimed.filter((job) => (job.leaseUntil ?? 0) <= Date.now())].sort((a, b) => a._creationTime - b._creationTime);
    for (const job of candidates) {
      if (Date.now() >= job._creationTime + JOB_TTL_MS || job.attempts >= MAX_ATTEMPTS) { await failJob(ctx, job, "WORKER_TIMEOUT", "expired"); continue; }
      let packetJson: string;
      try { packetJson = JSON.stringify((await readJobContext(ctx, job)).packet); }
      catch { await failJob(ctx, job, "CONTEXT_NOT_AVAILABLE"); continue; }
      const leaseUntil = Math.min(Date.now() + LEASE_MS, job._creationTime + JOB_TTL_MS);
      const leaseToken = await tokenFor(job, args.workerId, leaseUntil);
      await ctx.db.patch(job._id, { status: "claimed", leaseOwner: args.workerId, leaseToken, leaseUntil, attempts: job.attempts + 1 });
      await ctx.scheduler.runAfter(leaseUntil - Date.now(), internal.reasoningJobs.expire, { jobId: job._id });
      return { jobId: job._id, leaseToken, leaseUntil, contextVersion: job.contextVersion, taskVersions: job.taskVersions, packetJson };
    }
    return null;
  },
});

function permitted(decision: AgentDecision, job: Doc<"reasoningJobs">, user: Doc<"users">, role: "organizer" | "member"): boolean {
  if (decision.eventCandidateId !== job.eventId) return false;
  if (decision.confidenceClass === "unsupported" && decision.actions.some((action) => action.type !== "NO_ACTION")) return false;
  const self = new Set(["self", "me", user._id.toLowerCase()]);
  return decision.actions.every((action) => {
    if (job.eventId === null) return ["CREATE_EVENT_DRAFT", "ASK_CLARIFICATION", "NO_ACTION"].includes(action.type);
    if (["CREATE_EVENT_DRAFT", "ADD_INVITEE_DRAFT", "PROPOSE_TASK_CHANGE"].includes(action.type) && role !== "organizer") return false;
    return action.type !== "REPORT_UNAVAILABILITY" || role === "organizer" || self.has(action.participantRef.toLowerCase());
  });
}

export const complete = mutation({
  args: { workerToken: v.string(), workerId: v.string(), jobId: v.id("reasoningJobs"), leaseToken: v.string(), decisionJson: v.string() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    requireWorker(args.workerToken, args.workerId);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseOwner !== args.workerId || job.leaseToken !== args.leaseToken) throw new Error("LEASE_REJECTED");
    let decision: AgentDecision;
    try {
      if (args.decisionJson.length > 32_000) throw new Error("DECISION_TOO_LARGE");
      decision = AgentDecisionSchema.parse(JSON.parse(args.decisionJson));
    } catch {
      if (job.status === "claimed" && (job.leaseUntil ?? 0) > Date.now()) { await failJob(ctx, job, "INVALID_DECISION"); return null; }
      throw new Error("LEASE_REJECTED");
    }
    const canonical = JSON.stringify(decision);
    if (job.status === "completed" && job.result === canonical) return null;
    if (job.status !== "claimed" || (job.leaseUntil ?? 0) <= Date.now() || Date.now() >= job._creationTime + JOB_TTL_MS) throw new Error("LEASE_REJECTED");
    let context: Awaited<ReturnType<typeof readJobContext>>;
    try { context = await readJobContext(ctx, job); }
    catch { await failJob(ctx, job, "CONTEXT_NOT_AVAILABLE"); return null; }
    if (!permitted(decision, job, context.user, context.packet.sender.role)) { await failJob(ctx, job, "DECISION_NOT_PERMITTED"); return null; }
    try {
      // Resolve first-person references using verified storage, never a model's
      // assertion about identity. Retain raw canonical output for retry binding.
      const normalized = { ...decision, actions: decision.actions.map(action => action.type === "REPORT_UNAVAILABILITY" && ["self", "me"].includes(action.participantRef.toLowerCase()) ? { ...action, participantRef: context.user._id } : action) };
      await ctx.runMutation(internal.domain.executeDecision, { jobId: job._id, decisionJson: JSON.stringify(normalized) });
    } catch { await failJob(ctx, job, "DOMAIN_UNAVAILABLE"); return null; }
    await ctx.db.patch(job._id, { status: "completed", result: canonical });
    return null;
  },
});

/** Durable deadline runs even when every local worker is stopped. */
export const expire = internalMutation({
  args: { jobId: v.id("reasoningJobs") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !["queued", "claimed"].includes(job.status)) return null;
    if (Date.now() >= job._creationTime + JOB_TTL_MS || (job.status === "claimed" && (job.leaseUntil ?? 0) <= Date.now() && job.attempts >= MAX_ATTEMPTS)) await failJob(ctx, job, "WORKER_TIMEOUT", "expired");
    else if (job.status === "claimed" && (job.leaseUntil ?? 0) <= Date.now()) await ctx.db.patch(job._id, { status: "queued" });
    return null;
  },
});

const errorCategories = new Set(["INFERENCE_TIMEOUT", "INFERENCE_UNAVAILABLE", "INVALID_DECISION", "RATE_LIMIT", "BACKEND_UNAVAILABLE", "WORKER_ERROR"]);
export const heartbeat = mutation({
  args: { workerToken: v.string(), workerId: v.string(), modelId: v.optional(v.string()), lastError: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    requireWorker(args.workerToken, args.workerId);
    const existing = await ctx.db.query("workerHeartbeats").withIndex("by_worker", (q) => q.eq("workerId", args.workerId)).unique();
    const modelId = args.modelId && /^[a-zA-Z0-9_.:-]{1,128}$/.test(args.modelId) ? args.modelId : undefined;
    const lastError = args.lastError ? errorCategories.has(args.lastError) ? args.lastError : "WORKER_ERROR" : undefined;
    const values = { workerId: args.workerId, lastHeartbeatAt: Date.now(), modelId, lastError };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("workerHeartbeats", { workerId: values.workerId, lastHeartbeatAt: values.lastHeartbeatAt, ...(modelId ? { modelId } : {}), ...(lastError ? { lastError } : {}) });
    return null;
  },
});
