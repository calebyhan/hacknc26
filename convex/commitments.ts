import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/** Lane B: verify sender; self-cancel or audited organizer override only (ADR-011). */
export const reportUnavailable = internalMutation({
  args: {
    eventId: v.id("events"),
    actorId: v.id("users"),
    participantId: v.id("users"),
    taskId: v.optional(v.id("tasks")),
    window: v.optional(v.object({ startsAt: v.number(), endsAt: v.number() })),
    sourceMessageId: v.id("inboundMessages"),
    expectedEventVersion: v.number(),
  },
  returns: v.array(v.id("commitments")),
  handler: async (_ctx, _args): Promise<Id<"commitments">[]> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});
