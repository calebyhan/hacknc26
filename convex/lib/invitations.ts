import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { IdempotencyKeySchema } from "../../packages/shared/domain";
import { PhoneE164Schema } from "../../packages/shared/primitives";
import { hashCode, invitationCode } from "./messaging";

/** Shared app/phone setup writes; invitation selection never sends to contacts. */
export async function createContactInvitations(ctx: MutationCtx, userId: Id<"users">, args: {
  eventId: Id<"events">; contacts: { displayName: string; phoneE164: string }[]; idempotencyKey: string;
}): Promise<{ invitationId: Id<"invitations">; contactSelectionId: Id<"contactSelections">; code: string; expiresAt: number }[]> {
  const organizer = await ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", args.eventId).eq("userId", userId)).unique();
  if (organizer?.state !== "enrolled" || organizer.role !== "organizer") throw new Error("UNAUTHORIZED");
  const event = await ctx.db.get(args.eventId);
  if (!event || event.status === "canceled" || event.status === "completed") throw new Error("INVITATIONS_UNAVAILABLE");
  if (!args.idempotencyKey || args.idempotencyKey.length > 128 || args.contacts.length > 20) throw new Error("INVALID_INVITATION_REQUEST");
  const results: { invitationId: Id<"invitations">; contactSelectionId: Id<"contactSelections">; code: string; expiresAt: number }[] = [];
  for (const contact of args.contacts) {
    PhoneE164Schema.parse(contact.phoneE164);
    if (!contact.displayName.trim() || contact.displayName.length > 256) throw new Error("INVALID_CONTACT");
    // A keyed PRF gives each request/phone an unpredictable 128-bit code and
    // lets exact retries return it without storing the plaintext code.
    const code = await invitationCode(JSON.stringify([userId, args.eventId, args.idempotencyKey, contact.phoneE164]));
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
    const contactSelectionId = await ctx.db.insert("contactSelections", { ownerUserId: userId, eventId: args.eventId, ...contact, selectedAt: Date.now() });
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const invitationId = await ctx.db.insert("invitations", { purpose: "event_invite", eventId: args.eventId, inviterUserId: userId, contactSelectionId, targetUserId, codeHash, state: "pending", expiresAt, failedAttempts: 0 });
    await ctx.db.patch(contactSelectionId, { invitationId });
    results.push({ invitationId, contactSelectionId, code, expiresAt });
  }
  return results;
}

/** Ownership is not consent: both app and phone drafts require a genuine JOIN. */
export async function createOrganizerInvitation(ctx: MutationCtx, user: Doc<"users">, membership: Doc<"memberships">, eventId: Id<"events">, idempotencyKey: string) {
  if (membership.eventId !== eventId || membership.userId !== user._id || membership.role !== "organizer" || membership.state !== "enrolled") throw new Error("UNAUTHORIZED");
  const event = (await ctx.db.get(eventId))!;
  if (!user.verifiedPhoneE164) throw new Error("PHONE_LINK_REQUIRED");
  if (event.status === "completed" || event.status === "canceled") throw new Error("EVENT_CLOSED");
  const key = IdempotencyKeySchema.parse(idempotencyKey);
  const code = await invitationCode(JSON.stringify(["organizer-event-opt-in", user._id, eventId, key]));
  const codeHash = await hashCode(code);
  const prior = await ctx.db.query("invitations").withIndex("by_code_hash", q => q.eq("codeHash", codeHash)).unique();
  if (prior) return { invitationId: prior._id, code, expiresAt: prior.expiresAt };
  if (membership.consentAt !== undefined) throw new Error("ALREADY_ENROLLED");
  const contactSelectionId = await ctx.db.insert("contactSelections", { ownerUserId: user._id, eventId: eventId, displayName: user.displayName, phoneE164: user.verifiedPhoneE164, selectedAt: Date.now() });
  const expiresAt = Date.now() + 86400000;
  const invitationId = await ctx.db.insert("invitations", { purpose: "event_invite", inviterUserId: user._id, targetUserId: user._id, contactSelectionId, eventId: eventId, codeHash, expiresAt, failedAttempts: 0, state: "pending" });
  await ctx.db.patch(contactSelectionId, { invitationId });
  return { invitationId, code, expiresAt };
}
