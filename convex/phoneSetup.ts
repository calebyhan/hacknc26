import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { parsePhoneSetupCommand, phoneSetupUsageCopy } from "../packages/shared/phoneSetup";
import { audit, createEvent, createTask } from "./lib/domain";
import { createContactInvitations, createOrganizerInvitation } from "./lib/invitations";
import { approveProposal } from "./lib/proposalEngine";
import { contentDigest, openEnvelope, senderFor } from "./lib/messaging";

async function organizer(ctx: MutationCtx, user: Doc<"users">, eventId: Id<"events">) {
  const member = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", eventId).eq("userId", user._id)).unique();
  const consent = member?.consentSourceMessageId ? await ctx.db.get(member.consentSourceMessageId) : null;
  if (member?.state !== "enrolled" || member.role !== "organizer" || member.consentAt === undefined || consent?.provider !== "spectrum" || consent.senderPhone !== user.verifiedPhoneE164) throw new Error("UNAUTHORIZED");
  return member;
}
async function ownedEvent(ctx: MutationCtx, user: Doc<"users">, ref: string) {
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).collect();
  const events = await Promise.all(memberships.filter(m => m.state === "enrolled" && m.role === "organizer").map(m => ctx.db.get(m.eventId)));
  const matches = events.filter(e => e && (e._id === ref || e.title.toLowerCase() === ref.toLowerCase()));
  if (matches.length !== 1) throw new Error("UNAUTHORIZED");
  const event = matches[0]!; await organizer(ctx, user, event._id); return event;
}

/** Only persisted signed Photon sender evidence authorizes these phone writes.
 * A nested mutation lets the router roll back every write on a setup failure. */
export const execute = internalMutation({
  args: { messageId: v.id("inboundMessages") }, returns: v.boolean(),
  handler: async (ctx, { messageId }): Promise<boolean> => {
    const message = await ctx.db.get(messageId);
    if (!message || message.provider !== "spectrum" || message.processingState !== "processing" || message.receivedAt < Date.now() - 300_000) throw new Error("UNAUTHORIZED");
    const command = parsePhoneSetupCommand((await openEnvelope(message)).text);
    if (!command) return false;
    const user = await senderFor(ctx, message);
    if (!user) throw new Error("UNAUTHORIZED");
    if (user.messagingState !== "active") return true;
    const send = (content: string) => ctx.runMutation(internal.outbox.enqueue, { idempotencyKey: `inbound:${messageId}:setup`, recipientUserId: user._id, content, directReplyToMessageId: messageId });
    if (command.type === "INVALID") { await send(phoneSetupUsageCopy); return true; }
    const recent = await ctx.db.query("inboundMessages").withIndex("by_sender", q => q.eq("senderPhone", message.senderPhone)).order("desc").take(31);
    if (recent.filter(m => m.receivedAt > Date.now() - 60_000).length > 30) throw new Error("RATE_LIMITED");
    let eventId: Id<"events">, content: string;
    switch (command.type) {
      case "CREATE_EVENT": {
        if (command.startsAt <= Date.now() || command.startsAt > Date.now() + 366 * 86_400_000) throw new Error("INVALID_EVENT_TIME");
        const existing = await ctx.db.query("events").withIndex("by_owner", q => q.eq("ownerId", user._id)).collect();
        if (existing.filter(e => e.status === "draft").length >= 10) throw new Error("DRAFT_LIMIT");
        eventId = await createEvent(ctx, user._id, { title: command.title, kind: "event", startsAt: command.startsAt, timezone: command.timezone, ...(command.location ? { location: command.location } : {}), idempotencyKey: `phone:${messageId}` });
        const event = (await ctx.db.get(eventId))!;
        const membership = (await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", eventId).eq("userId", user._id)).unique())!;
        const invitation = await createOrganizerInvitation(ctx, user, membership, eventId, `phone:${messageId}`);
        content = `Draft: ${event.title}\nWhen: ${new Date(event.startsAt).toISOString()} (${event.timezone})${event.location ? `\nWhere: ${event.location}` : ""}\nNothing is scheduled yet.\n\n1. Enable your event notifications. Send this as its own message:\nJOIN ${invitation.code}\n\n2. After joining, review the details. If correct, send:\nCONFIRM ${eventId} ${event.version}\n\nThis JOIN code is for your phone only and expires in 24 hours. After confirming, invite each friend separately:\nINVITE ${eventId} | <friend name> | <their phone in +country format>`;
        break;
      }
      case "CONFIRM_EVENT": {
        const id = ctx.db.normalizeId("events", command.eventId); if (!id) throw new Error("UNAUTHORIZED");
        await organizer(ctx, user, id);
        const event = await ctx.db.get(id); if (!event || event.ownerId !== user._id) throw new Error("UNAUTHORIZED");
        if (event.status !== "draft" || event.version !== command.expectedVersion || event.startsAt <= Date.now()) throw new Error("STALE_EVENT");
        await ctx.db.patch(id, { status: "scheduled", version: event.version + 1 });
        await audit(ctx, id, user._id, "event_confirmed", `event-confirm:${id}:${event.version}`, { version: event.version + 1, sourceMessageId: messageId });
        eventId = id; content = `${event.title} is scheduled. No task is assigned yet. Add a task with TASK ${id} | <title> | <start ISO with offset> | <end ISO with offset>.`; break;
      }
      case "CREATE_TASK": {
        const event = await ownedEvent(ctx, user, command.eventRef);
        if (event.status !== "scheduled" || command.windowStart <= Date.now()) throw new Error("INVALID_TASK_TIME");
        const taskId = await createTask(ctx, user._id, { eventId: event._id, title: command.title, windowStart: command.windowStart, windowEnd: command.windowEnd, expectedEventVersion: event.version, idempotencyKey: `phone:${messageId}` });
        eventId = event._id; content = `${event.title}: ${command.title} created (${new Date(command.windowStart).toISOString()} to ${new Date(command.windowEnd).toISOString()}). It is unassigned. Task ${taskId}.`; break;
      }
      case "INVITE_CONTACT": {
        const event = await ownedEvent(ctx, user, command.eventRef);
        const invitation = (await createContactInvitations(ctx, user._id, { eventId: event._id, contacts: [{ displayName: command.displayName, phoneE164: command.phoneE164 }], idempotencyKey: `phone:${messageId}` }))[0]!;
        eventId = event._id; content = `${event.title}: Give ${command.displayName} this code yourself: JOIN ${invitation.code}. It expires in 24 hours and only works from the selected phone. Rally has not contacted them. They must JOIN before receiving event messages.`; break;
      }
      case "APPROVE_PROPOSAL": {
        const id = ctx.db.normalizeId("proposals", command.proposalId); const proposal = id ? await ctx.db.get(id) : null;
        if (!proposal) throw new Error("UNAUTHORIZED");
        await organizer(ctx, user, proposal.eventId);
        await approveProposal(ctx, proposal._id, user._id, messageId);
        const current = (await ctx.db.get(proposal._id))!;
        eventId = proposal.eventId;
        content = current.state === "pending" && current.organizerApprovedAt !== undefined ? "Organizer approval recorded. The participant still needs to accept; no assignment is confirmed." : "That offer is closed or no longer needs approval. No new assignment was made."; break;
      }
    }
    // Store a hash, never a second plaintext invitation code. Only this verified
    // setup transaction can authorize its exact direct response at send/retry.
    await audit(ctx, eventId, user._id, "phone_setup_reply", `phone-reply:${messageId}`, { contentHash: await contentDigest(content) });
    await send(content);
    return true;
  },
});
