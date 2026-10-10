import { withPublicErrors } from "./lib/publicErrors";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import { proposalState, proposalType } from "./lib/validators";
import type { Infer } from "convex/values";
import { approveProposal, closeProposal, createProposal, respondProposal } from "./lib/proposalEngine";
import { evidence } from "./lib/domain";
import { memberFor, requireOrganizer } from "./lib/auth";
import { parseCommand } from "../packages/shared/commands";
import { PlanningInputSchema, rankCandidates } from "../packages/shared/planner";
import { audit, eligible, notifyOrganizers, priorRequest } from "./lib/domain";

/** Lane B: resolve originator from trusted evidence, verify role and all versions. */
export const create = internalMutation({
  args: {
    eventId: v.id("events"),
    originatorId: v.id("users"),
    sourceMessageId: v.id("inboundMessages"),
    type: proposalType,
    subjectId: v.optional(v.id("users")),
    targetTaskId: v.optional(v.id("tasks")),
    targetUserId: v.optional(v.id("users")),
    // JSON.parse + shared PROPOSE_TASK_CHANGE member schema before any write.
    taskChangeJson: v.optional(v.string()),
    expectedEventVersion: v.number(),
    expectedTaskVersion: v.optional(v.number()),
    expiresAt: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.id("proposals"),
  handler: async (ctx, args): Promise<Id<"proposals">> => {
    return createProposal(ctx, args);
  },
});

/** Lane B: actor must match the verified message sender and authorized target. */
export const respond = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    actorId: v.id("users"),
    sourceMessageId: v.id("inboundMessages"),
    response: v.union(v.literal("accept"), v.literal("decline")),
  },
  returns: proposalState,
  handler: async (ctx, args): Promise<Infer<typeof proposalState>> => {
    return respondProposal(ctx, args);
  },
});

/** Lane B: verify source sender's organizer role; approval is not acceptance. */
export const organizerApprove = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    actorId: v.id("users"),
    sourceMessageId: v.id("inboundMessages"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { text } = await evidence(ctx, args.actorId, args.sourceMessageId);
    if (text.trim() !== `APPROVE ${args.proposalId}`) throw new Error("INVALID_APPROVAL_EVIDENCE");
    return approveProposal(ctx, args.proposalId, args.actorId, args.sourceMessageId);
  },
});

/** Lane B: STOP/LEAVE from verified evidence cancels only the affected scope. */
export const cancelForUser = internalMutation({
  args: {
    userId: v.id("users"),
    eventId: v.optional(v.id("events")),
    sourceMessageId: v.id("inboundMessages"),
    reason: v.union(v.literal("stopped"), v.literal("left")),
  },
  returns: v.array(v.id("proposals")),
  handler: async (ctx, args): Promise<Id<"proposals">[]> => {
    const { user, text } = await evidence(ctx, args.userId, args.sourceMessageId), command = parseCommand(text);
    if (args.reason === "stopped") {
      if (user.messagingState !== "stopped" || command.type !== "STOP" || args.eventId) throw new Error("UNAUTHORIZED");
    } else {
      if (!args.eventId || command.type !== "LEAVE") throw new Error("UNAUTHORIZED");
      const member = await ctx.db.query("memberships").withIndex("by_event_user", q => q.eq("eventId", args.eventId!).eq("userId", args.userId)).unique();
      const event = await ctx.db.get(args.eventId);
      if (member?.state !== "left" || !event || command.eventRef !== event._id && command.eventRef.toLowerCase() !== event.title.toLowerCase()) throw new Error("UNAUTHORIZED");
    }
    const pending = (await ctx.db.query("proposals").withIndex("by_target", q => q.eq("targetUserId", args.userId)).collect()).filter(p => p.state === "pending" && (!args.eventId || p.eventId === args.eventId));
    for (const p of pending) await closeProposal(ctx, p, "canceled", "The participant stopped messages or left this event.", args.userId);
    return pending.map(p => p._id);
  },
});

/** Additive app approval path: ctx.auth and organizer role, never participant acceptance. */
export const approve = mutation({
  args: { proposalId: v.id("proposals") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => withPublicErrors(ctx, async () => {
    const p = await ctx.db.get(args.proposalId);
    if (!p) throw new Error("UNAUTHORIZED");
    const { user } = await requireOrganizer(ctx, p.eventId);
    return approveProposal(ctx, p._id, user._id, "authenticated-app");
  }),
});
export const expire = internalMutation({
  args: { proposalId: v.id("proposals") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const p = await ctx.db.get(args.proposalId);
    if (p?.state === "pending" && p.expiresAt <= Date.now()) await closeProposal(ctx, p, "expired", "This offer expired. Existing commitments are unchanged.");
    return null;
  },
});

/** Planner candidates require organizer approval even when the requester is an organizer. */
export const recommendReplacement = internalMutation({
  args: { eventId: v.id("events"), taskId: v.id("tasks"), actorId: v.id("users"), sourceMessageId: v.id("inboundMessages"), expectedEventVersion: v.number(), expectedTaskVersion: v.number() },
  returns: v.object({ participantId: v.union(v.id("users"), v.null()), proposalId: v.union(v.id("proposals"), v.null()), reasonCodes: v.array(v.string()) }),
  handler: async (ctx, args): Promise<{ participantId: Id<"users"> | null; proposalId: Id<"proposals"> | null; reasonCodes: string[] }> => {
    await evidence(ctx, args.actorId, args.sourceMessageId);
    if ((await memberFor(ctx, args.actorId, args.eventId)).membership.role !== "organizer") throw new Error("UNAUTHORIZED");
    const source = `planner:${args.sourceMessageId}:${args.taskId}:${args.expectedTaskVersion}`;
    const prior = await priorRequest<{ participantId: Id<"users"> | null; proposalId: Id<"proposals"> | null; reasonCodes: string[] }>(ctx, source, args); if (prior) return prior;
    const event = (await ctx.db.get(args.eventId))!, task = await ctx.db.get(args.taskId);
    if (!task || task.eventId !== event._id || event.version !== args.expectedEventVersion || task.version !== args.expectedTaskVersion) throw new Error("STALE_PLAN");
    const memberships = await ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", event._id)).collect();
    const users = await Promise.all(memberships.map(m => ctx.db.get(m.userId)));
    const tasks = await ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", event._id)).collect();
    const commitments = await ctx.db.query("commitments").withIndex("by_event", q => q.eq("eventId", event._id)).collect();
    const availability = (await Promise.all(memberships.map(m => ctx.db.query("availability").withIndex("by_event_user", q => q.eq("eventId", event._id).eq("userId", m.userId)).collect()))).flat();
    function plain<T extends { _id: string; _creationTime: number }>(doc: T) { const { _id, _creationTime: _, ...fields } = doc; return { id: _id, ...fields }; }
    const input = PlanningInputSchema.parse({ event: plain(event), task: plain(task), users: users.filter(u => u !== null).map(plain), memberships: memberships.map(plain), tasks: tasks.map(plain), commitments: commitments.map(plain), availability: availability.map(plain), now: Date.now() });
    const ranking = rankCandidates(input);
    let participantId: Id<"users"> | null = null;
    for (const candidate of ranking.candidates) if (await eligible(ctx, event, task, candidate.participantId as Id<"users">)) { participantId = candidate.participantId as Id<"users">; break; }
    const proposalId = participantId ? await createProposal(ctx, { eventId: event._id, originatorId: args.actorId, sourceMessageId: args.sourceMessageId, type: "assignment", targetTaskId: task._id, targetUserId: participantId, expectedEventVersion: event.version, expectedTaskVersion: task.version, expiresAt: Date.now() + 600000, idempotencyKey: source.slice(0, 128) }, true) : null;
    const result = { participantId, proposalId, reasonCodes: participantId ? ranking.reasonCodes : ["NO_ELIGIBLE_CANDIDATE"] };
    if (!participantId) await notifyOrganizers(ctx, event._id, `${event.title}: No eligible replacement was found for ${task.title}. It still needs coverage.`, `${source}:no-match`);
    await audit(ctx, event._id, args.actorId, "replacement_recommended", source, { input: args, result });
    return result;
  },
});
