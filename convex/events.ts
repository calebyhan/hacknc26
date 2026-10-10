import { v } from "convex/values";
import type { Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { eventDetail, eventSummary, weatherPolicy } from "./lib/validators";
import { requireUser, requireMember, requireOrganizer } from "./lib/auth";
import { audit, createEvent, detailFor, summarizeEvent } from "./lib/domain";
import { hashCode, invitationCode } from "./lib/messaging";
import { IdempotencyKeySchema } from "../packages/shared/domain";

/** Lane B: authenticate, then return only enrolled event memberships. */
export const myEvents = query({
  args: {},
  returns: v.array(eventSummary),
  handler: async (ctx): Promise<Infer<typeof eventSummary>[]> => {
    const user = await requireUser(ctx);
    const memberships = (await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).collect()).filter(m => m.state === "enrolled");
    const summaries: Infer<typeof eventSummary>[] = [];
    for (const m of memberships) { const event = await ctx.db.get(m.eventId); if (event) summaries.push(summarizeEvent(event, m.role)); }
    return summaries.sort((a, b) => a.startsAt - b.startsAt || a._id.localeCompare(b._id));
  },
});

/** App ownership grants setup access, not iMessage opt-in. The organizer JOINs. */
export const organizerInvitation = mutation({
  args: { eventId: v.id("events"), idempotencyKey: v.string() },
  returns: v.object({ invitationId: v.id("invitations"), code: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args): Promise<{ invitationId: Id<"invitations">; code: string; expiresAt: number }> => {
    const { user, membership } = await requireOrganizer(ctx, args.eventId);
    const event = (await ctx.db.get(args.eventId))!;
    if (!user.verifiedPhoneE164) throw new Error("PHONE_LINK_REQUIRED");
    if (event.status === "completed" || event.status === "canceled") throw new Error("EVENT_CLOSED");
    const key = IdempotencyKeySchema.parse(args.idempotencyKey);
    const code = await invitationCode(JSON.stringify(["organizer-event-opt-in", user._id, args.eventId, key]));
    const codeHash = await hashCode(code);
    const prior = await ctx.db.query("invitations").withIndex("by_code_hash", q => q.eq("codeHash", codeHash)).unique();
    if (prior) return { invitationId: prior._id, code, expiresAt: prior.expiresAt };
    if (membership.consentAt !== undefined) throw new Error("ALREADY_ENROLLED");
    const contactSelectionId = await ctx.db.insert("contactSelections", { ownerUserId: user._id, eventId: args.eventId, displayName: user.displayName, phoneE164: user.verifiedPhoneE164, selectedAt: Date.now() });
    const expiresAt = Date.now() + 86400000;
    const invitationId = await ctx.db.insert("invitations", { purpose: "event_invite", inviterUserId: user._id, targetUserId: user._id, contactSelectionId, eventId: args.eventId, codeHash, expiresAt, failedAttempts: 0, state: "pending" });
    await ctx.db.patch(contactSelectionId, { invitationId });
    return { invitationId, code, expiresAt };
  },
});

/** Lane B: requireMember before reading an event or exposing its existence. */
export const detail = query({
  args: { eventId: v.id("events") },
  returns: eventDetail,
  handler: async (ctx, args): Promise<Infer<typeof eventDetail>> => {
    const { user } = await requireMember(ctx, args.eventId);
    return detailFor(ctx, user._id, args.eventId);
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
  handler: async (ctx, args): Promise<Id<"events">> => {
    return createEvent(ctx, (await requireUser(ctx))._id, args);
  },
});

/** Lane B: requireOrganizer and compare expectedVersion before publishing a draft. */
export const confirmDraft = mutation({
  args: { eventId: v.id("events"), expectedVersion: v.number() },
  returns: v.id("events"),
  handler: async (ctx, args): Promise<Id<"events">> => {
    const { user } = await requireOrganizer(ctx, args.eventId), event = (await ctx.db.get(args.eventId))!;
    if (event.status === "scheduled" && event.version === args.expectedVersion + 1) return event._id;
    if (!Number.isInteger(args.expectedVersion) || event.version !== args.expectedVersion) throw new Error("STALE_EVENT");
    if (event.status !== "draft") throw new Error("INVALID_EVENT_TRANSITION");
    await ctx.db.patch(event._id, { status: "scheduled", version: event.version + 1 });
    await audit(ctx, event._id, user._id, "event_confirmed", `event-confirm:${event._id}:${event.version}`, { version: event.version + 1 });
    return event._id;
  },
});
