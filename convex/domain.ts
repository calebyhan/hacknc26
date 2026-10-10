import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { statusSummary } from "./lib/validators";
import { detailFor } from "./lib/domain";
import { executeDecision as execute } from "./lib/decisionEngine";

/** Lane B: trusted caller's user ID still requires per-event enrollment checks. */
export const statusFor = internalQuery({
  args: { userId: v.id("users"), eventId: v.optional(v.id("events")) },
  returns: statusSummary,
  handler: async (ctx, args): Promise<Infer<typeof statusSummary>> => {
    if (!await ctx.db.get(args.userId)) throw new Error("UNAUTHORIZED");
    const memberships = (await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", args.userId)).collect()).filter(m => m.state === "enrolled");
    if (args.eventId && !memberships.some(m => m.eventId === args.eventId)) throw new Error("UNAUTHORIZED");
    return { events: await Promise.all(memberships.filter(m => !args.eventId || m.eventId === args.eventId).map(m => detailFor(ctx, args.userId, m.eventId))) };
  },
});

const decisionResult = v.object({
  proposalIds: v.array(v.id("proposals")),
  commitmentIds: v.array(v.id("commitments")),
  needsClarification: v.boolean(),
});

/**
 * Lane B: JSON.parse + shared AgentDecisionSchema.parse before ANY side effect.
 * Load trusted source identity, event/contextVersion and taskVersions from job;
 * revalidate membership, permissions and current versions inside this mutation.
 * If job.eventId is null, allow only CREATE_EVENT_DRAFT/ASK_CLARIFICATION/NO_ACTION;
 * require null contextVersion and no taskVersions. A worker suggestion cannot
 * acquire existing-event scope that the trusted job did not authorize.
 * Model refs and worker claims are never authority or evidence of acceptance.
 */
export const executeDecision = internalMutation({
  args: { jobId: v.id("reasoningJobs"), decisionJson: v.string() },
  returns: decisionResult,
  handler: async (ctx, args): Promise<Infer<typeof decisionResult>> => {
    return execute(ctx, args.jobId, args.decisionJson);
  },
});
