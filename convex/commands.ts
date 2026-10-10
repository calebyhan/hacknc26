import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Lane A: load persisted verified inbound, then shared parseCommand. Derive the
 * sender from that record; deterministic replies must not require inference.
 */
export const route = internalMutation({
  args: { messageId: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    throw new Error("NOT_IMPLEMENTED(lane-a)");
  },
});
