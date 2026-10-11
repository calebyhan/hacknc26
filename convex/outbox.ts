import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { canSend, openEnvelope } from "./lib/messaging";
import { internal } from "./_generated/api";
import { SendRequestSchema } from "../packages/shared/adapters";


/**
 * Lane A: single consent/idempotency gate; compose content from structured state.
 * A directReplyToMessageId is verified as this recipient's own inbound message,
 * not a caller-controlled bypass for STOP, membership or outreach permission.
 */
export const enqueue = internalMutation({
  args: {
    idempotencyKey: v.string(),
    recipientUserId: v.id("users"),
    eventId: v.optional(v.id("events")),
    proposalId: v.optional(v.id("proposals")),
    content: v.string(),
    directReplyToMessageId: v.optional(v.id("inboundMessages")),
  },
  returns: v.id("outboundMessages"),
  handler: async (ctx, args): Promise<Id<"outboundMessages">> => {
    if (!args.idempotencyKey || args.idempotencyKey.length > 256 || !args.content || args.content.length > 4_000) throw new Error("INVALID_OUTBOUND");
    const existing = await ctx.db.query("outboundMessages").withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) {
      for (const key of ["recipientUserId", "eventId", "proposalId", "content", "directReplyToMessageId"] as const) {
        if (existing[key] !== args[key]) throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return existing._id;
    }
    if (!await canSend(ctx, args)) throw new Error("MESSAGING_NOT_PERMITTED");
    const outboundMessageId = await ctx.db.insert("outboundMessages", { ...args, state: "queued", attemptCount: 0 });
    await ctx.scheduler.runAfter(0, internal.spectrumSender.deliver, { outboundMessageId });
    return outboundMessageId;
  },
});

const dispatch = v.object({
  idempotencyKey: v.string(), recipientUserId: v.id("users"), toPhoneE164: v.string(),
  eventId: v.optional(v.id("events")), proposalId: v.optional(v.id("proposals")), content: v.string(),
  spaceId: v.string(), linePhone: v.optional(v.string()),
});

/** These trusted keys identify requests without confusing them with terminal
 * notices, which also retain proposalId and must be sent after an offer closes. */
async function proposalRequestIsCurrent(ctx: MutationCtx, row: Doc<"outboundMessages">): Promise<boolean> {
  if (!row.proposalId) return true;
  const prefix = `proposal:${row.proposalId}:`;
  const participantRequest = row.idempotencyKey.startsWith(`${prefix}request:`);
  const approvalRequest = row.idempotencyKey.startsWith(`${prefix}approval:`);
  if (!participantRequest && !approvalRequest) return true;

  const proposal = await ctx.db.get(row.proposalId);
  if (!proposal || proposal.eventId !== row.eventId || proposal.state !== "pending" || proposal.expiresAt <= Date.now()) return false;
  if (participantRequest) {
    if (row.idempotencyKey !== `${prefix}request:${row.recipientUserId}` || proposal.targetUserId !== row.recipientUserId || (proposal.requiresOrganizerApproval && proposal.organizerApprovedAt === undefined)) return false;
  } else {
    if (row.idempotencyKey !== `${prefix}approval:${row.recipientUserId}` || !proposal.requiresOrganizerApproval || proposal.organizerApprovedAt !== undefined) return false;
    const membership = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", proposal.eventId).eq("userId", row.recipientUserId)).unique();
    if (membership?.state !== "enrolled" || membership.role !== "organizer") return false;
  }
  const event = await ctx.db.get(proposal.eventId);
  const task = proposal.targetTaskId ? await ctx.db.get(proposal.targetTaskId) : null;
  return event?.status === "scheduled" && event.version === proposal.eventVersionAtCreation && task?.eventId === event._id && task.version === proposal.taskVersionAtCreation && task.status !== "completed" && task.status !== "canceled";
}

/** Atomically claim once, recheck consent/current offer and recover routing only from inbound. */
export const claim = internalMutation({
  args: { outboundMessageId: v.id("outboundMessages") }, returns: v.union(v.null(), dispatch),
  handler: async (ctx, args): Promise<import("convex/values").Infer<typeof dispatch> | null> => {
    const row = await ctx.db.get(args.outboundMessageId);
    if (!row || row.state !== "queued") return null;
    if (!await canSend(ctx, row) || !await proposalRequestIsCurrent(ctx, row)) {
      await ctx.db.patch(row._id, { state: "failed" });
      return null;
    }
    const user = await ctx.db.get(row.recipientUserId);
    const source = row.directReplyToMessageId ? await ctx.db.get(row.directReplyToMessageId) : await ctx.db.query("inboundMessages").withIndex("by_sender", (q) => q.eq("senderPhone", user!.verifiedPhoneE164!)).order("desc").first();
    if (!source || source.provider !== "spectrum") {
      await ctx.db.patch(row._id, { state: "failed" });
      return null;
    }
    const envelope = await openEnvelope(source);
    const request = SendRequestSchema.parse({ idempotencyKey: row.idempotencyKey, recipientUserId: row.recipientUserId, toPhoneE164: user!.verifiedPhoneE164, content: row.content, ...(row.eventId ? { eventId: row.eventId } : {}), ...(row.proposalId ? { proposalId: row.proposalId } : {}) });
    await ctx.db.patch(row._id, { state: "sending", attemptCount: row.attemptCount + 1 });
    await ctx.scheduler.runAfter(60_000, internal.outbox.markUnknown, { outboundMessageId: row._id });
    return { idempotencyKey: request.idempotencyKey, toPhoneE164: request.toPhoneE164, content: request.content, recipientUserId: row.recipientUserId, ...(row.eventId ? { eventId: row.eventId } : {}), ...(row.proposalId ? { proposalId: row.proposalId } : {}), spaceId: envelope.spaceId, ...(envelope.linePhone ? { linePhone: envelope.linePhone } : {}) };
  },
});

export const settle = internalMutation({
  args: { outboundMessageId: v.id("outboundMessages"), state: v.union(v.literal("sent"), v.literal("failed"), v.literal("unknown")), providerMessageId: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db.get(args.outboundMessageId);
    // Late success is allowed after the watchdog, without another attempt.
    if (row && (row.state === "sending" || row.state === "unknown")) {
      await ctx.db.patch(row._id, { state: args.state, ...(args.providerMessageId ? { providerMessageId: args.providerMessageId } : {}) });
    }
    return null;
  },
});

export const markUnknown = internalMutation({
  args: { outboundMessageId: v.id("outboundMessages") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db.get(args.outboundMessageId);
    if (row?.state === "sending") await ctx.db.patch(row._id, { state: "unknown" });
    return null;
  },
});
