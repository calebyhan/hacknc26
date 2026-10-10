import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";

/** Lane B: requireOrganizer, validate dependencies/windows; default capacity to 1. */
export const create = mutation({
  args: {
    eventId: v.id("events"),
    title: v.string(),
    location: v.optional(v.string()),
    windowStart: v.optional(v.number()),
    windowEnd: v.optional(v.number()),
    requiredSkills: v.optional(v.array(v.string())),
    capacity: v.optional(v.number()),
    dependsOnTaskIds: v.optional(v.array(v.id("tasks"))),
    expectedEventVersion: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.id("tasks"),
  handler: async (_ctx, _args): Promise<Id<"tasks">> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});
