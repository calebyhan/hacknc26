import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AuthContext = QueryCtx | MutationCtx;
export type AuthorizedMember = { user: Doc<"users">; membership: Doc<"memberships"> };

/** Resolve only server-verified ctx.auth identity; never accept a supplied user ID. */
export async function requireUser(_ctx: AuthContext): Promise<Doc<"users">> {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}

/** Require the authenticated user to be enrolled in this event. */
export async function requireMember(
  _ctx: AuthContext,
  _eventId: Id<"events">,
): Promise<AuthorizedMember> {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}

/** Require enrolled organizer role as well as identity; ownership IDs are not auth. */
export async function requireOrganizer(
  _ctx: AuthContext,
  _eventId: Id<"events">,
): Promise<AuthorizedMember> {
  throw new Error("NOT_IMPLEMENTED(lane-b)");
}
