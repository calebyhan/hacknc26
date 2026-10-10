import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AuthContext = QueryCtx | MutationCtx;
export type AuthorizedMember = { user: Doc<"users">; membership: Doc<"memberships"> };

/** Resolve only server-verified ctx.auth identity; never accept a supplied user ID. */
export async function requireUser(ctx: AuthContext): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("UNAUTHORIZED");
  const user = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", identity.subject)).unique();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

/** Require the authenticated user to be enrolled in this event. */
export async function requireMember(
  ctx: AuthContext,
  eventId: Id<"events">,
): Promise<AuthorizedMember> {
  const user = await requireUser(ctx);
  return memberFor(ctx, user._id, eventId);
}

/** Require enrolled organizer role as well as identity; ownership IDs are not auth. */
export async function requireOrganizer(
  ctx: AuthContext,
  eventId: Id<"events">,
): Promise<AuthorizedMember> {
  const result = await requireMember(ctx, eventId);
  if (result.membership.role !== "organizer") throw new Error("UNAUTHORIZED");
  return result;
}

/** Internal callers still require enrollment; a supplied ID is not authority. */
export async function memberFor(ctx: AuthContext, userId: Id<"users">, eventId: Id<"events">): Promise<AuthorizedMember> {
  const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", eventId).eq("userId", userId)).unique();
  if (membership?.state !== "enrolled") throw new Error("UNAUTHORIZED");
  const user = await ctx.db.get(userId), event = await ctx.db.get(eventId);
  if (!user || !event) throw new Error("UNAUTHORIZED");
  return { user, membership };
}
