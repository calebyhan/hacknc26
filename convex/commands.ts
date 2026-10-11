import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { openEnvelope, senderFor } from "./lib/messaging";
import { parseCommand, proposalReferenceMatches } from "../packages/shared/commands";
import { controlCopy, helpCopy, invalidJoinCopy, onboardingCopy, unavailableCopy, phoneLinkProofCopy } from "../packages/shared/copy";
import { renderStatusDetails } from "./lib/statusText";
import { routeTaskClarification } from "./lib/taskClarification";
import { proposalReplyReference } from "./lib/proposalEngine";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveMessageJob } from "./context";
import { phoneSetupErrorCopy } from "../packages/shared/phoneSetup";

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
    let phoneLinkProof = false;
    if (command.type === "JOIN" && /^[a-f\d]{32}$/iu.test(command.code)) {
      const result = await ctx.runMutation(internal.invitations.redeem, { messageId: message._id, code: command.code });
      if ("phoneLinkProof" in result) phoneLinkProof = true;
      else if (result.redeemed) {
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
    const enrolled = (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", sender._id)).collect()).filter((m) => m.state === "enrolled");
    const memberships: Doc<"memberships">[] = [];
    for (const membership of enrolled) {
      const consent = membership.consentSourceMessageId ? await ctx.db.get(membership.consentSourceMessageId) : null;
      if (membership.consentAt !== undefined && consent?.provider === "spectrum" && consent.senderPhone === sender.verifiedPhoneE164) memberships.push(membership);
    }
    const reply = async (content: string, eventId?: Id<"events">, suffix = "reply") => {
      await ctx.runMutation(internal.outbox.enqueue, { idempotencyKey: `inbound:${message._id}:${suffix}`, recipientUserId: sender._id, content, directReplyToMessageId: message._id, ...(eventId ? { eventId } : {}) });
    };
    const finish = async () => { await ctx.db.patch(message._id, { processingState: "processed" }); return null; };
    if (command.type === "STOP" || command.type === "PAUSE" || command.type === "RESUME") {
      const state = command.type === "STOP" ? "stopped" : command.type === "PAUSE" ? "paused" : "active";
      await ctx.runMutation(internal.identity.setMessagingState, { messageId: message._id, state });
      await reply(controlCopy[state]);
      return finish();
    }
    if (command.type === "UNKNOWN" || (command.type === "JOIN" && !/^[a-f\d]{32}$/iu.test(command.code))) {
      if (sender.messagingState !== "active") return finish();
      try {
        if (await ctx.runMutation(internal.phoneSetup.execute, { messageId: message._id })) return finish();
      } catch { await reply(phoneSetupErrorCopy); return finish(); }
    }
    if (command.type === "HELP") { await reply(helpCopy); return finish(); }
    if (command.type === "JOIN") {
      if (phoneLinkProof) { await reply(phoneLinkProofCopy); return finish(); }
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
        case "YES": case "NO": case "CONFIRM_OVERLAP": {
          const proposals = (await ctx.db.query("proposals").withIndex("by_target", (q) => q.eq("targetUserId", sender._id)).collect()).filter((p) => p.state === "pending" && memberships.some((m) => m.eventId === p.eventId) && (!p.requiresOrganizerApproval || p.organizerApprovedAt !== undefined));
          // Match current snapshot-valid offers, like domain.statusFor does.
          // A stale row waiting for its expiry job must not hide one valid offer.
          const checked = await Promise.all(proposals.map(async proposal => {
            const event = await ctx.db.get(proposal.eventId);
            const task = proposal.targetTaskId ? await ctx.db.get(proposal.targetTaskId) : null;
            const valid = proposal.expiresAt > Date.now() && event?.status === "scheduled" && event.version === proposal.eventVersionAtCreation && task?.eventId === event._id && task.version === proposal.taskVersionAtCreation && task.status !== "completed" && task.status !== "canceled";
            return { proposal, task, event, valid };
          }));
          const candidates = checked.filter(item => !command.proposalRef || proposalReferenceMatches(command.proposalRef, item.proposal._id, item.task?.title, item.event?.title));
          const current = candidates.filter(item => item.valid).map(item => item.proposal);
          const proposal = current.length === 1 ? current[0] : current.length === 0 && candidates.length === 1 ? candidates[0]!.proposal : undefined;
          if (proposal) {
            await ctx.runMutation(internal.proposals.respond, { proposalId: proposal._id, actorId: sender._id, sourceMessageId: message._id, response: command.type === "NO" ? "decline" : "accept" });
            // Domain owns resulting notices; never infer success from model text.
          } else {
            const valid = checked.filter(item => item.valid);
            const choices = await Promise.all(valid.map(async item => {
              const ref = await proposalReplyReference(ctx, sender._id, item.proposal._id);
              return `${item.task!.title}: ${command.type === "CONFIRM_OVERLAP" ? "CONFIRM OVERLAP" : "YES"} ${ref}`;
            }));
            await reply(choices.length ? `Which offer? ${choices.join("; ")}. You can also reply NO followed by the same reference. Nothing changed.` : proposals.length ? "Your offers expired or changed. Ask the organizer for a new offer." : "You have no pending offer to answer.", scope);
          }
          break;
        }
        case "STATUS": {
          const status = await ctx.runQuery(internal.domain.statusFor, { userId: sender._id });
          if (status.events.some((detail) => !enrolled.some((m) => m.eventId === detail.event._id))) throw new Error("STATUS_SCOPE_VIOLATION");
          const consented = status.events.filter(detail => memberships.some(m => m.eventId === detail.event._id));
          await reply(renderStatusDetails(consented), scope);
          break;
        }
        case "LEAVE": {
          const events = await Promise.all(memberships.map(async (m) => ({ membership: m, event: await ctx.db.get(m.eventId) })));
          const matches = events.filter(({ event }) => event && (event._id === command.eventRef || event.title.toLowerCase() === command.eventRef.toLowerCase()));
          if (matches.length !== 1) { await reply("Use LEAVE followed by an exact event name or event ID, not a JOIN code. Text STATUS to check your events.", scope); break; }
          const { membership, event } = matches[0]!;
          // Organizer departure would orphan permissions; ask them to transfer
          // ownership through the domain workflow before leaving.
          if (membership.role === "organizer") { await reply("Transfer organizer responsibility before leaving this event.", membership.eventId); break; }
          await ctx.db.patch(membership._id, { state: "left", notificationsEnabled: false });
          await ctx.runMutation(internal.proposals.cancelForUser, { userId: sender._id, eventId: membership.eventId, sourceMessageId: message._id, reason: "left" });
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
          const clarification = await routeTaskClarification(ctx, message._id);
          if (clarification) { await reply(clarification.content, clarification.eventId); break; }
          const job = await resolveMessageJob(ctx, message._id);
          if (!job.eventId) { await reply("Which of your events is this about? Please include its name or event ID. Text STATUS to distinguish events with the same name.", scope); break; }
          await ctx.runMutation(internal.reasoningJobs.enqueue, job);
          await reply("Got it. I’ll check the plan.", job.eventId);
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
