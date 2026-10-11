import { InboundEnvelopeSchema, parseCommand, type InboundEnvelope } from "../../packages/shared/commands";
import { controlCopy, helpCopy, invalidJoinCopy, onboardingCopy, phoneLinkProofCopy } from "../../packages/shared/copy";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { parsePhoneSetupCommand, PhoneSetupReceiptSchema, phoneSetupErrorCopy, phoneSetupUsageCopy } from "../../packages/shared/phoneSetup";

const encoder = new TextEncoder();
function secretBytes(): Uint8Array<ArrayBuffer> {
  const secret = process.env.RALLY_MESSAGING_KEY;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error("MESSAGING_KEY_NOT_CONFIGURED");
  return Uint8Array.from(secret.match(/../g)!, (byte) => parseInt(byte, 16));
}
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); }

export async function invitationCode(scope: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes(), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`invitation:v1:${scope}`));
  return Array.from(new Uint8Array(mac).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(code.trim().toUpperCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function contentDigest(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function sealEnvelope(envelope: InboundEnvelope, binding: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes(), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // HTTP action only.
  const data = encoder.encode(JSON.stringify(InboundEnvelopeSchema.parse(envelope)));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(binding) }, key, data);
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function openEnvelope(message: Pick<Doc<"inboundMessages">, "provider" | "providerMessageId" | "senderPhone" | "bodyRedactedOrEncrypted">): Promise<InboundEnvelope> {
  const parts = message.bodyRedactedOrEncrypted?.split(".");
  if (parts?.length !== 3 || parts[0] !== "v1") throw new Error("INVALID_INBOUND_ENVELOPE");
  const key = await crypto.subtle.importKey("raw", secretBytes(), "AES-GCM", false, ["decrypt"]);
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(parts[1]!), additionalData: encoder.encode(`${message.provider}:${message.providerMessageId}:${message.senderPhone}`) }, key, fromBase64(parts[2]!));
  return InboundEnvelopeSchema.parse(JSON.parse(new TextDecoder().decode(data)));
}
export async function senderFor(ctx: QueryCtx | MutationCtx, message: Doc<"inboundMessages">) {
  return ctx.db.query("users").withIndex("by_phone", (q) => q.eq("verifiedPhoneE164", message.senderPhone)).unique();
}

/** JOIN supplies phone proof; only the authenticated app reconciles identities. */
export async function appPhoneLinkProof(ctx: QueryCtx | MutationCtx, message: Doc<"inboundMessages">, code: string): Promise<boolean> {
  if (message.provider !== "spectrum") return false;
  const codeHash = await hashCode(code);
  const invitation = await ctx.db.query("invitations").withIndex("by_code_hash", q => q.eq("codeHash", codeHash)).unique();
  if (!invitation || invitation.purpose !== "app_phone_link" || !["pending", "redeemed"].includes(invitation.state)
    || invitation.failedAttempts >= 5 || invitation.expiresAt <= Date.now() || message.receivedAt > invitation.expiresAt) return false;
  const selected = invitation.contactSelectionId ? await ctx.db.get(invitation.contactSelectionId) : null;
  const target = invitation.targetUserId ? await ctx.db.get(invitation.targetUserId) : null;
  const sender = await senderFor(ctx, message);
  return !!(selected && target?.authSubject && selected.ownerUserId === target._id && invitation.inviterUserId === target._id
    && selected.phoneE164 === message.senderPhone && message.receivedAt >= selected.selectedAt
    && (!target.verifiedPhoneE164 || target.verifiedPhoneE164 === message.senderPhone)
    && (!sender?.authSubject || sender.authSubject === target.authSubject));
}

/** Fixed controls or the exact authorized phone setup receipt; no broad reply bypass. */
export async function canSend(ctx: QueryCtx | MutationCtx, row: Pick<Doc<"outboundMessages">, "recipientUserId" | "eventId" | "directReplyToMessageId" | "content">): Promise<boolean> {
  const user = await ctx.db.get(row.recipientUserId);
  if (!user?.verifiedPhoneE164) return false;
  const inbound = row.directReplyToMessageId ? await ctx.db.get(row.directReplyToMessageId) : null;
  const ownReply = inbound?.provider === "spectrum" && inbound.senderPhone === user.verifiedPhoneE164;
  if (ownReply && !row.eventId) {
    const text = (await openEnvelope(inbound!)).text;
    const command = parseCommand(text);
    if (user.messagingState === "active") {
      // A failed guided transaction rolls back its receipt. This fixed error
      // contains no event data and is allowed only to the verified sender.
      if (row.content === phoneSetupErrorCopy) return true;
      const receipt = await ctx.db.query("phoneSetupReceipts").withIndex("by_message", q => q.eq("messageId", inbound!._id)).unique();
      if (receipt?.userId === user._id && receipt.createdAt > Date.now() - 86_400_000
        && receipt.createdAt <= Date.now() && receipt.contentHash === await contentDigest(row.content)) return true;
    }
    if (user.messagingState === "active" && parsePhoneSetupCommand(text)) {
      if (row.content === phoneSetupUsageCopy || row.content === phoneSetupErrorCopy) return true;
      const receipt = await ctx.db.query("auditEvents").withIndex("by_source", q => q.eq("sourceId", `phone-reply:${inbound!._id}`)).unique();
      if (receipt?.actorId === user._id && receipt.action === "phone_setup_reply" && receipt.at > Date.now() - 86_400_000) {
        const parsed = PhoneSetupReceiptSchema.safeParse(JSON.parse(receipt.newStateRef ?? "null"));
        if (parsed.success && parsed.data.contentHash === await contentDigest(row.content)) return true;
      }
    }
    if (row.content === onboardingCopy) return true;
    if (row.content === helpCopy && command.type === "HELP") return true;
    if (row.content === invalidJoinCopy && command.type === "JOIN") return true;
    if (row.content === phoneLinkProofCopy && command.type === "JOIN") return appPhoneLinkProof(ctx, inbound!, command.code);
    if (command.type === "LEAVE" && row.content === "You've left that event. Rally will no longer send its notifications.") {
      const memberships = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
      for (const membership of memberships.filter((m) => m.state === "left")) {
        const event = await ctx.db.get(membership.eventId);
        if (event && (event._id === command.eventRef || event.title.toLowerCase() === command.eventRef.toLowerCase())) return true;
      }
    }
    const state = command.type === "STOP" ? "stopped" : command.type === "PAUSE" ? "paused" : command.type === "RESUME" ? "active" : undefined;
    if (state && user.messagingState === state && row.content === controlCopy[state]) return true;
  }
  if (user.messagingState !== "active" || !row.eventId) return false;
  const membership = await ctx.db.query("memberships").withIndex("by_event_user", (q) => q.eq("eventId", row.eventId!).eq("userId", user._id)).unique();
  if (membership?.state !== "enrolled" || membership.consentAt === undefined || !membership.consentSourceMessageId) return false;
  const consent = await ctx.db.get(membership.consentSourceMessageId);
  return consent?.senderPhone === user.verifiedPhoneE164 && (ownReply || membership.notificationsEnabled);
}
