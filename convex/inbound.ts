import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { PhoneE164Schema } from "../packages/shared/primitives";

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
  handler: async (ctx, args): Promise<Infer<typeof result>> => {
    PhoneE164Schema.parse(args.senderPhone);
    if (!args.provider || !args.providerMessageId || !Number.isFinite(args.receivedAt)) throw new Error("INVALID_INBOUND_METADATA");
    const prior = await ctx.db.query("inboundMessages").withIndex("by_provider_message_id", (q) => q.eq("provider", args.provider).eq("providerMessageId", args.providerMessageId)).unique();
    if (prior) return { messageId: prior._id, duplicate: true };
    const messageId = await ctx.db.insert("inboundMessages", { ...args, processingState: "received" });
    await ctx.scheduler.runAfter(0, internal.commands.route, { messageId });
    return { messageId, duplicate: false };
  },
});
