import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/**
 * Lane A: single consent/idempotency gate; compose content from structured state.
 * A directReplyToMessageId is verified as this recipient's own inbound message,
 * not a caller-controlled bypass for STOP, membership or outreach permission.
 */
export const enqueue = internalMutation({
  args: {
    idempotencyKey: v.string(),
    recipientUserId: v.id("users"),
    eventId: v.optional(v.id("events")),
    proposalId: v.optional(v.id("proposals")),
    content: v.string(),
    directReplyToMessageId: v.optional(v.id("inboundMessages")),
  },
  returns: v.id("outboundMessages"),
  handler: async (_ctx, _args): Promise<Id<"outboundMessages">> => {
    throw new Error("NOT_IMPLEMENTED(lane-a)");
  },
});
