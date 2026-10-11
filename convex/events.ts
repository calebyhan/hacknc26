import { withPublicErrors } from "./lib/publicErrors";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { eventDetail, eventSummary, weatherPolicy } from "./lib/validators";
import { requireUser, requireMember, requireOrganizer } from "./lib/auth";
import { audit, createEvent, detailFor, summarizeEvent } from "./lib/domain";
import { createOrganizerInvitation } from "./lib/invitations";

/** Lane B: authenticate, then return only enrolled event memberships. */
export const myEvents = query({
  args: {},
  returns: v.array(eventSummary),
  handler: async (ctx): Promise<Infer<typeof eventSummary>[]> => withPublicErrors(ctx, async () => {
    const user = await requireUser(ctx);
    const memberships = (await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).collect()).filter(m => m.state === "enrolled");
    const summaries: Infer<typeof eventSummary>[] = [];
    for (const m of memberships) { const event = await ctx.db.get(m.eventId); if (event) summaries.push(summarizeEvent(event, m.role)); }
    return summaries.sort((a, b) => a.startsAt - b.startsAt || a._id.localeCompare(b._id));
  }),
});

/** App ownership grants setup access, not iMessage opt-in. The organizer JOINs. */
export const organizerInvitation = mutation({
  args: { eventId: v.id("events"), idempotencyKey: v.string() },
  returns: v.object({ invitationId: v.id("invitations"), code: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args): Promise<{ invitationId: Id<"invitations">; code: string; expiresAt: number }> => withPublicErrors(ctx, async () => {
    const { user, membership } = await requireOrganizer(ctx, args.eventId);
    return createOrganizerInvitation(ctx, user, membership, args.eventId, args.idempotencyKey);
  }),
});

/** Lane B: requireMember before reading an event or exposing its existence. */
export const detail = query({
  args: { eventId: v.id("events") },
  returns: eventDetail,
  handler: async (ctx, args): Promise<Infer<typeof eventDetail>> => withPublicErrors(ctx, async () => {
    const { user } = await requireMember(ctx, args.eventId);
    return detailFor(ctx, user._id, args.eventId);
  }),
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
  handler: async (ctx, args): Promise<Id<"events">> => withPublicErrors(ctx, async () => {
    return createEvent(ctx, (await requireUser(ctx))._id, args);
  }),
});

/** Lane B: requireOrganizer and compare expectedVersion before publishing a draft. */
export const confirmDraft = mutation({
  args: { eventId: v.id("events"), expectedVersion: v.number() },
  returns: v.id("events"),
  handler: async (ctx, args): Promise<Id<"events">> => withPublicErrors(ctx, async () => {
    const { user } = await requireOrganizer(ctx, args.eventId), event = (await ctx.db.get(args.eventId))!;
    if (event.status === "scheduled" && event.version === args.expectedVersion + 1) return event._id;
    if (!Number.isInteger(args.expectedVersion) || event.version !== args.expectedVersion) throw new Error("STALE_EVENT");
    if (event.status !== "draft") throw new Error("INVALID_EVENT_TRANSITION");
    await ctx.db.patch(event._id, { status: "scheduled", version: event.version + 1 });
    await audit(ctx, event._id, user._id, "event_confirmed", `event-confirm:${event._id}:${event.version}`, { version: event.version + 1 });
    return event._id;
  }),
});
