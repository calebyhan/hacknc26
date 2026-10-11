import { z } from "zod";
import { ProposalTypeSchema, TaskStatusSchema } from "./enums";
import { IdentifierSchema, IsoDateTimeSchema, MemberRoleSchema, TextReferenceSchema, VersionSchema } from "./primitives";

export const ContextEventSchema = z.strictObject({
  id: IdentifierSchema,
  title: TextReferenceSchema,
  startsAt: IsoDateTimeSchema,
});
export const ContextTaskSchema = z.strictObject({
  id: IdentifierSchema,
  name: TextReferenceSchema,
  activeAssigneeIds: z.array(IdentifierSchema),
  status: TaskStatusSchema,
  version: VersionSchema,
});
export const ContextParticipantSchema = z.strictObject({
  userId: IdentifierSchema,
  displayName: TextReferenceSchema,
  role: MemberRoleSchema,
});
export const ContextPendingProposalSchema = z.strictObject({
  id: IdentifierSchema,
  eventId: IdentifierSchema,
  type: ProposalTypeSchema,
  targetUserId: IdentifierSchema,
  targetTaskId: IdentifierSchema.optional(),
  expiresAt: IsoDateTimeSchema,
  eventVersionAtCreation: VersionSchema,
  taskVersionAtCreation: VersionSchema.optional(),
});
export const ContextPacketSchema = z.strictObject({
  messageId: IdentifierSchema,
  sender: z.strictObject({ userId: IdentifierSchema, role: MemberRoleSchema }),
  recentEventFocusId: IdentifierSchema.nullable(),
  candidateEvents: z.array(ContextEventSchema).max(20),
  relevantTasks: z.array(ContextTaskSchema).max(100),
  // Additive for older fixture packets. Producers include only joined people
  // from the selected event; this never grants permission to contact them.
  relevantParticipants: z.array(ContextParticipantSchema).max(100).optional(),
  pendingProposalsForSender: z.array(ContextPendingProposalSchema).max(20),
  incomingText: z.string().min(1).max(16_000),
  eventVersion: VersionSchema.nullable(),
});

export type ContextEvent = z.infer<typeof ContextEventSchema>;
export type ContextTask = z.infer<typeof ContextTaskSchema>;
export type ContextParticipant = z.infer<typeof ContextParticipantSchema>;
export type ContextPendingProposal = z.infer<typeof ContextPendingProposalSchema>;
export type ContextPacket = z.infer<typeof ContextPacketSchema>;
