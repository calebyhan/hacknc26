import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { messagingState } from "./lib/validators";

/** Lane A: derive sender from message; STOP cancels pending proposals and sends. */
export const setMessagingState = internalMutation({
  args: { messageId: v.id("inboundMessages"), state: messagingState },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    throw new Error("NOT_IMPLEMENTED(lane-a)");
  },
});
