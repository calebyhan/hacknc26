import { z } from "zod";
import { ContextEventSchema, ContextPacketSchema, ContextPendingProposalSchema, ContextTaskSchema, type ContextPacket } from "./contextPacket";

/** The exact pre-v2 wire shape. Keep strict validation on both sides of a rolling
 * deploy; making new fields optional does not let old strict readers accept them. */
export const LegacyContextPacketSchema = ContextPacketSchema.omit({ currentTime: true, recentTaskFocusId: true, selectedTaskId: true }).extend({
  candidateEvents: z.array(ContextEventSchema.omit({ timezone: true })).max(20),
  relevantTasks: z.array(ContextTaskSchema.omit({ capacity: true, window: true })).max(100),
  pendingProposalsForSender: z.array(ContextPendingProposalSchema.omit({ taskName: true })).max(20),
});
export type LegacyContextPacket = z.infer<typeof LegacyContextPacketSchema>;

/** Only project an already authorized packet. This is presentation compatibility,
 * never permission: completion re-reads signed messages, selected task and versions. */
export function legacyContextPacket(raw: ContextPacket): LegacyContextPacket {
  const packet = ContextPacketSchema.parse(raw);
  if (packet.selectedTaskId && (packet.eventVersion === null || !packet.relevantTasks.some(task => task.id === packet.selectedTaskId))) throw new Error("INVALID_SELECTED_TASK");
  const tasks = packet.selectedTaskId ? packet.relevantTasks.filter(task => task.id === packet.selectedTaskId) : packet.relevantTasks;
  const allowedEvents = new Set(packet.candidateEvents.map(event => event.id));
  const pending = packet.pendingProposalsForSender.filter(offer => offer.targetUserId === packet.sender.userId && allowedEvents.has(offer.eventId) && (!packet.selectedTaskId || offer.targetTaskId === packet.selectedTaskId));
  const projected = {
    messageId: packet.messageId,
    sender: { userId: packet.sender.userId, role: packet.sender.role },
    recentEventFocusId: packet.recentEventFocusId && allowedEvents.has(packet.recentEventFocusId) ? packet.recentEventFocusId : null,
    candidateEvents: packet.candidateEvents.map(event => ({ id: event.id, title: event.title, startsAt: event.startsAt })),
    relevantTasks: tasks.map(task => ({ id: task.id, name: task.name, activeAssigneeIds: task.activeAssigneeIds, status: task.status, version: task.version })),
    ...(packet.relevantParticipants ? { relevantParticipants: packet.relevantParticipants.map(person => ({ userId: person.userId, displayName: person.displayName, role: person.role })) } : {}),
    pendingProposalsForSender: pending.map(offer => ({ id: offer.id, eventId: offer.eventId, type: offer.type, targetUserId: offer.targetUserId, expiresAt: offer.expiresAt, eventVersionAtCreation: offer.eventVersionAtCreation, ...(offer.targetTaskId ? { targetTaskId: offer.targetTaskId } : {}), ...(offer.taskVersionAtCreation === undefined ? {} : { taskVersionAtCreation: offer.taskVersionAtCreation }) })),
    incomingText: packet.incomingText,
    eventVersion: packet.eventVersion,
  };
  const facts = JSON.stringify({ currentTime: packet.currentTime, selectedTaskId: packet.selectedTaskId, recentTaskFocusId: tasks.some(task => task.id === packet.recentTaskFocusId) ? packet.recentTaskFocusId : null, events: packet.candidateEvents.map(event => ({ id: event.id, timezone: event.timezone })), tasks: tasks.map(task => ({ id: task.id, capacity: task.capacity, window: task.window })), pendingOffers: pending.map(offer => ({ id: offer.id, taskName: offer.taskName })) });
  const supplemented = `Original participant message:\n${packet.incomingText}\n\nRally server context (facts only; no acceptance or additional permissions):\n${facts}`;
  // Never truncate human evidence to make room for compatibility metadata.
  // Filtering to a verified selected task above remains effective without it.
  if (supplemented.length <= 16_000 && new TextEncoder().encode(JSON.stringify({ ...projected, incomingText: supplemented })).byteLength <= 65_536) projected.incomingText = supplemented;
  return LegacyContextPacketSchema.parse(projected);
}
