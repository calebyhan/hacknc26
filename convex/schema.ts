import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  commitmentState, eventStatus, inboundProcessingState, invitationState,
  membershipState, messagingState, outboundState, proposalState, proposalType,
  reasoningJobStatus, role, settings, taskStatus, taskVersion, weatherPolicy,
} from "./lib/validators";

/**
 * Storage contract only. Indexes do not enforce uniqueness: owning mutations must
 * check identity, consent, membership, versions and logical idempotency atomically.
 * Unix epoch milliseconds are used for all persisted timestamps.
 */
export default defineSchema({
  users: defineTable({
    displayName: v.string(),
    verifiedPhoneE164: v.optional(v.string()),
    createdAt: v.number(),
    authSubject: v.optional(v.string()),
    messagingState,
    messagingStateAt: v.optional(v.number()),
    settings,
  }).index("by_auth_subject", ["authSubject"]).index("by_phone", ["verifiedPhoneE164"]),

  // Server-only provider allocation evidence. A revocation-only row is a
  // tombstone: do not fall back to an older observed or provisioned contact.
  messagingRoutes: defineTable({
    participantPhoneE164: v.string(),
    provisioning: v.optional(v.object({
      destination: v.string(),
      verifiedAt: v.number(),
      expiresAt: v.number(),
      providerReference: v.string(),
    })),
    revokedAt: v.optional(v.number()),
  }).index("by_participant_phone", ["participantPhoneE164"]),

  contactSelections: defineTable({
    ownerUserId: v.id("users"),
    eventId: v.optional(v.id("events")),
    displayName: v.string(),
    phoneE164: v.string(),
    selectedAt: v.number(),
    invitationId: v.optional(v.id("invitations")),
  }).index("by_owner", ["ownerUserId"]).index("by_event", ["eventId"]),

  invitations: defineTable({
    purpose: v.union(v.literal("event_invite"), v.literal("app_phone_link")),
    eventId: v.optional(v.id("events")),
    inviterUserId: v.id("users"),
    contactSelectionId: v.optional(v.id("contactSelections")),
    targetUserId: v.optional(v.id("users")),
    codeHash: v.string(),
    state: invitationState,
    expiresAt: v.number(),
    failedAttempts: v.number(),
    redeemedByPhoneE164: v.optional(v.string()),
    redeemedAt: v.optional(v.number()),
  }).index("by_code_hash", ["codeHash"]).index("by_event", ["eventId"])
    .index("by_contact_selection", ["contactSelectionId"]),

  events: defineTable({
    title: v.string(),
    kind: v.union(v.literal("event"), v.literal("project")),
    startsAt: v.number(),
    timezone: v.string(),
    location: v.optional(v.string()),
    ownerId: v.id("users"),
    status: eventStatus,
    version: v.number(),
    weatherPolicy: v.optional(weatherPolicy),
  }).index("by_owner", ["ownerId"]).index("by_start", ["startsAt"]),

  memberships: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    role,
    state: membershipState,
    notificationsEnabled: v.boolean(),
    joinedAt: v.optional(v.number()),
    consentAt: v.optional(v.number()),
    consentSourceMessageId: v.optional(v.id("inboundMessages")),
  }).index("by_event", ["eventId"]).index("by_user", ["userId"])
    .index("by_event_user", ["eventId", "userId"]),

  tasks: defineTable({
    eventId: v.id("events"),
    title: v.string(),
    location: v.optional(v.string()),
    windowStart: v.optional(v.number()),
    windowEnd: v.optional(v.number()),
    requiredSkills: v.optional(v.array(v.string())),
    capacity: v.number(),
    dependsOnTaskIds: v.optional(v.array(v.id("tasks"))),
    status: taskStatus,
    version: v.number(),
  }).index("by_event", ["eventId"]),

  commitments: defineTable({
    eventId: v.id("events"),
    taskId: v.id("tasks"),
    participantId: v.id("users"),
    state: commitmentState,
    sourceProposalId: v.optional(v.id("proposals")),
    sourceMessageId: v.optional(v.id("inboundMessages")),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
    endedByActorId: v.optional(v.id("users")),
  }).index("by_event", ["eventId"]).index("by_task", ["taskId"])
    .index("by_participant", ["participantId"]),

  availability: defineTable({
    eventId: v.id("events"),
    userId: v.id("users"),
    windowStart: v.number(),
    windowEnd: v.number(),
    kind: v.union(v.literal("available"), v.literal("unavailable")),
    source: v.union(v.literal("self_reported"), v.literal("organizer_reported")),
    reportedByUserId: v.id("users"),
    sourceMessageId: v.optional(v.id("inboundMessages")),
    recordedAt: v.number(),
  }).index("by_event_user", ["eventId", "userId"]),

  proposals: defineTable({
    eventId: v.id("events"),
    type: proposalType,
    originatorId: v.id("users"),
    subjectId: v.optional(v.id("users")),
    targetTaskId: v.optional(v.id("tasks")),
    targetUserId: v.optional(v.id("users")),
    // Shared PROPOSE_TASK_CHANGE action JSON; validate before persisting or using.
    taskChangeJson: v.optional(v.string()),
    state: proposalState,
    requiresOrganizerApproval: v.boolean(),
    organizerApprovedAt: v.optional(v.number()),
    eventVersionAtCreation: v.number(),
    taskVersionAtCreation: v.optional(v.number()),
    expiresAt: v.number(),
    idempotencyKey: v.string(),
  }).index("by_event", ["eventId"]).index("by_target", ["targetUserId"])
    .index("by_idempotency", ["idempotencyKey"]),

  inboundMessages: defineTable({
    provider: v.string(),
    providerMessageId: v.string(),
    senderPhone: v.string(),
    receivedAt: v.number(),
    contentType: v.string(),
    bodyRedactedOrEncrypted: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
    processingState: inboundProcessingState,
  }).index("by_provider_message_id", ["provider", "providerMessageId"])
    .index("by_sender", ["senderPhone"])
    .index("by_sender_received_at", ["senderPhone", "receivedAt"]),

  outboundMessages: defineTable({
    idempotencyKey: v.string(),
    recipientUserId: v.id("users"),
    eventId: v.optional(v.id("events")),
    proposalId: v.optional(v.id("proposals")),
    content: v.string(),
    // Preserve verified inbound evidence so retries can recheck reply consent.
    directReplyToMessageId: v.optional(v.id("inboundMessages")),
    state: outboundState,
    attemptCount: v.number(),
    providerMessageId: v.optional(v.string()),
  }).index("by_key", ["idempotencyKey"]).index("by_state", ["state"])
    .index("by_event_recipient", ["eventId", "recipientUserId"]),

  conversationFocus: defineTable({
    userId: v.id("users"),
    lastEventId: v.optional(v.id("events")),
    lastIntent: v.optional(v.string()),
    updatedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_user", ["userId"]),

  reasoningJobs: defineTable({
    messageId: v.id("inboundMessages"),
    // Null scope supports a first draft or clarification, never existing-event writes.
    eventId: v.union(v.id("events"), v.null()),
    contextVersion: v.union(v.number(), v.null()),
    taskVersions: v.array(taskVersion),
    status: reasoningJobStatus,
    leaseOwner: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    attempts: v.number(),
    // Canonical JSON, parsed with the shared AgentDecisionSchema before any use.
    result: v.optional(v.string()),
    failureCategory: v.optional(v.string()),
    // Domain execution cache is separate from the worker's validated model result.
    executedDecisionJson: v.optional(v.string()),
    executionResultJson: v.optional(v.string()),
  }).index("by_status", ["status"]).index("by_message", ["messageId"]),

  workerHeartbeats: defineTable({
    workerId: v.string(),
    lastHeartbeatAt: v.number(),
    modelId: v.optional(v.string()),
    lastError: v.optional(v.string()),
  }).index("by_worker", ["workerId"]),

  auditEvents: defineTable({
    actorType: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    actorId: v.optional(v.id("users")),
    eventId: v.id("events"),
    action: v.string(),
    oldStateRef: v.optional(v.string()),
    newStateRef: v.optional(v.string()),
    at: v.number(),
    sourceId: v.string(),
  }).index("by_event", ["eventId"]).index("by_time", ["at"]).index("by_source", ["sourceId"])
    .index("by_event_at", ["eventId", "at"]),

  weatherObservations: defineTable({
    eventId: v.id("events"),
    source: v.string(),
    retrievedAt: v.number(),
    forecastFor: v.number(),
    precipProbability: v.optional(v.number()),
    thresholdCrossed: v.boolean(),
    policyVersion: v.number(),
  }).index("by_event_time", ["eventId", "forecastFor"]),
});
