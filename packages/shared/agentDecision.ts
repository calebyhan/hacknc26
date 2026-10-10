import { z } from "zod";
import { IdentifierSchema, IsoDateTimeSchema, IsoTimeWindowSchema, TextReferenceSchema } from "./primitives";

export const MAX_DECISION_ACTIONS = 8;
export const forbiddenActionTypes = ["RAW_HTTP", "EXECUTE_CODE", "SEND_ANY_MESSAGE", "MARK_CONFIRMED", "UPDATE_ANY_DB_ROW"] as const;

export const CreateEventDraftActionSchema = z.strictObject({
  type: z.literal("CREATE_EVENT_DRAFT"),
  title: TextReferenceSchema,
  startsAt: IsoDateTimeSchema,
  timezone: TextReferenceSchema,
  location: TextReferenceSchema.optional(),
});
export const AddInviteeDraftActionSchema = z.strictObject({
  type: z.literal("ADD_INVITEE_DRAFT"),
  // A reference is resolved within authorized, explicitly selected contacts.
  contactRef: TextReferenceSchema,
});
export const ProposeAssignmentActionSchema = z.strictObject({
  type: z.literal("PROPOSE_ASSIGNMENT"),
  taskRef: TextReferenceSchema,
  toParticipantRef: TextReferenceSchema,
});
export const ProposeReassignmentActionSchema = z.strictObject({
  type: z.literal("PROPOSE_REASSIGNMENT"),
  taskRef: TextReferenceSchema,
  fromParticipantRef: TextReferenceSchema,
  toParticipantRef: TextReferenceSchema,
});
export const RecordSelfCommitmentActionSchema = z.strictObject({
  type: z.literal("RECORD_SELF_COMMITMENT"),
  // The backend resolves this to an open task or a new organizer-visible item.
  taskRef: TextReferenceSchema,
  window: IsoTimeWindowSchema.optional(),
});
export const ReportUnavailabilityActionSchema = z.strictObject({
  type: z.literal("REPORT_UNAVAILABILITY"),
  participantRef: TextReferenceSchema,
  taskRef: TextReferenceSchema.optional(),
  window: IsoTimeWindowSchema.optional(),
});
export const ProposeTaskChangeActionSchema = z.discriminatedUnion("field", [
  z.strictObject({
    type: z.literal("PROPOSE_TASK_CHANGE"),
    taskRef: TextReferenceSchema,
    field: z.literal("time"),
    newValue: IsoTimeWindowSchema,
  }),
  z.strictObject({
    type: z.literal("PROPOSE_TASK_CHANGE"),
    taskRef: TextReferenceSchema,
    field: z.literal("location"),
    newValue: TextReferenceSchema,
  }),
]);
export const RecordAvailabilityActionSchema = z.strictObject({
  type: z.literal("RECORD_AVAILABILITY"),
  kind: z.enum(["available", "unavailable"]),
  window: IsoTimeWindowSchema,
});
export const RequestStatusActionSchema = z.strictObject({ type: z.literal("REQUEST_STATUS") });
export const AskClarificationActionSchema = z.strictObject({
  type: z.literal("ASK_CLARIFICATION"),
  question: z.string().trim().min(1).max(500),
});
export const NoActionSchema = z.strictObject({
  type: z.literal("NO_ACTION"),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const AgentActionSchema = z.discriminatedUnion("type", [
  CreateEventDraftActionSchema,
  AddInviteeDraftActionSchema,
  ProposeAssignmentActionSchema,
  ProposeReassignmentActionSchema,
  RecordSelfCommitmentActionSchema,
  ReportUnavailabilityActionSchema,
  ProposeTaskChangeActionSchema,
  RecordAvailabilityActionSchema,
  RequestStatusActionSchema,
  AskClarificationActionSchema,
  NoActionSchema,
]);

export const AgentDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventCandidateId: IdentifierSchema.nullable(),
  confidenceClass: z.enum(["clear", "ambiguous", "unsupported"]),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().trim().min(1).max(500).nullable(),
  actions: z.array(AgentActionSchema).min(1).max(MAX_DECISION_ACTIONS),
  responseStyle: z.literal("concise"),
  reasonCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(16),
}).superRefine((decision, ctx) => {
  const ambiguous = decision.confidenceClass === "ambiguous";
  if (decision.needsClarification !== ambiguous) {
    ctx.addIssue({ code: "custom", path: ["needsClarification"], message: "needsClarification must match ambiguous confidence" });
  }
  if (ambiguous && decision.actions.some((action) => action.type !== "ASK_CLARIFICATION")) {
    ctx.addIssue({ code: "custom", path: ["actions"], message: "An ambiguous decision may only ask for clarification" });
  }
});

export type AgentAction = z.infer<typeof AgentActionSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
