import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { EVENT_CLOSURE_TTL_MS, EventClosureSnapshotSchema, eventClosureReview, parseEventClosureCommand } from "../../packages/shared/eventClosure";
import { audit, canonicalJson, notify } from "./domain";
import { contentDigest, openEnvelope } from "./messaging";

async function reply(ctx: MutationCtx, user: Doc<"users">, message: Doc<"inboundMessages">, content: string) {
  const existing = await ctx.db.query("phoneSetupReceipts").withIndex("by_message", q => q.eq("messageId", message._id)).unique();
  const contentHash = await contentDigest(content);
  if (existing && (existing.userId !== user._id || existing.contentHash !== contentHash)) throw new Error("IDEMPOTENCY_CONFLICT");
  if (!existing) await ctx.db.insert("phoneSetupReceipts", { userId: user._id, messageId: message._id, contentHash, createdAt: Date.now() });
  await ctx.runMutation(internal.outbox.enqueue, { recipientUserId: user._id, directReplyToMessageId: message._id, idempotencyKey: `inbound:${message._id}:event-close`, content });
}
async function permitted(ctx: MutationCtx, user: Doc<"users">, eventId: Id<"events">) {
  const member = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", eventId).eq("userId", user._id)).unique();
  const proof = member?.consentSourceMessageId ? await ctx.db.get(member.consentSourceMessageId) : null;
  return member?.state === "enrolled" && member.role === "organizer" && member.consentAt !== undefined && proof?.provider === "spectrum" && proof.senderPhone === user.verifiedPhoneE164;
}
async function snapshot(ctx: MutationCtx, event: Doc<"events">) {
  const [tasks, commitments, proposals, invitations] = await Promise.all([
    ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", event._id)).take(101),
    ctx.db.query("commitments").withIndex("by_event", q => q.eq("eventId", event._id)).collect(),
    ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", event._id)).collect(),
    ctx.db.query("invitations").withIndex("by_event", q => q.eq("eventId", event._id)).collect(),
  ]);
  return EventClosureSnapshotSchema.parse({ ownerId: event.ownerId, tasks: tasks.map(task => ({ taskId: task._id, version: task.version, status: task.status })).sort((a, b) => a.taskId.localeCompare(b.taskId)), activeCommitmentIds: commitments.filter(row => row.state === "active").map(row => row._id).sort(), pendingProposalIds: proposals.filter(row => row.state === "pending").map(row => row._id).sort(), pendingInvitationIds: invitations.filter(row => row.state === "pending").map(row => row._id).sort() });
}
function arrivedAfter(message: Doc<"inboundMessages">, previous: Doc<"inboundMessages">): boolean {
  return message.receivedAt > previous.receivedAt ||
    message.receivedAt === previous.receivedAt && message._creationTime > previous._creationTime;
}

/** This deterministic workflow is reachable only from a fresh signed inbound
 * phoneSetup transaction. A review changes no domain records. */
export async function handleEventClosure(ctx: MutationCtx, user: Doc<"users">, message: Doc<"inboundMessages">, text: string): Promise<boolean> {
  const command = parseEventClosureCommand(text); if (!command) return false;
  if (user.messagingState !== "active" || message.provider !== "spectrum" || message.senderPhone !== user.verifiedPhoneE164 || message.contentType !== "text/plain" || message.processingState !== "processing" || message.receivedAt < Date.now() - EVENT_CLOSURE_TTL_MS) throw new Error("UNAUTHORIZED");
  const review = await ctx.db.query("phoneEventClosures").withIndex("by_user", q => q.eq("userId", user._id)).unique();
  if (command.type === "usage") { await reply(ctx, user, message, 'Use "close event <exact event name>" to review one event you organize. Nothing is deleted or changed before confirmation.'); return true; }
  const reviewSource = review ? await ctx.db.get(review.sourceMessageId) : null;
  // Scheduler order is not sender order. In particular, a confirmation already
  // queued before the review must never authorize that newer review.
  if (reviewSource && !arrivedAfter(message, reviewSource)) {
    await reply(ctx, user, message, 'This message arrived before your current closure review. No event changed. Read the latest review, then reply "yes, close it" or "cancel close".');
    return true;
  }
  if (command.type === "cancel") {
    if (review) await ctx.db.delete(review._id);
    await reply(ctx, user, message, "Event closure review canceled. No event or assignments changed."); return true;
  }
  if (command.type === "review") {
    if (review) await ctx.db.delete(review._id);
    const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", user._id)).collect();
    const events: Doc<"events">[] = [];
    for (const member of memberships) {
      if (member.state !== "enrolled" || member.role !== "organizer") continue;
      const event = await ctx.db.get(member.eventId);
      if (event && !["canceled", "completed"].includes(event.status) && (event.title.toLowerCase() === command.eventRef.toLowerCase() || event._id === command.eventRef) && await permitted(ctx, user, event._id)) events.push(event);
    }
    if (events.length !== 1) {
      await reply(ctx, user, message, events.length > 1 ? "More than one event has that name. Use close event followed by the exact event ID shown in STATUS. No event changed." : "I couldn't find one open event you are a consented organizer of. Use close event followed by its exact name. No event changed."); return true;
    }
    const event = events[0]!, state = await snapshot(ctx, event);
    await ctx.db.insert("phoneEventClosures", { userId: user._id, eventId: event._id, eventVersion: event.version, sourceMessageId: message._id, snapshotJson: canonicalJson(state), createdAt: Date.now(), expiresAt: Date.now() + EVENT_CLOSURE_TTL_MS });
    await reply(ctx, user, message, eventClosureReview(event.title, state)); return true;
  }
  if (!review) { await reply(ctx, user, message, 'There is no active event closure review. First send "close event <exact event name>". No event changed.'); return true; }
  // Arrival after the request alone is insufficient: this confirmation might
  // already have been queued before the reviewed snapshot was produced. The
  // creation timestamp resolves distinct writes within the same millisecond.
  if (message.receivedAt < review.createdAt || message._creationTime <= review._creationTime) {
    await reply(ctx, user, message, 'This confirmation arrived before the review was ready. No event changed. Read the review, then send "yes, close it" again or "cancel close".');
    return true;
  }
  const event = await ctx.db.get(review.eventId), source = reviewSource;
  const start = source ? parseEventClosureCommand((await openEnvelope(source)).text) : null;
  if (!event || !source || source.provider !== "spectrum" || source.contentType !== "text/plain" || source.senderPhone !== user.verifiedPhoneE164 || !arrivedAfter(message, source) || source.receivedAt < Date.now() - EVENT_CLOSURE_TTL_MS || start?.type !== "review" || ![event.title.toLowerCase(), event._id.toLowerCase()].includes(start.eventRef.toLowerCase()) || review.expiresAt <= Date.now() || event.version !== review.eventVersion || ["canceled", "completed"].includes(event.status) || !await permitted(ctx, user, event._id) || canonicalJson(await snapshot(ctx, event)) !== review.snapshotJson) {
    await ctx.db.delete(review._id); await reply(ctx, user, message, 'That review expired, your organizer access changed, or the plan changed. Send "close event <exact event name>" for a fresh review. No event changed.'); return true;
  }
  const state = EventClosureSnapshotSchema.parse(JSON.parse(review.snapshotJson));
  await ctx.db.patch(event._id, { status: "canceled", version: event.version + 1 });
  for (const task of state.tasks) if (!["completed", "canceled"].includes(task.status)) await ctx.db.patch(task.taskId as Id<"tasks">, { status: "canceled", version: task.version + 1 });
  for (const id of state.activeCommitmentIds) await ctx.db.patch(id as Id<"commitments">, { state: "released", endedAt: Date.now(), endedByActorId: user._id });
  for (const id of state.pendingProposalIds) await ctx.db.patch(id as Id<"proposals">, { state: "canceled" });
  for (const id of state.pendingInvitationIds) await ctx.db.patch(id as Id<"invitations">, { state: "revoked" });
  await audit(ctx, event._id, user._id, "event_closed", `event-close:${message._id}`, { reviewSourceMessageId: review.sourceMessageId, confirmationSourceMessageId: message._id, previousVersion: event.version, snapshot: state });
  const focus = await ctx.db.query("conversationFocus").withIndex("by_user", q => q.eq("userId", user._id)).unique();
  if (focus?.lastEventId === event._id) await ctx.db.delete(focus._id);
  const setup = await ctx.db.query("phoneSetupSessions").withIndex("by_user", q => q.eq("userId", user._id)).unique();
  if (setup && (JSON.parse(setup.stateJson) as { eventId?: string }).eventId === event._id) await ctx.db.delete(setup._id);
  await ctx.db.delete(review._id);
  const members = await ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", event._id)).collect();
  for (const member of members) {
    if (member.userId === user._id || member.state !== "enrolled" || member.consentAt === undefined || !member.consentSourceMessageId) continue;
    const recipient = await ctx.db.get(member.userId), consent = await ctx.db.get(member.consentSourceMessageId);
    if (recipient?.verifiedPhoneE164 && consent?.provider === "spectrum" && consent.senderPhone === recipient.verifiedPhoneE164) await notify(ctx, member.userId, event._id, `${event.title} was closed by its organizer. Its active assignments were released and unfinished tasks canceled. History is retained.`, `event-close:${message._id}:${member.userId}`);
  }
  await reply(ctx, user, message, `${event.title} is closed (canceled). Active assignments were released, unfinished tasks and pending offers canceled, and pending invitations revoked. History is retained. Other events are unchanged.`);
  return true;
}
