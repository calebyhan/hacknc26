import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { openEnvelope, senderFor } from "./lib/messaging";
import { buildContextPacket, resolveEvent } from "../packages/shared/context";
import type { ContextPendingProposal } from "../packages/shared/contextPacket";
import { parseCommand } from "../packages/shared/commands";
import { taskInstruction } from "./lib/taskInstructions";

function plain<T extends { _id: string; _creationTime: number }>(doc: T) {
  const { _id, _creationTime: _unused, ...fields } = doc;
  return { ...fields, id: _id };
}

/** Reused by enqueue, claim and completion; all authority comes from storage. */
export async function readSourceContext(ctx: QueryCtx, messageId: Doc<"reasoningJobs">["messageId"]) {
  const message = await ctx.db.get(messageId);
  if (!message || message.provider !== "spectrum" || message.contentType !== "text/plain" || Date.now() - message.receivedAt > 15 * 60_000) throw new Error("INVALID_JOB_SOURCE");
  const user = await senderFor(ctx, message);
  if (!user || user.messagingState !== "active") throw new Error("SENDER_NOT_PERMITTED");
  const envelope = await openEnvelope(message);
  if (parseCommand(envelope.text).type !== "UNKNOWN") throw new Error("COMMAND_REQUIRES_NO_MODEL");
  const instruction = await taskInstruction(ctx, message, user);
  const memberships = (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()).filter((m) => m.state === "enrolled");
  const consented = [];
  for (const membership of memberships) {
    const consent = membership.consentSourceMessageId ? await ctx.db.get(membership.consentSourceMessageId) : null;
    if (membership.consentAt !== undefined && consent && consent.senderPhone === user.verifiedPhoneE164 && consent.provider === "spectrum") consented.push(membership);
  }
  const events = (await Promise.all(consented.map((m) => ctx.db.get(m.eventId)))).filter((event): event is Doc<"events"> => event !== null && !["canceled", "completed"].includes(event.status));
  if (events.length > 20) throw new Error("CONTEXT_TOO_LARGE");
  const focus = await ctx.db.query("conversationFocus").withIndex("by_user", (q) => q.eq("userId", user._id)).unique();
  const eventTasks = (await Promise.all(events.map((event) => ctx.db.query("tasks").withIndex("by_event", (q) => q.eq("eventId", event._id)).collect()))).flat();
  const proposalDocs = (await ctx.db.query("proposals").withIndex("by_target", (q) => q.eq("targetUserId", user._id)).collect()).filter((p) => p.state === "pending" && p.expiresAt > Date.now() && (!p.requiresOrganizerApproval || p.organizerApprovedAt !== undefined) && events.some((event) => event._id === p.eventId && event.version === p.eventVersionAtCreation) && p.targetTaskId && eventTasks.some(task => task._id === p.targetTaskId && task.eventId === p.eventId && task.version === p.taskVersionAtCreation && !["completed", "canceled"].includes(task.status)));
  const pending: ContextPendingProposal[] = proposalDocs.map((p) => ({ id: p._id, eventId: p.eventId, targetUserId: user._id, type: p.type, expiresAt: new Date(p.expiresAt).toISOString(), eventVersionAtCreation: p.eventVersionAtCreation, ...(p.targetTaskId ? { targetTaskId: p.targetTaskId } : {}), ...(p.taskVersionAtCreation === undefined ? {} : { taskVersionAtCreation: p.taskVersionAtCreation }) }));
  const resolution = resolveEvent({ senderUserId: user._id, incomingText: instruction.text, events: events.map(plain), memberships: consented.map(plain), tasks: eventTasks.map(plain), pendingProposalsForSender: pending, recentFocus: focus?.lastEventId ? { eventId: focus.lastEventId, expiresAt: focus.expiresAt } : null, now: Date.now() });
  if (instruction.selectedTaskId) {
    const task = eventTasks.find(item => item._id === instruction.selectedTaskId);
    if (!task) throw new Error("EVENT_NOT_PERMITTED");
    resolution.selectedEventId = task.eventId;
    resolution.candidateIds = [task.eventId];
    resolution.requiresClarification = false;
    resolution.reasonCodes = ["VERIFIED_TASK_CLARIFICATION"];
  }
  return { message, user, envelope, instruction, consented, events, focus, pending, eventTasks, resolution };
}

/** The router and queue use the same resolver; an ambiguous request stays unscoped. */
export async function resolveMessageJob(ctx: QueryCtx, messageId: Doc<"reasoningJobs">["messageId"]) {
  const { events, eventTasks, resolution } = await readSourceContext(ctx, messageId);
  const selected = events.find(event => event._id === resolution.selectedEventId);
  return { messageId, eventId: selected?._id ?? null, contextVersion: selected?.version ?? null, taskVersions: selected ? eventTasks.filter(task => task.eventId === selected._id).map(task => ({ taskId: task._id, version: task.version })) : [] };
}

export async function readJobContext(ctx: QueryCtx, job: Pick<Doc<"reasoningJobs">, "messageId" | "eventId" | "contextVersion" | "taskVersions">) {
  const { message, user, instruction, consented, events, focus, pending, eventTasks, resolution } = await readSourceContext(ctx, job.messageId);
  const selected = job.eventId ? events.find((event) => event._id === job.eventId) : null;
  const membership = selected ? consented.find((m) => m.eventId === selected._id) : undefined;
  if (job.eventId) {
    if (!selected || !membership) throw new Error("EVENT_NOT_PERMITTED");
    if (resolution.selectedEventId !== job.eventId) throw new Error("EVENT_REQUIRES_CLARIFICATION");
    if (job.contextVersion !== selected.version) throw new Error("STALE_CONTEXT");
  } else if (job.contextVersion !== null || job.taskVersions.length || resolution.selectedEventId !== null) throw new Error("INVALID_UNSCOPED_JOB");
  const tasks = selected ? eventTasks.filter((task) => task.eventId === selected._id) : [];
  if (new Set(job.taskVersions.map((item) => item.taskId)).size !== job.taskVersions.length || tasks.length !== job.taskVersions.length || job.taskVersions.some((item) => !tasks.some((task) => task._id === item.taskId && task.version === item.version))) throw new Error("STALE_TASKS");
  const commitments = selected ? await ctx.db.query("commitments").withIndex("by_event", (q) => q.eq("eventId", selected._id)).collect() : [];
  const participants: Doc<"users">[] = [], participantMemberships: Doc<"memberships">[] = [];
  if (selected) {
    const members = await ctx.db.query("memberships").withIndex("by_event", q => q.eq("eventId", selected._id)).collect();
    for (const member of members) {
      if (member.state !== "enrolled" || member.consentAt === undefined || !member.consentSourceMessageId) continue;
      const participant = await ctx.db.get(member.userId), consent = await ctx.db.get(member.consentSourceMessageId);
      if (!participant?.verifiedPhoneE164 || !consent || consent.provider !== "spectrum" || consent.senderPhone !== participant.verifiedPhoneE164) continue;
      participants.push(participant); participantMemberships.push(member);
    }
  }
  const packet = buildContextPacket({ messageId: message._id, sender: plain(user), senderRole: membership?.role ?? "member", incomingText: instruction.text, currentTime: Date.now(), selectedTaskId: instruction.selectedTaskId, recentTaskFocusId: focus && focus.expiresAt > Date.now() ? focus.lastTaskId ?? null : null, selectedEvent: selected ? plain(selected) : null, candidateEvents: events.filter((event) => resolution.candidateIds.includes(event._id)).map(plain), relevantTasks: tasks.map(plain), commitments: commitments.map(plain), participants: participants.map(plain), memberships: participantMemberships.map(plain), pendingProposalsForSender: pending, recentEventFocusId: focus && focus.expiresAt > Date.now() ? focus.lastEventId ?? null : null });
  return { packet, user, message, membership };
}

const result = v.object({ packetJson: v.string() });

/**
 * Lane C: derive verified sender and authorized scope from job/message. Serialize
 * only a minimal packet validated with shared ContextPacketSchema; never include
 * other events' private messages, phone numbers or entire contact selections.
 */
export const buildPacket = internalQuery({
  args: { jobId: v.id("reasoningJobs") },
  returns: result,
  handler: async (ctx, args): Promise<Infer<typeof result>> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !["queued", "claimed"].includes(job.status)) throw new Error("JOB_NOT_AVAILABLE");
    const { packet } = await readJobContext(ctx, job);
    return { packetJson: JSON.stringify(packet) };
  },
});
