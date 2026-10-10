import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalQuery } from "./_generated/server";

const result = v.object({ packetJson: v.string() });

/**
 * Lane C: derive verified sender and authorized scope from job/message. Serialize
 * only a minimal packet validated with shared ContextPacketSchema; never include
 * other events' private messages, phone numbers or entire contact selections.
 */
export const buildPacket = internalQuery({
  args: { jobId: v.id("reasoningJobs") },
  returns: result,
  handler: async (_ctx, _args): Promise<Infer<typeof result>> => {
    throw new Error("NOT_IMPLEMENTED(lane-c)");
  },
});
