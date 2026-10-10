import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { reportUnavailable as report } from "./lib/commitmentEngine";

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
  handler: async (ctx, args): Promise<Id<"commitments">[]> => {
    return report(ctx, args);
  },
});
