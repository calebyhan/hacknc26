import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { AppEventStatusSchema, AppOverviewSchema, AppRouteSchema, ProvisionedRouteInputSchema, appDomainActivityTitles } from "../packages/shared/appStatus";
import { PhoneE164Schema } from "../packages/shared/primitives";
import { requireMember, requireUser } from "./lib/auth";
import { withPublicErrors } from "./lib/publicErrors";
import { enumValidator, membershipState, messagingState, outboundState } from "./lib/validators";
import { currentRoute, eventActivity, eventProgress, messagingStatus, ROUTE_MAX_AGE_MS } from "./lib/appStatus";

const progress = v.object({ total: v.number(), confirmed: v.number(), needsCoverage: v.number(), completed: v.number(), canceled: v.number() });
const routeValue = v.union(v.object({ status: v.literal("available"), destination: v.string(), expiresAt: v.number() }), v.object({ status: v.literal("unavailable") }));
const messaging = v.object({ membershipState, consentRecorded: v.boolean(), notificationsEnabled: v.boolean(), messagingState, canReceiveMessages: v.boolean() });
const activity = v.union(
  v.object({ id: v.string(), kind: v.literal("domain"), at: v.number(), title: enumValidator(appDomainActivityTitles) }),
  v.object({ id: v.string(), kind: v.literal("delivery"), at: v.number(), title: v.literal("Message created for you"), deliveryState: outboundState }),
);

export const event = query({
  args: { eventId: v.id("events") },
  returns: v.object({ eventId: v.id("events"), progress, messaging, route: routeValue, activity: v.array(activity) }),
  handler: (ctx, args) => withPublicErrors(ctx, async () => {
    const { user, membership } = await requireMember(ctx, args.eventId);
    const [counts, permission, contact, recent] = await Promise.all([
      eventProgress(ctx, args.eventId), messagingStatus(ctx, user, membership), currentRoute(ctx, user), eventActivity(ctx, args.eventId, user._id),
    ]);
    const result = { eventId: args.eventId, progress: counts, messaging: permission, route: contact, activity: recent };
    AppEventStatusSchema.parse(result);
    return result;
  }),
});

export const overview = query({
  args: {}, returns: v.array(v.object({ eventId: v.id("events"), progress })),
  handler: ctx => withPublicErrors(ctx, async () => {
    const user = await requireUser(ctx);
    const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).collect();
    const result = [];
    for (const membership of memberships) {
      if (membership.state !== "enrolled" || !await ctx.db.get(membership.eventId)) continue;
      result.push({ eventId: membership.eventId, progress: await eventProgress(ctx, membership.eventId) });
    }
    AppOverviewSchema.parse(result);
    return result;
  }),
});

// Own-account scope permits contact display before this caller has an event.
export const route = query({
  args: {}, returns: routeValue,
  handler: ctx => withPublicErrors(ctx, async () => AppRouteSchema.parse(await currentRoute(ctx, await requireUser(ctx)))),
});

/**
 * Trusted operator/provider adapter boundary; never callable by an app or DM.
 * The caller must obtain the participant-to-Rally destination allocation from
 * authoritative provider provisioning. This function makes no provider call.
 */
export const recordProvisionedRoute = internalMutation({
  args: { participantPhoneE164: v.string(), destination: v.string(), verifiedAt: v.number(), expiresAt: v.number(), providerReference: v.string() },
  returns: v.null(),
  handler: async (ctx, input) => {
    const parsed = ProvisionedRouteInputSchema.safeParse(input);
    const now = Date.now();
    if (!parsed.success || input.verifiedAt > now || input.verifiedAt < now - ROUTE_MAX_AGE_MS
      || input.expiresAt <= now || input.expiresAt <= input.verifiedAt || input.expiresAt > input.verifiedAt + ROUTE_MAX_AGE_MS) throw new Error("INVALID_ROUTE_PROVISIONING");
    const { participantPhoneE164, ...provisioning } = parsed.data;
    const existing = await ctx.db.query("messagingRoutes").withIndex("by_participant_phone", q => q.eq("participantPhoneE164", participantPhoneE164)).unique();
    if (existing) {
      if (existing.revokedAt !== undefined && provisioning.verifiedAt <= existing.revokedAt) throw new Error("STALE_ROUTE_PROVISIONING");
      const previous = existing.provisioning;
      if (previous && provisioning.verifiedAt <= previous.verifiedAt) {
        if (existing.revokedAt === undefined && provisioning.verifiedAt === previous.verifiedAt && provisioning.destination === previous.destination
          && provisioning.expiresAt === previous.expiresAt && provisioning.providerReference === previous.providerReference) return null;
        throw new Error("STALE_ROUTE_PROVISIONING");
      }
      await ctx.db.patch(existing._id, { provisioning, revokedAt: undefined });
    } else await ctx.db.insert("messagingRoutes", { participantPhoneE164, provisioning });
    return null;
  },
});

export const revokeProvisionedRoute = internalMutation({
  args: { participantPhoneE164: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    if (!PhoneE164Schema.safeParse(args.participantPhoneE164).success) throw new Error("INVALID_ROUTE_PROVISIONING");
    const existing = await ctx.db.query("messagingRoutes").withIndex("by_participant_phone", q => q.eq("participantPhoneE164", args.participantPhoneE164)).unique();
    const revokedAt = Date.now();
    if (existing) await ctx.db.patch(existing._id, { revokedAt: Math.max(existing.revokedAt ?? 0, revokedAt) });
    else await ctx.db.insert("messagingRoutes", { participantPhoneE164: args.participantPhoneE164, revokedAt });
    return null;
  },
});
