import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { messagingState } from "./lib/validators";
import { internal } from "./_generated/api";
import { openEnvelope, senderFor } from "./lib/messaging";
import { parseCommand } from "../packages/shared/commands";

/** Lane A: derive sender from message; STOP cancels pending proposals and sends. */
export const setMessagingState = internalMutation({
  args: { messageId: v.id("inboundMessages"), state: messagingState },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("INBOUND_NOT_FOUND");
    const command = parseCommand((await openEnvelope(message)).text);
    const expected = command.type === "STOP" ? "stopped" : command.type === "PAUSE" ? "paused" : command.type === "RESUME" ? "active" : undefined;
    if (args.state !== expected) throw new Error("INVALID_PREFERENCE_EVIDENCE");
    const user = await senderFor(ctx, message);
    if (!user) return null;
    await ctx.db.patch(user._id, { messagingState: args.state, messagingStateAt: Date.now() });
    if (args.state !== "active") {
      const queued = await ctx.db.query("outboundMessages").withIndex("by_state", (q) => q.eq("state", "queued")).collect();
      for (const row of queued) if (row.recipientUserId === user._id) await ctx.db.patch(row._id, { state: "failed" });
    }
    if (args.state === "stopped") {
      // Domain cancellation shares this transaction. RESUME cannot race a later
      // job and revive an offer that was pending when STOP was received.
      await ctx.runMutation(internal.proposals.cancelForUser, { userId: user._id, sourceMessageId: message._id, reason: "stopped" });
    }
    return null;
  },
});
