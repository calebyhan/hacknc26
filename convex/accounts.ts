import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { PhoneE164Schema, TextReferenceSchema } from "../packages/shared/primitives";
import { IdempotencyKeySchema } from "../packages/shared/domain";
import { hashCode, invitationCode, openEnvelope } from "./lib/messaging";
import { parseCommand } from "../packages/shared/commands";
import { withPublicErrors } from "./lib/publicErrors";
import { messagingState } from "./lib/validators";
import { AppPhoneLinkChallengeSchema, type AppRoute } from "../packages/shared/appStatus";
import { phoneChallengeRoute } from "./lib/appStatus";

/** Current verified app identity only; phone proof never implies event consent. */
export const current = query({
  args: {},
  returns: v.object({ userId: v.id("users"), displayName: v.string(), phoneLinked: v.boolean(), messagingState }),
  handler: async (ctx) => withPublicErrors(ctx, async () => {
    const user = await requireUser(ctx);
    return { userId: user._id, displayName: user.displayName, phoneLinked: user.verifiedPhoneE164 !== undefined, messagingState: user.messagingState };
  }),
});

export const register = mutation({
  args: { displayName: v.string() }, returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => withPublicErrors(ctx, async () => {
    const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new Error("UNAUTHORIZED");
    const displayName = TextReferenceSchema.parse(args.displayName);
    const existing = await ctx.db.query("users").withIndex("by_auth_subject", q => q.eq("authSubject", identity.subject)).unique();
    if (existing) return existing._id;
    return ctx.db.insert("users", { authSubject: identity.subject, displayName, messagingState: "active", createdAt: Date.now(), settings: {} });
  }),
});
const challenge = v.object({ invitationId: v.id("invitations"), code: v.string(), expiresAt: v.number(), route: v.union(v.object({ status: v.literal("available"), destination: v.string(), expiresAt: v.number() }), v.object({ status: v.literal("unavailable") })) });
export const beginPhoneLink = mutation({
  args: { phoneE164: v.string(), idempotencyKey: v.string() }, returns: challenge,
  handler: async (ctx, args): Promise<{ invitationId: Id<"invitations">; code: string; expiresAt: number; route: AppRoute }> => withPublicErrors(ctx, async () => {
    const user = await requireUser(ctx), phoneE164 = PhoneE164Schema.parse(args.phoneE164);
    const key = IdempotencyKeySchema.parse(args.idempotencyKey);
    if (user.verifiedPhoneE164 && user.verifiedPhoneE164 !== phoneE164) throw new Error("PHONE_CHANGE_NOT_SUPPORTED");
    const code = await invitationCode(JSON.stringify(["app-phone-link", user._id, key, phoneE164]));
    const codeHash = await hashCode(code);
    const existing = await ctx.db.query("invitations").withIndex("by_code_hash", q => q.eq("codeHash", codeHash)).unique();
    if (existing) {
      if (existing.purpose !== "app_phone_link" || existing.inviterUserId !== user._id) throw new Error("UNAUTHORIZED");
      const result = { invitationId: existing._id, code, expiresAt: existing.expiresAt, route: await phoneChallengeRoute(ctx, phoneE164, existing.expiresAt) };
      AppPhoneLinkChallengeSchema.parse(result);
      return result;
    }
    const contactSelectionId = await ctx.db.insert("contactSelections", { ownerUserId: user._id, displayName: user.displayName, phoneE164, selectedAt: Date.now() });
    const expiresAt = Date.now() + 600000;
    const invitationId = await ctx.db.insert("invitations", { purpose: "app_phone_link", inviterUserId: user._id, targetUserId: user._id, contactSelectionId, codeHash, expiresAt, failedAttempts: 0, state: "pending" });
    await ctx.db.patch(contactSelectionId, { invitationId });
    const result = { invitationId, code, expiresAt, route: await phoneChallengeRoute(ctx, phoneE164, expiresAt) };
    AppPhoneLinkChallengeSchema.parse(result);
    return result;
  }),
});
/** The app must possess its own session AND find its actual signed JOIN proof. */
export const completePhoneLink = mutation({
  args: { invitationId: v.id("invitations") }, returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => withPublicErrors(ctx, async () => {
    const user = await requireUser(ctx), invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.purpose !== "app_phone_link" || invitation.inviterUserId !== user._id || !invitation.contactSelectionId) throw new Error("UNAUTHORIZED");
    const selected = await ctx.db.get(invitation.contactSelectionId);
    if (!selected || selected.ownerUserId !== user._id) throw new Error("UNAUTHORIZED");
    if (invitation.state === "redeemed" && user.verifiedPhoneE164 === selected.phoneE164 && invitation.redeemedByPhoneE164 === selected.phoneE164) return user._id;
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now() || invitation.failedAttempts >= 5) throw new Error("PHONE_CHALLENGE_EXPIRED");
    const messages = await ctx.db.query("inboundMessages").withIndex("by_sender", q => q.eq("senderPhone", selected.phoneE164)).order("desc").take(30);
    let proof = false;
    for (const message of messages) {
      if (message.provider !== "spectrum" || message.receivedAt < selected.selectedAt || message.receivedAt > invitation.expiresAt) continue;
      const command = parseCommand((await openEnvelope(message)).text);
      if (command.type === "JOIN" && await hashCode(command.code) === invitation.codeHash) { proof = true; break; }
    }
    if (!proof) throw new Error("PHONE_PROOF_REQUIRED");
    const canonical = await ctx.db.query("users").withIndex("by_phone", q => q.eq("verifiedPhoneE164", selected.phoneE164)).unique();
    if (canonical && canonical._id !== user._id) {
      if (canonical.authSubject && canonical.authSubject !== user.authSubject) throw new Error("PHONE_IDENTITY_CONFLICT");
      // Link before event creation. Do not silently migrate an established app
      // account's roles/ownership or grant one account another account's data.
      if ((await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).take(1)).length || (await ctx.db.query("events").withIndex("by_owner", q => q.eq("ownerId", user._id)).take(1)).length || (await ctx.db.query("commitments").withIndex("by_participant", q => q.eq("participantId", user._id)).take(1)).length) throw new Error("LINK_PHONE_BEFORE_CREATING_EVENTS");
      await ctx.db.patch(canonical._id, { authSubject: user.authSubject!, displayName: user.displayName });
      const contacts = await ctx.db.query("contactSelections").withIndex("by_owner", q => q.eq("ownerUserId", user._id)).collect();
      for (const contact of contacts) await ctx.db.patch(contact._id, { ownerUserId: canonical._id });
      await ctx.db.patch(invitation._id, { targetUserId: canonical._id, inviterUserId: canonical._id });
      await ctx.db.delete(user._id);
    } else await ctx.db.patch(user._id, { verifiedPhoneE164: selected.phoneE164 });
    const userId = canonical?._id ?? user._id;
    await ctx.db.patch(invitation._id, { targetUserId: userId, state: "redeemed", redeemedByPhoneE164: selected.phoneE164, redeemedAt: Date.now() });
    return userId;
  }),
});
