import { z } from "zod";

// Persisted states share these arrays with Convex validators. See docs/03.
export const messagingStates = ["active", "paused", "stopped"] as const;
export const invitationStates = ["pending", "redeemed", "expired", "revoked"] as const;
export const eventStatuses = ["draft", "scheduled", "canceled", "completed"] as const;
export const membershipStates = ["invited", "enrolled", "left"] as const;
export const taskStatuses = ["unassigned", "confirmed", "needs_coverage", "completed", "canceled"] as const;
export const commitmentStates = ["active", "released", "canceled_by_participant", "completed"] as const;
export const proposalStates = ["pending", "accepted", "declined", "expired", "superseded", "canceled"] as const;
export const outboundStates = ["queued", "sending", "sent", "delivered", "failed", "unknown"] as const;
export const reasoningJobStatuses = ["queued", "claimed", "completed", "failed", "expired"] as const;
export const inboundProcessingStates = ["received", "processing", "processed", "failed"] as const;
export const proposalTypes = ["assignment", "reassignment", "task_change"] as const;

export const MessagingStateSchema = z.enum(messagingStates);
export const InvitationStateSchema = z.enum(invitationStates);
export const EventStatusSchema = z.enum(eventStatuses);
export const MembershipStateSchema = z.enum(membershipStates);
export const TaskStatusSchema = z.enum(taskStatuses);
export const CommitmentStateSchema = z.enum(commitmentStates);
export const ProposalStateSchema = z.enum(proposalStates);
export const OutboundStateSchema = z.enum(outboundStates);
export const ReasoningJobStatusSchema = z.enum(reasoningJobStatuses);
export const InboundProcessingStateSchema = z.enum(inboundProcessingStates);
export const ProposalTypeSchema = z.enum(proposalTypes);

export type MessagingState = z.infer<typeof MessagingStateSchema>;
export type InvitationState = z.infer<typeof InvitationStateSchema>;
export type EventStatus = z.infer<typeof EventStatusSchema>;
export type MembershipState = z.infer<typeof MembershipStateSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type CommitmentState = z.infer<typeof CommitmentStateSchema>;
export type ProposalState = z.infer<typeof ProposalStateSchema>;
export type OutboundState = z.infer<typeof OutboundStateSchema>;
export type ReasoningJobStatus = z.infer<typeof ReasoningJobStatusSchema>;
export type InboundProcessingState = z.infer<typeof InboundProcessingStateSchema>;
export type ProposalType = z.infer<typeof ProposalTypeSchema>;
