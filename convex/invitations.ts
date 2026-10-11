import { withPublicErrors } from "./lib/publicErrors";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { PhoneE164Schema } from "../packages/shared/primitives";
import { hashCode, invitationCode, openEnvelope, senderFor } from "./lib/messaging";
import { parseCommand } from "../packages/shared/commands";

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
  handler: async (ctx, args): Promise<Infer<typeof createdInvitation>[]> => withPublicErrors(ctx, async () => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("UNAUTHORIZED");
    const user = await ctx.db.query("users").withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject)).unique();
    if (!user) throw new Error("UNAUTHORIZED");
    const organizer = await ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", args.eventId).eq("userId", user._id)).unique();
    if (organizer?.state !== "enrolled" || organizer.role !== "organizer") throw new Error("UNAUTHORIZED");
    const event = await ctx.db.get(args.eventId);
    if (!event || event.status === "canceled" || event.status === "completed") throw new Error("INVITATIONS_UNAVAILABLE");
    if (!args.idempotencyKey || args.idempotencyKey.length > 128 || args.contacts.length > 20) throw new Error("INVALID_INVITATION_REQUEST");
    const results: Infer<typeof createdInvitation>[] = [];
    for (const contact of args.contacts) {
      PhoneE164Schema.parse(contact.phoneE164);
      if (!contact.displayName.trim() || contact.displayName.length > 256) throw new Error("INVALID_CONTACT");
      // A keyed PRF gives each request/phone an unpredictable 128-bit code and
      // lets exact retries return it without storing the plaintext code.
      const code = await invitationCode(JSON.stringify([user._id, args.eventId, args.idempotencyKey, contact.phoneE164]));
      const codeHash = await hashCode(code);
      const prior = await ctx.db.query("invitations").withIndex("by_code_hash", (q) => q.eq("codeHash", codeHash)).unique();
      if (prior?.contactSelectionId) {
        const selected = await ctx.db.get(prior.contactSelectionId);
        if (selected?.displayName !== contact.displayName) throw new Error("IDEMPOTENCY_CONFLICT");
        results.push({ invitationId: prior._id, contactSelectionId: prior.contactSelectionId, code, expiresAt: prior.expiresAt });
        continue;
      }
      const existingUser = await ctx.db.query("users").withIndex("by_phone", (q) => q.eq("verifiedPhoneE164", contact.phoneE164)).unique();
      // Selected contacts do not get verifiedPhoneE164 until their own JOIN.
      const selections = await ctx.db.query("contactSelections").withIndex("by_event", (q) => q.eq("eventId", args.eventId)).collect();
      const previous = selections.find((s) => s.phoneE164 === contact.phoneE164);
      const previousInvite = previous?.invitationId ? await ctx.db.get(previous.invitationId) : null;
      const targetUserId = existingUser?._id ?? previousInvite?.targetUserId ?? await ctx.db.insert("users", { displayName: contact.displayName, createdAt: Date.now(), messagingState: "active", settings: {} });
      const membership = await ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", args.eventId).eq("userId", targetUserId)).unique();
      if (membership?.state === "enrolled") throw new Error("ALREADY_ENROLLED");
      if (!membership) await ctx.db.insert("memberships", { eventId: args.eventId, userId: targetUserId, role: "member", state: "invited", notificationsEnabled: false });
      if (previousInvite?.state === "pending") await ctx.db.patch(previousInvite._id, { state: "revoked" });
      const contactSelectionId = await ctx.db.insert("contactSelections", { ownerUserId: user._id, eventId: args.eventId, ...contact, selectedAt: Date.now() });
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      const invitationId = await ctx.db.insert("invitations", { purpose: "event_invite", eventId: args.eventId, inviterUserId: user._id, contactSelectionId, targetUserId, codeHash, state: "pending", expiresAt, failedAttempts: 0 });
      await ctx.db.patch(contactSelectionId, { invitationId });
      results.push({ invitationId, contactSelectionId, code, expiresAt });
    }
    return results;
  }),
});

const redeemedInvitation = v.union(
  v.object({ redeemed: v.literal(true), userId: v.id("users"), eventId: v.optional(v.id("events")) }),
  v.object({ redeemed: v.literal(false) }),
);

/** Lane A: derive phone from source message; enforce code expiry/single-use/limits. */
export const redeem = internalMutation({
  args: { messageId: v.id("inboundMessages"), code: v.string() },
  returns: redeemedInvitation,
  handler: async (ctx, args): Promise<Infer<typeof redeemedInvitation>> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || args.code.length > 128) return { redeemed: false };
    const command = parseCommand((await openEnvelope(message)).text);
    if (command.type !== "JOIN" || command.code.toUpperCase() !== args.code.trim().toUpperCase()) return { redeemed: false };
    const recent = await ctx.db.query("inboundMessages").withIndex("by_sender", (q) => q.eq("senderPhone", message.senderPhone)).order("desc").take(31);
    if (recent.filter((m) => m.receivedAt > Date.now() - 60_000).length > 30) return { redeemed: false };
    const codeHash = await hashCode(args.code);
    const invitation = await ctx.db.query("invitations").withIndex("by_code_hash", (q) => q.eq("codeHash", codeHash)).unique();
    if (!invitation || invitation.state !== "pending") return { redeemed: false };
    if (invitation.expiresAt <= Date.now()) {
      await ctx.db.patch(invitation._id, { state: "expired" });
      return { redeemed: false };
    }
    if (invitation.failedAttempts >= 5) return { redeemed: false };
    const selected = invitation.contactSelectionId ? await ctx.db.get(invitation.contactSelectionId) : null;
    const target = invitation.targetUserId ? await ctx.db.get(invitation.targetUserId) : null;
    const ownPhone = target?.verifiedPhoneE164;
    const expectedPhone = selected?.phoneE164 ?? ownPhone;
    const sender = await senderFor(ctx, message);
    const event = invitation.eventId ? await ctx.db.get(invitation.eventId) : null;
    if (!target || !expectedPhone || expectedPhone !== message.senderPhone || (sender && sender._id !== target._id && (target.authSubject || ownPhone || invitation.purpose === "app_phone_link")) || (ownPhone && ownPhone !== message.senderPhone) || (invitation.purpose === "event_invite" && (!event || event.status === "canceled" || event.status === "completed"))) {
      await ctx.db.patch(invitation._id, { failedAttempts: invitation.failedAttempts + 1 });
      return { redeemed: false };
    }
    const canonicalUser = sender ?? target;
    if (invitation.purpose === "event_invite") {
      const membership = await ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", invitation.eventId!).eq("userId", target._id)).unique();
      // App-created organizers already have event access, but acquire messaging
      // consent only through their own scoped, self-issued invitation and JOIN.
      const organizerOptIn = membership?.role === "organizer" && membership.consentAt === undefined && invitation.inviterUserId === target._id && canonicalUser._id === target._id;
      if (!membership || membership.state === "enrolled" && !organizerOptIn) return { redeemed: false };
      const duplicateMembership = canonicalUser._id !== target._id ? await ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", invitation.eventId!).eq("userId", canonicalUser._id)).unique() : null;
      if (duplicateMembership) {
        await ctx.db.delete(membership._id);
        await ctx.db.patch(duplicateMembership._id, { state: "enrolled", notificationsEnabled: true, joinedAt: Date.now(), consentAt: Date.now(), consentSourceMessageId: message._id });
      } else await ctx.db.patch(membership._id, { userId: canonicalUser._id, state: "enrolled", notificationsEnabled: true, joinedAt: Date.now(), consentAt: Date.now(), consentSourceMessageId: message._id });
    }
    // JOIN never silently resumes a STOP/PAUSE preference.
    await ctx.db.patch(canonicalUser._id, { verifiedPhoneE164: message.senderPhone, ...(canonicalUser.displayName === "Rally participant" ? { displayName: target.displayName } : {}) });
    await ctx.db.patch(invitation._id, { targetUserId: canonicalUser._id, state: "redeemed", redeemedByPhoneE164: message.senderPhone, redeemedAt: Date.now() });
    return { redeemed: true, userId: canonicalUser._id, ...(invitation.eventId ? { eventId: invitation.eventId } : {}) };
  },
});
