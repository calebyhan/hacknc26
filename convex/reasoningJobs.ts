import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import { taskVersion } from "./lib/validators";

/**
 * Lane C: verify scoped event/task versions atomically, freeze them with the job.
 * Unscoped jobs use eventId/contextVersion=null and taskVersions=[]; this permits
 * first drafts and clarification without granting access to existing events.
 */
export const enqueue = internalMutation({
  args: {
    messageId: v.id("inboundMessages"),
    eventId: v.union(v.id("events"), v.null()),
    contextVersion: v.union(v.number(), v.null()),
    taskVersions: v.array(taskVersion),
  },
  returns: v.id("reasoningJobs"),
  handler: async (_ctx, _args): Promise<Id<"reasoningJobs">> => {
    throw new Error("NOT_IMPLEMENTED(lane-c)");
  },
});

const claimedJob = v.union(v.null(), v.object({
  jobId: v.id("reasoningJobs"),
  leaseToken: v.string(),
  leaseUntil: v.number(),
  contextVersion: v.union(v.number(), v.null()),
  taskVersions: v.array(taskVersion),
  packetJson: v.string(),
}));

/**
 * Lane C: server-verify RALLY_WORKER_TOKEN before any read/write, then scope the
 * job to its verified sender's current membership. Fresh unguessable leaseToken
 * per claim; workerId alone is not authorization. packetJson must pass the shared
 * ContextPacketSchema before returning. This stub rejects every credential.
 */
export const claim = mutation({
  args: { workerToken: v.string(), workerId: v.string() },
  returns: claimedJob,
  handler: async (_ctx, _args): Promise<Infer<typeof claimedJob>> => {
    throw new Error("NOT_IMPLEMENTED(lane-c)");
  },
});

/**
 * Lane C: verify worker credential, lease owner/token/expiry; parse decisionJson
 * with shared AgentDecisionSchema. Domain rechecks persisted context/task versions
 * and permissions atomically. Worker output cannot create a confirmed acceptance.
 */
export const complete = mutation({
  args: {
    workerToken: v.string(),
    workerId: v.string(),
    jobId: v.id("reasoningJobs"),
    leaseToken: v.string(),
    decisionJson: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    throw new Error("NOT_IMPLEMENTED(lane-c)");
  },
});

/** Lane C: verify server-side worker secret; sanitize error metadata, never log tokens. */
export const heartbeat = mutation({
  args: {
    workerToken: v.string(),
    workerId: v.string(),
    modelId: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    throw new Error("NOT_IMPLEMENTED(lane-c)");
  },
});
