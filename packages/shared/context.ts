import { z } from "zod";
import { ContextPacketSchema, ContextPendingProposalSchema, type ContextPacket } from "./contextPacket";
import { CommitmentSchema, EventSchema, MembershipSchema, TaskSchema, UserSchema } from "./domain";
import { IdentifierSchema, MemberRoleSchema, TimestampSchema } from "./primitives";

export const EventResolutionInputSchema = z.strictObject({
  senderUserId: IdentifierSchema,
  incomingText: z.string(),
  events: z.array(EventSchema),
  memberships: z.array(MembershipSchema),
  tasks: z.array(TaskSchema),
  pendingProposalsForSender: z.array(ContextPendingProposalSchema),
  recentFocus: z.strictObject({ eventId: IdentifierSchema, expiresAt: TimestampSchema }).nullable(),
  now: TimestampSchema,
});
export const EventResolutionSchema = z.strictObject({
  selectedEventId: IdentifierSchema.nullable(),
  candidateIds: z.array(IdentifierSchema),
  requiresClarification: z.boolean(),
  reasonCodes: z.array(z.string()),
});
export const ContextBuildInputSchema = z.strictObject({
  messageId: IdentifierSchema,
  sender: UserSchema,
  senderRole: MemberRoleSchema,
  incomingText: z.string(),
  selectedEvent: EventSchema.nullable(),
  candidateEvents: z.array(EventSchema),
  relevantTasks: z.array(TaskSchema),
  commitments: z.array(CommitmentSchema),
  pendingProposalsForSender: z.array(ContextPendingProposalSchema),
  recentEventFocusId: IdentifierSchema.nullable(),
});
export type EventResolutionInput = z.infer<typeof EventResolutionInputSchema>;
export type EventResolution = z.infer<typeof EventResolutionSchema>;
export type ContextBuildInput = z.infer<typeof ContextBuildInputSchema>;

/** Match whole names, never a fragment such as "run" inside "runtime". */
function mentions(text: string, reference: string): boolean {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu").test(text);
}

export function resolveEvent(raw: EventResolutionInput): EventResolution {
  const input = EventResolutionInputSchema.parse(raw);
  const enrolled = new Set(input.memberships.filter((m) => m.userId === input.senderUserId && m.state === "enrolled").map((m) => m.eventId));
  const events = input.events.filter((event) => enrolled.has(event.id) && !["canceled", "completed"].includes(event.status));
  const allowed = new Set(events.map((event) => event.id));
  const result = (ids: string[], reason: string): EventResolution => {
    const candidateIds = [...new Set(ids)].sort();
    return EventResolutionSchema.parse({ selectedEventId: candidateIds.length === 1 ? candidateIds[0] : null, candidateIds, requiresClarification: candidateIds.length > 1, reasonCodes: [reason] });
  };
  const pending = input.pendingProposalsForSender.filter((p) => p.targetUserId === input.senderUserId && allowed.has(p.eventId) && Date.parse(p.expiresAt) > input.now);
  if (pending.length) return result(pending.map((p) => p.eventId), "PENDING_PROPOSAL");
  const explicit = events.filter((event) => mentions(input.incomingText, event.title) || mentions(input.incomingText, event.id));
  if (explicit.length) return result(explicit.map((event) => event.id), "EXPLICIT_EVENT");
  if (input.recentFocus && input.recentFocus.expiresAt > input.now && allowed.has(input.recentFocus.eventId)) return result([input.recentFocus.eventId], "RECENT_EVENT");
  const matches = input.tasks.filter((task) => allowed.has(task.eventId) && !["canceled", "completed"].includes(task.status) && (mentions(input.incomingText, task.title) || mentions(input.incomingText, task.id)));
  if (matches.length) return result(matches.map((task) => task.eventId), "TASK_MATCH");
  // Time narrows the eligible window only; two plausible events still clarify.
  const upcoming = events.filter((event) => event.startsAt >= input.now - 86_400_000 && event.startsAt <= input.now + 7 * 86_400_000);
  if (upcoming.length) return result(upcoming.map((event) => event.id), "EVENT_WINDOW");
  return result(events.map((event) => event.id), events.length ? "ENROLLED_EVENTS" : "NO_AUTHORIZED_EVENT");
}

/** Backend callers supply authorized candidates; this projects shared facts only. */
export function buildContextPacket(raw: ContextBuildInput): ContextPacket {
  const input = ContextBuildInputSchema.parse(raw);
  const selected = input.selectedEvent;
  const events = selected ? [selected] : input.candidateEvents;
  const allowed = new Set(events.map((event) => event.id));
  return ContextPacketSchema.parse({
    messageId: input.messageId,
    sender: { userId: input.sender.id, role: input.senderRole },
    recentEventFocusId: input.recentEventFocusId && allowed.has(input.recentEventFocusId) ? input.recentEventFocusId : null,
    candidateEvents: events.map((event) => ({ id: event.id, title: event.title, startsAt: new Date(event.startsAt).toISOString() })),
    relevantTasks: selected ? input.relevantTasks.filter((task) => task.eventId === selected.id).map((task) => ({
      id: task.id, name: task.title, status: task.status, version: task.version,
      activeAssigneeIds: [...new Set(input.commitments.filter((c) => c.eventId === selected.id && c.taskId === task.id && c.state === "active").map((c) => c.participantId))],
    })) : [],
    pendingProposalsForSender: input.pendingProposalsForSender.filter((p) => p.targetUserId === input.sender.id && allowed.has(p.eventId)),
    incomingText: input.incomingText,
    eventVersion: selected?.version ?? null,
  });
}
