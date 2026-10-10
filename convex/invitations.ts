import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";

const createdInvitation = v.object({
  invitationId: v.id("invitations"),
  contactSelectionId: v.id("contactSelections"),
  code: v.string(),
  expiresAt: v.number(),
});

/**
 * Lane A: requireOrganizer; invitations are selected contacts, never enrollment.
 * Codes returned only for human handoff, stored hashed, never logged or sent.
 */
export const createForContacts = mutation({
  args: {
    eventId: v.id("events"),
    contacts: v.array(v.object({ displayName: v.string(), phoneE164: v.string() })),
    idempotencyKey: v.string(),
  },
  returns: v.array(createdInvitation),
  handler: async (_ctx, _args): Promise<Infer<typeof createdInvitation>[]> => {
    throw new Error("NOT_IMPLEMENTED(lane-a)");
  },
});

const redeemedInvitation = v.union(
  v.object({ redeemed: v.literal(true), userId: v.id("users"), eventId: v.optional(v.id("events")) }),
  v.object({ redeemed: v.literal(false) }),
);

/** Lane A: derive phone from source message; enforce code expiry/single-use/limits. */
export const redeem = internalMutation({
  args: { messageId: v.id("inboundMessages"), code: v.string() },
  returns: redeemedInvitation,
  handler: async (_ctx, _args): Promise<Infer<typeof redeemedInvitation>> => {
    throw new Error("NOT_IMPLEMENTED(lane-a)");
  },
});
