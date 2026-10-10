import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** P1 Lane C: external signal only; never writes event times or commitments. */
export const check = internalAction({
  args: { eventId: v.id("events") },
  returns: v.null(),
  handler: async (_ctx, _args): Promise<null> => {
    throw new Error("NOT_IMPLEMENTED(lane-c)");
  },
});
