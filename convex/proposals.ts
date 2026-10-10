import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { proposalState, proposalType } from "./lib/validators";
import type { Infer } from "convex/values";

/** Lane B: resolve originator from trusted evidence, verify role and all versions. */
export const create = internalMutation({
  args: {
    eventId: v.id("events"),
    originatorId: v.id("users"),
    sourceMessageId: v.id("inboundMessages"),
    type: proposalType,
    subjectId: v.optional(v.id("users")),
    targetTaskId: v.optional(v.id("tasks")),
    targetUserId: v.optional(v.id("users")),
    // JSON.parse + shared PROPOSE_TASK_CHANGE member schema before any write.
    taskChangeJson: v.optional(v.string()),
    expectedEventVersion: v.number(),
    expectedTaskVersion: v.optional(v.number()),
    expiresAt: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.id("proposals"),
  handler: async (_ctx, _args): Promise<Id<"proposals">> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});

/** Lane B: actor must match the verified message sender and authorized target. */
export const respond = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    actorId: v.id("users"),
    sourceMessageId: v.id("inboundMessages"),
    response: v.union(v.literal("accept"), v.literal("decline")),
  },
  returns: proposalState,
  handler: async (_ctx, _args): Promise<Infer<typeof proposalState>> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});

/** Lane B: verify source sender's organizer role; approval is not acceptance. */
export const organizerApprove = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    actorId: v.id("users"),
    sourceMessageId: v.id("inboundMessages"),
  },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});

/** Lane B: STOP/LEAVE from verified evidence cancels only the affected scope. */
export const cancelForUser = internalMutation({
  args: {
    userId: v.id("users"),
    eventId: v.optional(v.id("events")),
    sourceMessageId: v.id("inboundMessages"),
    reason: v.union(v.literal("stopped"), v.literal("left")),
  },
  returns: v.array(v.id("proposals")),
  handler: async (_ctx, _args): Promise<Id<"proposals">[]> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});
