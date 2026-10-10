import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { memberFor } from "./auth";
import { audit, canonicalJson, eligible, evidence, notify, notifyOrganizers, organizers, priorRequest } from "./domain";
import { ProposeTaskChangeActionSchema } from "../../packages/shared/agentDecision";
import { IdempotencyKeySchema } from "../../packages/shared/domain";
import { TimestampSchema, VersionSchema } from "../../packages/shared/primitives";
import { parseCommand } from "../../packages/shared/commands";

export interface CreateProposalArgs {
  eventId: Id<"events">; originatorId: Id<"users">; sourceMessageId: Id<"inboundMessages">;
  type: "assignment" | "reassignment" | "task_change"; subjectId?: Id<"users">; targetTaskId?: Id<"tasks">; targetUserId?: Id<"users">;
  taskChangeJson?: string; expectedEventVersion: number; expectedTaskVersion?: number; expiresAt: number; idempotencyKey: string;
}
function windowLabel(task: Doc<"tasks">, event: Doc<"events">): string {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: event.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return task.windowStart !== undefined && task.windowEnd !== undefined ? `${format.format(task.windowStart)}–${format.format(task.windowEnd)} (${event.timezone})` : "time to be confirmed";
}
export async function sendRequest(ctx: MutationCtx, proposal: Doc<"proposals">) {
  const task = await ctx.db.get(proposal.targetTaskId!), event = (await ctx.db.get(proposal.eventId))!;
  if (!task || !proposal.targetUserId) throw new Error("INVALID_PROPOSAL");
  const content = proposal.type === "task_change" ? `${event.title}: Please reconfirm ${task.title} with this proposed change: ${changeLabel(proposal.taskChangeJson!)}. Reply YES or NO. Current details remain unchanged until everyone accepts.` : `${event.title}: Could you cover ${task.title}, ${windowLabel(task, event)}? Reply YES or NO. No assignment has changed yet.`;
  await notify(ctx, proposal.targetUserId, proposal.eventId, content, `proposal:${proposal._id}:request:${proposal.targetUserId}`, proposal._id);
}
function changeLabel(json: string): string {
  const action = ProposeTaskChangeActionSchema.parse(JSON.parse(json));
  return action.field === "location" ? `location ${action.newValue}` : `time ${action.newValue.startsAt}–${action.newValue.endsAt}`;
}
export async function createProposal(ctx: MutationCtx, raw: CreateProposalArgs, forceApproval = false, expandGroup = true): Promise<Id<"proposals">> {
  const args = { ...raw, idempotencyKey: IdempotencyKeySchema.parse(raw.idempotencyKey), expectedEventVersion: VersionSchema.parse(raw.expectedEventVersion), ...(raw.expectedTaskVersion !== undefined ? { expectedTaskVersion: VersionSchema.parse(raw.expectedTaskVersion) } : {}), expiresAt: TimestampSchema.parse(raw.expiresAt) };
  await evidence(ctx, args.originatorId, args.sourceMessageId);
  const originator = await memberFor(ctx, args.originatorId, args.eventId);
  const source = `proposal-create:${args.originatorId}:${args.idempotencyKey}`;
  const input = { ...args, forceApproval };
  const prior = await priorRequest<Id<"proposals">>(ctx, source, input); if (prior) return prior;
  const event = (await ctx.db.get(args.eventId))!;
  if (event.status !== "scheduled" || event.version !== args.expectedEventVersion) throw new Error("STALE_EVENT");
  if (args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 86400000) throw new Error("INVALID_PROPOSAL_TTL");
  if (!args.targetTaskId || !args.targetUserId || args.expectedTaskVersion === undefined) throw new Error("INVALID_PROPOSAL");
  const task = await ctx.db.get(args.targetTaskId);
  if (!task || task.eventId !== event._id || task.version !== args.expectedTaskVersion) throw new Error("STALE_TASK");
  const commitments = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
  let taskChangeJson: string | undefined;
  if (args.type === "task_change") {
    if (originator.membership.role !== "organizer" || !args.taskChangeJson || args.subjectId) throw new Error("UNAUTHORIZED");
    const action = ProposeTaskChangeActionSchema.parse(JSON.parse(args.taskChangeJson));
    if (action.taskRef !== task._id && action.taskRef.toLowerCase() !== task.title.toLowerCase()) throw new Error("INVALID_TASK_REFERENCE");
    taskChangeJson = canonicalJson(action);
    const affected = commitments.map(c => c.participantId);
    if (affected.length ? !affected.includes(args.targetUserId) : args.targetUserId !== args.originatorId) throw new Error("INVALID_CHANGE_TARGET");
    // One grouped offer per active assignee; all must reconfirm the same snapshot.
    if (!await eligible(ctx, event, task, args.targetUserId, true)) throw new Error("INELIGIBLE_TARGET");
  } else {
    if (args.taskChangeJson) throw new Error("INVALID_PROPOSAL");
    if (!await eligible(ctx, event, task, args.targetUserId)) throw new Error("INELIGIBLE_TARGET");
    if (args.type === "reassignment") {
      if (!args.subjectId || args.subjectId === args.targetUserId || !commitments.some(c => c.participantId === args.subjectId)) throw new Error("INVALID_REPLACEMENT");
    } else if (args.subjectId || commitments.length >= task.capacity) throw new Error("TASK_FULL");
  }
  const requiresOrganizerApproval = forceApproval || (originator.membership.role !== "organizer" && args.targetUserId !== args.originatorId);
  const fields = { eventId: args.eventId, type: args.type, originatorId: args.originatorId, ...(args.subjectId ? { subjectId: args.subjectId } : {}), targetTaskId: task._id, targetUserId: args.targetUserId, ...(taskChangeJson ? { taskChangeJson } : {}), state: "pending" as const, requiresOrganizerApproval, eventVersionAtCreation: event.version, taskVersionAtCreation: task.version, expiresAt: args.expiresAt, idempotencyKey: args.idempotencyKey };
  const proposalId = await ctx.db.insert("proposals", fields);
  await audit(ctx, event._id, args.originatorId, "proposal_created", source, { input, result: proposalId });
  await ctx.scheduler.runAt(args.expiresAt, internal.proposals.expire, { proposalId });
  if (requiresOrganizerApproval) await notifyOrganizers(ctx, event._id, `${event.title}: Organizer approval is needed before asking a participant to cover ${task.title}. Proposal ${proposalId}.`, `proposal:${proposalId}:approval`, proposalId);
  else await sendRequest(ctx, (await ctx.db.get(proposalId))!);
  if (args.type === "task_change" && expandGroup) {
    for (const commitment of commitments.filter(c => c.participantId !== args.targetUserId)) {
      const siblingKey = `${args.idempotencyKey.slice(0, 70)}:change:${commitment.participantId}`;
      await createProposal(ctx, { ...args, targetUserId: commitment.participantId, idempotencyKey: siblingKey }, false, false);
    }
  }
  return proposalId;
}
export async function approveProposal(ctx: MutationCtx, proposalId: Id<"proposals">, actorId: Id<"users">, source: string): Promise<null> {
  const p = await ctx.db.get(proposalId);
  if (!p) throw new Error("UNAUTHORIZED");
  if ((await memberFor(ctx, actorId, p.eventId)).membership.role !== "organizer") throw new Error("UNAUTHORIZED");
  if (p.state !== "pending") return null;
  const event = (await ctx.db.get(p.eventId))!, task = p.targetTaskId ? await ctx.db.get(p.targetTaskId) : null;
  if (!task || p.expiresAt <= Date.now() || event.version !== p.eventVersionAtCreation || task.version !== p.taskVersionAtCreation || event.status !== "scheduled") { await closeProposal(ctx, p, "expired", "This offer changed before organizer approval.", actorId); return null; }
  if (!p.requiresOrganizerApproval || p.organizerApprovedAt !== undefined) return null;
  await ctx.db.patch(p._id, { organizerApprovedAt: Date.now() });
  await audit(ctx, p.eventId, actorId, "organizer_approved", `proposal:${p._id}:organizer-approved`, { source });
  await sendRequest(ctx, (await ctx.db.get(p._id))!);
  return null;
}
async function group(ctx: MutationCtx, p: Doc<"proposals">) {
  const all = await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", p.eventId)).collect();
  return all.filter(q => q.type === "task_change" && q.targetTaskId === p.targetTaskId && q.originatorId === p.originatorId && q.taskVersionAtCreation === p.taskVersionAtCreation && q.eventVersionAtCreation === p.eventVersionAtCreation && q.taskChangeJson === p.taskChangeJson && q.expiresAt === p.expiresAt);
}
export async function closeProposal(ctx: MutationCtx, p: Doc<"proposals">, state: "expired" | "superseded" | "canceled" | "declined", explanation: string, actorId?: Id<"users">, messageId?: Id<"inboundMessages">) {
  if (p.state !== "pending") return;
  await ctx.db.patch(p._id, { state });
  await audit(ctx, p.eventId, actorId, `proposal_${state}`, `proposal:${p._id}:closed`, { state }, "pending");
  const task = p.targetTaskId ? await ctx.db.get(p.targetTaskId) : null;
  const content = `${task?.title ?? "Offer"}: ${explanation} No new assignment was made from this offer.`;
  const recipients = new Set([p.originatorId, ...(p.targetUserId ? [p.targetUserId] : [])]);
  for (const recipient of recipients) await notify(ctx, recipient, p.eventId, content, `proposal:${p._id}:closed:${recipient}`, p._id, recipient === actorId ? messageId : undefined);
}
interface ResponseArgs { proposalId: Id<"proposals">; actorId: Id<"users">; sourceMessageId: Id<"inboundMessages">; response: "accept" | "decline" }
export async function respondProposal(ctx: MutationCtx, args: ResponseArgs): Promise<Doc<"proposals">["state"]> {
  const { text, message } = await evidence(ctx, args.actorId, args.sourceMessageId);
  const command = parseCommand(text);
  if (command.type !== (args.response === "accept" ? "YES" : "NO")) throw new Error("INVALID_RESPONSE_EVIDENCE");
  const p = await ctx.db.get(args.proposalId);
  if (!p || p.targetUserId !== args.actorId) throw new Error("UNAUTHORIZED");
  await memberFor(ctx, args.actorId, p.eventId);
  const source = `proposal-response:${args.sourceMessageId}`;
  const prior = await priorRequest<Doc<"proposals">["state"]>(ctx, source, args); if (prior) return prior;
  if (message.receivedAt < Math.floor(p._creationTime)) throw new Error("RESPONSE_PREDATES_PROPOSAL");
  const result = await applyResponse(ctx, args, p);
  await audit(ctx, p.eventId, args.actorId, "proposal_response_recorded", source, { input: args, result });
  return result;
}
async function applyResponse(ctx: MutationCtx, args: ResponseArgs, p: Doc<"proposals">): Promise<Doc<"proposals">["state"]> {
  if (p.state !== "pending") return p.state;
  if (p.requiresOrganizerApproval && p.organizerApprovedAt === undefined) throw new Error("ORGANIZER_APPROVAL_REQUIRED");
  const event = (await ctx.db.get(p.eventId))!, task = p.targetTaskId ? await ctx.db.get(p.targetTaskId) : null;
  if (p.expiresAt <= Date.now() || event.status !== "scheduled" || event.version !== p.eventVersionAtCreation || !task || task.eventId !== p.eventId || task.version !== p.taskVersionAtCreation) {
    await closeProposal(ctx, p, "expired", "This offer expired or its details changed. Ask for a new offer.", args.actorId, args.sourceMessageId); return "expired";
  }
  if (args.response === "decline") {
    await closeProposal(ctx, p, "declined", "The participant declined. Existing commitments are unchanged.", args.actorId, args.sourceMessageId);
    if (p.type === "task_change") for (const q of await group(ctx, p)) if (q._id !== p._id) await closeProposal(ctx, q, "canceled", "The proposed change did not receive every participant's approval.");
    return "declined";
  }
  if (!await eligible(ctx, event, task, args.actorId, p.type === "task_change")) { await closeProposal(ctx, p, "canceled", "The participant is no longer eligible for these details.", args.actorId, args.sourceMessageId); return "canceled"; }
  const active = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
  if (p.type === "task_change") {
    const siblings = await group(ctx, p);
    if (siblings.some(q => q._id !== p._id && (q.state !== "accepted" && q.state !== "pending" || q.expiresAt <= Date.now()))) { await closeProposal(ctx, p, "canceled", "The proposed change is no longer valid."); return "canceled"; }
    await ctx.db.patch(p._id, { state: "accepted" });
    await audit(ctx, p.eventId, args.actorId, "task_change_approved", `proposal:${p._id}:accepted`, { sourceMessageId: args.sourceMessageId });
    const needed = active.length ? active.map(c => c.participantId) : [p.originatorId];
    if (!needed.every(id => siblings.some(q => q.targetUserId === id && (q._id === p._id || q.state === "accepted")))) {
      await notify(ctx, args.actorId, p.eventId, `Your approval for ${task.title} is recorded. Current details remain unchanged while other approvals are pending.`, `proposal:${p._id}:accepted:${args.actorId}`, p._id, args.sourceMessageId); return "accepted";
    }
    const action = ProposeTaskChangeActionSchema.parse(JSON.parse(p.taskChangeJson!));
    const changes = action.field === "location" ? { location: action.newValue } : { windowStart: Date.parse(action.newValue.startsAt), windowEnd: Date.parse(action.newValue.endsAt) };
    const proposedTask = { ...task, ...changes };
    for (const id of needed) if (!await eligible(ctx, event, proposedTask, id, true)) throw new Error("CHANGE_CONFLICT");
    const downstream = (await ctx.db.query("tasks").withIndex("by_event", q => q.eq("eventId", event._id)).collect()).filter(t => t.status !== "canceled" && t.dependsOnTaskIds?.includes(task._id));
    if (downstream.some(t => t.windowStart === undefined || proposedTask.windowEnd === undefined || proposedTask.windowEnd > t.windowStart)) throw new Error("CHANGE_DEPENDENCY_CONFLICT");
    await ctx.db.patch(task._id, { ...changes, version: task.version + 1 });
    await audit(ctx, p.eventId, args.actorId, "task_change_committed", `task-change:${siblings.map(q => q._id).sort().join(":")}`, { taskId: task._id, version: task.version + 1 });
    for (const id of new Set([...needed, ...(await organizers(ctx, p.eventId)).map(m => m.userId)])) await notify(ctx, id, p.eventId, `${event.title}: Everyone accepted the change to ${task.title}. ${changeLabel(p.taskChangeJson!)}. The task details are updated.`, `task-change:${p._id}:committed:${id}`, p._id, id === args.actorId ? args.sourceMessageId : undefined);
  } else {
    const previous = p.type === "reassignment" ? active.find(c => c.participantId === p.subjectId) : undefined;
    if (p.type === "reassignment" && !previous || active.length - Number(!!previous) >= task.capacity) { await closeProposal(ctx, p, "superseded", "Another acceptance filled this slot.", args.actorId, args.sourceMessageId); return "superseded"; }
    if (previous) await ctx.db.patch(previous._id, { state: "released", endedAt: Date.now(), endedByActorId: args.actorId });
    await ctx.db.insert("commitments", { eventId: p.eventId, taskId: task._id, participantId: args.actorId, state: "active", sourceProposalId: p._id, sourceMessageId: args.sourceMessageId, createdAt: Date.now() });
    await ctx.db.patch(p._id, { state: "accepted" });
    const count = active.length + 1 - Number(!!previous);
    await ctx.db.patch(task._id, { status: count >= task.capacity ? "confirmed" : "needs_coverage", version: task.version + 1 });
    await audit(ctx, p.eventId, args.actorId, "assignment_committed", `proposal:${p._id}:accepted`, { taskId: task._id, sourceMessageId: args.sourceMessageId, releasedCommitmentId: previous?._id }, "pending");
    const target = (await ctx.db.get(args.actorId))!;
    const recipients = new Set([args.actorId, ...(previous ? [previous.participantId] : []), ...(await organizers(ctx, p.eventId)).map(m => m.userId)]);
    for (const id of recipients) await notify(ctx, id, p.eventId, `${event.title}: ${target.displayName} accepted ${task.title}, ${windowLabel(task, event)}. I've updated the assignment.${previous?.participantId === id ? " Your previous commitment is released." : ""}`, `proposal:${p._id}:accepted:${id}`, p._id, id === args.actorId ? args.sourceMessageId : undefined);
  }
  const competing = (await ctx.db.query("proposals").withIndex("by_event", q => q.eq("eventId", p.eventId)).collect()).filter(q => q._id !== p._id && q.targetTaskId === task._id && q.state === "pending" && q.taskVersionAtCreation === task.version);
  const current = (await ctx.db.query("commitments").withIndex("by_task", q => q.eq("taskId", task._id)).collect()).filter(c => c.state === "active");
  for (const q of competing) {
    if (p.type === "assignment" && q.type === "assignment" && current.length < task.capacity && q.targetUserId && !current.some(c => c.participantId === q.targetUserId)) await ctx.db.patch(q._id, { taskVersionAtCreation: task.version + 1 });
    else await closeProposal(ctx, q, "superseded", "Another acceptance changed this task. Ask for a new offer.");
  }
  return "accepted";
}
