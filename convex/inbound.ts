import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation } from "./_generated/server";

const result = v.object({ messageId: v.id("inboundMessages"), duplicate: v.boolean() });

/** Lane A: accept only verified provider transport metadata; persist/dedupe first. */
export const ingest = internalMutation({
  args: {
    provider: v.string(),
    providerMessageId: v.string(),
    senderPhone: v.string(),
    receivedAt: v.number(),
    contentType: v.string(),
    bodyRedactedOrEncrypted: v.optional(v.string()),
  },
  returns: result,
  handler: async (_ctx, _args): Promise<Infer<typeof result>> => {
    throw new Error("NOT_IMPLEMENTED(lane-a)");
  },
});
