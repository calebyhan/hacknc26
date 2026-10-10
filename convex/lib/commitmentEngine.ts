import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { audit, evidence, notify, notifyOrganizers, priorRequest } from "./domain";
import { memberFor } from "./auth";
import { overlaps } from "../../packages/shared/planner";
import { TimestampSchema, VersionSchema } from "../../packages/shared/primitives";
import { closeProposal } from "./proposalEngine";

export interface UnavailableArgs {
  eventId: Id<"events">; actorId: Id<"users">; participantId: Id<"users">; taskId?: Id<"tasks">;
  window?: { startsAt: number; endsAt: number }; sourceMessageId: Id<"inboundMessages">; expectedEventVersion: number;
}
export async function reportUnavailable(ctx: MutationCtx, args: UnavailableArgs): Promise<Id<"commitments">[]> {
  const { text } = await evidence(ctx, args.actorId, args.sourceMessageId);
  const actor = await memberFor(ctx, args.actorId, args.eventId);
  await memberFor(ctx, args.participantId, args.eventId);
  if (args.actorId !== args.participantId && actor.membership.role !== "organizer") throw new Error("UNAUTHORIZED");
  const participant = (await ctx.db.get(args.participantId))!;
  const normalized = text.replace(/[’‘]/gu, "'");
  const explicitSelf = /\b(?:I\s+(?:can't|cannot|won't|am\s+(?:unavailable|not available))|I'm\s+(?:unavailable|not available)|cancel\s+my)\b/iu.test(normalized);
  if (!/\b(?:can't|cannot|unavailable|not available|won't|cancel)\b/iu.test(normalized) || (args.actorId === args.participantId ? !explicitSelf : !normalized.toLowerCase().includes(participant.displayName.toLowerCase()))) throw new Error("UNAVAILABILITY_EVIDENCE_REQUIRED");
  const source = `unavailable:${args.sourceMessageId}:${args.eventId}:${args.participantId}:${args.taskId ?? "all"}`;
  const prior = await priorRequest<Id<"commitments">[]>(ctx, source, args); if (prior) return prior;
  const event = (await ctx.db.get(args.eventId))!;
  if (event.version !== VersionSchema.parse(args.expectedEventVersion) || event.status !== "scheduled") throw new Error("STALE_EVENT");
  if (args.taskId) { const task = await ctx.db.get(args.taskId); if (!task || task.eventId !== event._id) throw new Error("UNAUTHORIZED"); }
  if (args.window) { TimestampSchema.parse(args.window.startsAt); TimestampSchema.parse(args.window.endsAt); if (args.window.endsAt <= args.window.startsAt) throw new Error("INVALID_WINDOW"); }
  const commitments = (await ctx.db.query("commitments").withIndex("by_participant", q => q.eq("participantId", args.participantId)).collect()).filter(c => c.state === "active" && c.eventId === args.eventId && (!args.taskId || c.taskId === args.taskId));
  const changed: Id<"commitments">[] = [];
  for (const c of commitments) {
    const task = await ctx.db.get(c.taskId); if (!task) throw new Error("INVALID_COMMITMENT");
    if (args.window && task.windowStart !== undefined && task.windowEnd !== undefined && !overlaps(args.window.startsAt, args.window.endsAt, task.windowStart, task.windowEnd)) continue;
    const state = args.actorId === args.participantId ? "canceled_by_participant" : "released";
    await ctx.db.patch(c._id, { state, endedAt: Date.now(), endedByActorId: args.actorId });
    await ctx.db.patch(task._id, { status: "needs_coverage", version: task.version + 1 });
    await audit(ctx, args.eventId, args.actorId, state === "released" ? "organizer_unavailability_override" : "self_canceled", `${source}:${c._id}`, { commitmentId: c._id, state, sourceMessageId: args.sourceMessageId }, "active");
    const pending = (await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", args.eventId)).collect()).filter(p => p.state === "pending" && p.targetTaskId === task._id);
    for (const p of pending) await closeProposal(ctx, p, "superseded", "The task changed after a cancellation. Ask for a new offer.");
    const participant = (await ctx.db.get(args.participantId))!;
    await notifyOrganizers(ctx, args.eventId, `${event.title}: ${participant.displayName} is no longer assigned to ${task.title}. It needs coverage.`, `${source}:${c._id}:organizer`);
    if (args.actorId !== args.participantId) await notify(ctx, args.participantId, args.eventId, `${event.title}: The organizer released your commitment to ${task.title} after reporting you unavailable.`, `${source}:${c._id}:participant`);
    changed.push(c._id);
  }
  if (args.window) await ctx.db.insert("availability", { eventId: args.eventId, userId: args.participantId, windowStart: args.window.startsAt, windowEnd: args.window.endsAt, kind: "unavailable", source: args.actorId === args.participantId ? "self_reported" : "organizer_reported", reportedByUserId: args.actorId, sourceMessageId: args.sourceMessageId, recordedAt: Date.now() });
  await audit(ctx, args.eventId, args.actorId, "unavailability_recorded", source, { input: args, result: changed });
  return changed;
}
