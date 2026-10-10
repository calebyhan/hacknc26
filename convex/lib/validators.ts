import { v } from "convex/values";
import {
  commitmentStates,
  eventStatuses,
  inboundProcessingStates,
  invitationStates,
  membershipStates,
  messagingStates,
  outboundStates,
  proposalStates,
  proposalTypes,
  reasoningJobStatuses,
  taskStatuses,
} from "@rally/shared/enums";

/** Convex validators derive persisted enums from the shared runtime contract. */
export function enumValidator<const T extends readonly [string, ...string[]]>(values: T) {
  return v.union(...values.map((value: T[number]) => v.literal(value)));
}

export const messagingState = enumValidator(messagingStates);
export const invitationState = enumValidator(invitationStates);
export const eventStatus = enumValidator(eventStatuses);
export const membershipState = enumValidator(membershipStates);
export const taskStatus = enumValidator(taskStatuses);
export const commitmentState = enumValidator(commitmentStates);
export const proposalState = enumValidator(proposalStates);
export const proposalType = enumValidator(proposalTypes);
export const outboundState = enumValidator(outboundStates);
export const reasoningJobStatus = enumValidator(reasoningJobStatuses);
export const inboundProcessingState = enumValidator(inboundProcessingStates);
export const role = v.union(v.literal("organizer"), v.literal("member"));

export const settings = v.object({
  timezone: v.optional(v.string()),
  skills: v.optional(v.array(v.string())),
});

export const weatherPolicy = v.object({
  enabled: v.boolean(),
  condition: v.literal("precipitation_probability_gte"),
  thresholdPercent: v.number(),
  leadTimeHours: v.number(),
  alternative: v.optional(v.object({
    type: v.literal("indoor_backup"),
    location: v.string(),
  })),
  version: v.number(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

export const taskVersion = v.object({ taskId: v.id("tasks"), version: v.number() });

/** Read models deliberately omit phone numbers, auth subjects and invitation codes. */
export const eventSummary = v.object({
  _id: v.id("events"),
  title: v.string(),
  kind: v.union(v.literal("event"), v.literal("project")),
  startsAt: v.number(),
  timezone: v.string(),
  location: v.optional(v.string()),
  status: eventStatus,
  version: v.number(),
  role,
});

export const taskSummary = v.object({
  _id: v.id("tasks"),
  eventId: v.id("events"),
  title: v.string(),
  location: v.optional(v.string()),
  windowStart: v.optional(v.number()),
  windowEnd: v.optional(v.number()),
  capacity: v.number(),
  status: taskStatus,
  version: v.number(),
  activeAssigneeIds: v.array(v.id("users")),
});

export const proposalSummary = v.object({
  _id: v.id("proposals"),
  eventId: v.id("events"),
  type: proposalType,
  targetTaskId: v.optional(v.id("tasks")),
  targetUserId: v.optional(v.id("users")),
  state: proposalState,
  requiresOrganizerApproval: v.boolean(),
  organizerApprovedAt: v.optional(v.number()),
  expiresAt: v.number(),
});

export const memberSummary = v.object({
  userId: v.id("users"),
  displayName: v.string(),
  role,
  state: membershipState,
});

export const eventDetail = v.object({
  event: eventSummary,
  tasks: v.array(taskSummary),
  members: v.array(memberSummary),
  proposals: v.array(proposalSummary),
});

export const statusSummary = v.object({ events: v.array(eventDetail) });
