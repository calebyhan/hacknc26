import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { openEnvelope, senderFor } from "./lib/messaging";
import { parseCommand } from "../packages/shared/commands";
import { controlCopy, helpCopy, invalidJoinCopy, onboardingCopy, renderStatus, unavailableCopy } from "../packages/shared/copy";
import type { Id } from "./_generated/dataModel";

/**
 * Lane A: load persisted verified inbound, then shared parseCommand. Derive the
 * sender from that record; deterministic replies must not require inference.
 */
export const route = internalMutation({
  args: { messageId: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.processingState !== "received") return null;
    let envelope;
    try { envelope = await openEnvelope(message); } catch {
      await ctx.db.patch(message._id, { processingState: "failed" });
      return null;
    }
    const command = parseCommand(envelope.text);
    await ctx.db.patch(message._id, { processingState: "processing" });
    let user = await senderFor(ctx, message);
    // Redeem before creating an onboarding-only identity so an invited user
    // keeps their existing canonical ID on their first inbound JOIN.
    let joinedEventId: Id<"events"> | undefined;
    let joined = false;
    if (command.type === "JOIN") {
      const result = await ctx.runMutation(internal.invitations.redeem, { messageId: message._id, code: command.code });
      if (result.redeemed) {
        user = await ctx.db.get(result.userId);
        joined = true;
        joinedEventId = result.eventId;
      }
    }
    if (!user) {
      const userId = await ctx.db.insert("users", { displayName: "Rally participant", verifiedPhoneE164: message.senderPhone, createdAt: Date.now(), messagingState: "active", settings: {} });
      user = await ctx.db.get(userId);
    }
    if (!user) throw new Error("SENDER_NOT_FOUND");
    const sender = user;
    const memberships = (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", sender._id)).collect()).filter((m) => m.state === "enrolled");
    const reply = async (content: string, eventId?: Id<"events">, suffix = "reply") => {
      await ctx.runMutation(internal.outbox.enqueue, { idempotencyKey: `inbound:${message._id}:${suffix}`, recipientUserId: sender._id, content, directReplyToMessageId: message._id, ...(eventId ? { eventId } : {}) });
    };
    const finish = async () => { await ctx.db.patch(message._id, { processingState: "processed" }); return null; };
    if (command.type === "STOP" || ((command.type === "PAUSE" || command.type === "RESUME") && memberships.length)) {
      const state = command.type === "STOP" ? "stopped" : command.type === "PAUSE" ? "paused" : "active";
      await ctx.runMutation(internal.identity.setMessagingState, { messageId: message._id, state });
      await reply(controlCopy[state]);
      return finish();
    }
    if (command.type === "HELP") { await reply(helpCopy); return finish(); }
    if (command.type === "JOIN") {
      if (joined && joinedEventId && sender.messagingState === "active") {
        const event = await ctx.db.get(joinedEventId);
        await reply(`You've joined ${event!.title}. Text STATUS for assignments or HELP for commands.`, joinedEventId);
      } else await reply(joined ? onboardingCopy : invalidJoinCopy);
      return finish();
    }
    if (!memberships.length) { await reply(onboardingCopy); return finish(); }
    if (sender.messagingState !== "active") return finish();
    const scope = memberships[0]!.eventId;
    try {
      switch (command.type) {
        case "YES": case "NO": {
          const proposals = (await ctx.db.query("proposals").withIndex("by_target", (q) => q.eq("targetUserId", sender._id)).collect()).filter((p) => p.state === "pending" && memberships.some((m) => m.eventId === p.eventId) && (!p.requiresOrganizerApproval || p.organizerApprovedAt !== undefined));
          if (proposals.length === 1) {
            const proposal = proposals[0]!;
            await ctx.runMutation(internal.proposals.respond, { proposalId: proposal._id, actorId: sender._id, sourceMessageId: message._id, response: command.type === "YES" ? "accept" : "decline" });
            // Domain owns resulting notices; never infer success from model text.
          } else await reply(proposals.length ? "You have several pending offers. Ask the organizer to keep one offer open before replying YES or NO." : "You have no pending offer to answer.", scope);
          break;
        }
        case "STATUS": {
          const status = await ctx.runQuery(internal.domain.statusFor, { userId: sender._id });
          if (status.events.some((detail) => !memberships.some((m) => m.eventId === detail.event._id))) throw new Error("STATUS_SCOPE_VIOLATION");
          await reply(renderStatus({ events: status.events.map((detail) => ({ title: detail.event.title, tasks: detail.tasks.map((task) => ({ title: task.title, status: task.status, assigneeCount: task.activeAssigneeIds.length, pendingCount: detail.proposals.filter((p) => p.state === "pending" && p.targetTaskId === task._id).length })) })) }), scope);
          break;
        }
        case "LEAVE": {
          const events = await Promise.all(memberships.map(async (m) => ({ membership: m, event: await ctx.db.get(m.eventId) })));
          const matches = events.filter(({ event }) => event && (event._id === command.eventRef || event.title.toLowerCase() === command.eventRef.toLowerCase()));
          if (matches.length !== 1) { await reply("Please name one of your enrolled events exactly after LEAVE.", scope); break; }
          const { membership, event } = matches[0]!;
          // Organizer departure would orphan permissions; ask them to transfer
          // ownership through the domain workflow before leaving.
          if (membership.role === "organizer") { await reply("Transfer organizer responsibility before leaving this event.", membership.eventId); break; }
          await ctx.db.patch(membership._id, { state: "left", notificationsEnabled: false });
          await ctx.scheduler.runAfter(0, internal.proposals.cancelForUser, { userId: sender._id, eventId: membership.eventId, sourceMessageId: message._id, reason: "left" });
          const queued = await ctx.db.query("outboundMessages").withIndex("by_state", (q) => q.eq("state", "queued")).collect();
          for (const row of queued) if (row.recipientUserId === sender._id && row.eventId === membership.eventId) await ctx.db.patch(row._id, { state: "failed" });
          const organizers = (await ctx.db.query("memberships").withIndex("by_event", (q) => q.eq("eventId", membership.eventId)).collect()).filter((m) => m.role === "organizer" && m.state === "enrolled");
          for (const organizer of organizers) {
            const recipient = await ctx.db.get(organizer.userId);
            if (recipient?.messagingState === "active" && organizer.notificationsEnabled && organizer.consentAt !== undefined && organizer.consentSourceMessageId) {
              await ctx.runMutation(internal.outbox.enqueue, { idempotencyKey: `leave:${message._id}:${organizer.userId}`, recipientUserId: organizer.userId, eventId: membership.eventId, content: `${sender.displayName} left ${event!.title}. Existing commitments need organizer review.` });
            }
          }
          // Fixed acknowledgement, revalidated against this verified LEAVE.
          await reply("You've left that event. Rally will no longer send its notifications.");
          break;
        }
        default: {
          const pending = (await ctx.db.query("proposals").withIndex("by_target", (q) => q.eq("targetUserId", sender._id)).collect()).some((p) => p.state === "pending" && memberships.some((m) => m.eventId === p.eventId));
          if (pending && /^(maybe|probably)\b/iu.test(envelope.text.trim())) { await reply("No acceptance recorded. Please reply YES or NO.", scope); break; }
          const recent = await ctx.db.query("inboundMessages").withIndex("by_sender", (q) => q.eq("senderPhone", message.senderPhone)).order("desc").take(31);
          if (recent.filter((m) => m.receivedAt > Date.now() - 60_000).length > 30) { await reply("Too many requests. Please wait a minute before trying again.", scope); break; }
          const focus = await ctx.db.query("conversationFocus").withIndex("by_user", (q) => q.eq("userId", sender._id)).unique();
          const accessibleEvents = await Promise.all(memberships.map((membership) => ctx.db.get(membership.eventId)));
          const explicit = accessibleEvents.filter((event) => event && envelope.text.toLowerCase().includes(event.title.toLowerCase()));
          const eventId = explicit.length === 1 ? explicit[0]!._id : explicit.length > 1 ? undefined : focus && focus.expiresAt > Date.now() && memberships.some((m) => m.eventId === focus.lastEventId) ? focus.lastEventId : memberships.length === 1 ? scope : undefined;
          if (!eventId) { await reply("Which of your events is this about? Please include its name.", scope); break; }
          const event = await ctx.db.get(eventId);
          if (!event) throw new Error("EVENT_NOT_FOUND");
          const tasks = await ctx.db.query("tasks").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
          await ctx.runMutation(internal.reasoningJobs.enqueue, { messageId: message._id, eventId, contextVersion: event.version, taskVersions: tasks.map((task) => ({ taskId: task._id, version: task.version })) });
          await reply("I've queued your request for review. No assignment has changed yet.", eventId);
          break;
        }
      }
    } catch (error) {
      // A domain failure rolls back its nested call. Expose no private details
      // or model/provider assertions; retain failed processing for inspection.
      await ctx.db.patch(message._id, { processingState: "failed" });
      await reply(unavailableCopy, scope);
      return null;
    }
    return finish();
  },
});
