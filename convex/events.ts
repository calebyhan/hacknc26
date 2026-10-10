import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { eventDetail, eventSummary, weatherPolicy } from "./lib/validators";

/** Lane B: authenticate, then return only enrolled event memberships. */
export const myEvents = query({
  args: {},
  returns: v.array(eventSummary),
  handler: async (_ctx): Promise<Infer<typeof eventSummary>[]> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});

/** Lane B: requireMember before reading an event or exposing its existence. */
export const detail = query({
  args: { eventId: v.id("events") },
  returns: eventDetail,
  handler: async (_ctx, _args): Promise<Infer<typeof eventDetail>> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});

/** Lane B: derive owner from requireUser; create its organizer membership atomically. */
export const create = mutation({
  args: {
    title: v.string(),
    kind: v.union(v.literal("event"), v.literal("project")),
    startsAt: v.number(),
    timezone: v.string(),
    location: v.optional(v.string()),
    weatherPolicy: v.optional(weatherPolicy),
    idempotencyKey: v.string(),
  },
  returns: v.id("events"),
  handler: async (_ctx, _args): Promise<Id<"events">> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});

/** Lane B: requireOrganizer and compare expectedVersion before publishing a draft. */
export const confirmDraft = mutation({
  args: { eventId: v.id("events"), expectedVersion: v.number() },
  returns: v.id("events"),
  handler: async (_ctx, _args): Promise<Id<"events">> => {
    throw new Error("NOT_IMPLEMENTED(lane-b)");
  },
});
