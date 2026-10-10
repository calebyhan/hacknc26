import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireOrganizer } from "./lib/auth";
import { createTask } from "./lib/domain";

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
  handler: async (ctx, args): Promise<Id<"tasks">> => {
    const { user } = await requireOrganizer(ctx, args.eventId);
    return createTask(ctx, user._id, args);
  },
});
