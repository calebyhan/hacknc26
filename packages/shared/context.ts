import { z } from "zod";
import { ContextPendingProposalSchema, type ContextPacket } from "./contextPacket";
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

export function resolveEvent(_input: EventResolutionInput): EventResolution {
  throw new Error("NOT_IMPLEMENTED(lane-c)");
}
export function buildContextPacket(_input: ContextBuildInput): ContextPacket {
  throw new Error("NOT_IMPLEMENTED(lane-c)");
}
