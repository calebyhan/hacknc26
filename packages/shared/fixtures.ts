import { z } from "zod";
import { AvailabilitySchema, CommitmentSchema, ContactSelectionSchema, EventSchema, InvitationSchema, MembershipSchema, TaskSchema, UserSchema } from "./domain";
import type { AgentDecision } from "./agentDecision";
import type { ContextPacket } from "./contextPacket";

export const SeedFixtureSchema = z.strictObject({
  simulation: z.literal(true),
  users: z.array(UserSchema),
  events: z.array(EventSchema),
  memberships: z.array(MembershipSchema),
  tasks: z.array(TaskSchema),
  commitments: z.array(CommitmentSchema),
  availability: z.array(AvailabilitySchema),
  contactSelections: z.array(ContactSelectionSchema),
  invitations: z.array(InvitationSchema),
});
export type SeedFixture = z.infer<typeof SeedFixtureSchema>;

export const fixtureIds = {
  alex: "usr_alex", maya: "usr_maya", jordan: "usr_jordan", taylor: "usr_taylor",
  charity5k: "event_charity_5k", hackNight: "event_hack_night",
  charitySetup: "task_charity_setup", hackSetup: "task_hack_setup",
} as const;

const createdAt = Date.UTC(2026, 9, 10, 12);
const charityStart = Date.UTC(2026, 9, 17, 14);
const charitySetupEnd = Date.UTC(2026, 9, 17, 15);
const hackStart = Date.UTC(2026, 9, 17, 23);

/** Simulation only. Fake identities and consent evidence must never enroll live users. */
export const seedFixture: SeedFixture = {
  simulation: true,
  users: [
    { id: fixtureIds.alex, displayName: "Alex", verifiedPhoneE164: "+15550100001", createdAt, authSubject: "fixture|alex", messagingState: "active", settings: { timezone: "America/New_York" } },
    { id: fixtureIds.maya, displayName: "Maya", verifiedPhoneE164: "+15550100002", createdAt, messagingState: "active", settings: {} },
    { id: fixtureIds.jordan, displayName: "Jordan", verifiedPhoneE164: "+15550100003", createdAt, messagingState: "active", settings: {} },
    { id: fixtureIds.taylor, displayName: "Taylor", createdAt, messagingState: "active", settings: {} },
  ],
  events: [
    { id: fixtureIds.charity5k, title: "Charity 5K", kind: "event", startsAt: charityStart, timezone: "America/New_York", location: "UNC campus", ownerId: fixtureIds.alex, status: "scheduled", version: 1 },
    { id: fixtureIds.hackNight, title: "Hack Night", kind: "event", startsAt: hackStart, timezone: "America/New_York", location: "Fixture meeting room", ownerId: fixtureIds.alex, status: "scheduled", version: 1 },
  ],
  memberships: [
    { id: "membership_charity_alex", userId: fixtureIds.alex, eventId: fixtureIds.charity5k, role: "organizer", state: "enrolled", notificationsEnabled: true, joinedAt: createdAt, consentAt: createdAt, consentSourceMessageId: "fixture_join_charity_alex" },
    { id: "membership_charity_maya", userId: fixtureIds.maya, eventId: fixtureIds.charity5k, role: "member", state: "enrolled", notificationsEnabled: true, joinedAt: createdAt, consentAt: createdAt, consentSourceMessageId: "fixture_join_charity_maya" },
    { id: "membership_charity_jordan", userId: fixtureIds.jordan, eventId: fixtureIds.charity5k, role: "member", state: "enrolled", notificationsEnabled: true, joinedAt: createdAt, consentAt: createdAt, consentSourceMessageId: "fixture_join_charity_jordan" },
    { id: "membership_charity_taylor", userId: fixtureIds.taylor, eventId: fixtureIds.charity5k, role: "member", state: "invited", notificationsEnabled: false },
    { id: "membership_hack_alex", userId: fixtureIds.alex, eventId: fixtureIds.hackNight, role: "organizer", state: "enrolled", notificationsEnabled: true, joinedAt: createdAt, consentAt: createdAt, consentSourceMessageId: "fixture_join_hack_alex" },
    { id: "membership_hack_jordan", userId: fixtureIds.jordan, eventId: fixtureIds.hackNight, role: "member", state: "enrolled", notificationsEnabled: true, joinedAt: createdAt, consentAt: createdAt, consentSourceMessageId: "fixture_join_hack_jordan" },
  ],
  tasks: [
    { id: fixtureIds.charitySetup, eventId: fixtureIds.charity5k, title: "setup", windowStart: charityStart, windowEnd: charitySetupEnd, capacity: 1, status: "confirmed", version: 1 },
    { id: fixtureIds.hackSetup, eventId: fixtureIds.hackNight, title: "setup", windowStart: hackStart, windowEnd: hackStart + 3_600_000, capacity: 1, status: "unassigned", version: 1 },
  ],
  commitments: [
    { id: "commitment_maya_setup", eventId: fixtureIds.charity5k, taskId: fixtureIds.charitySetup, participantId: fixtureIds.maya, state: "active", sourceMessageId: "fixture_maya_acceptance", createdAt },
  ],
  availability: [
    { id: "availability_jordan_setup", eventId: fixtureIds.charity5k, userId: fixtureIds.jordan, windowStart: charityStart, windowEnd: charitySetupEnd, kind: "available", source: "self_reported", reportedByUserId: fixtureIds.jordan, sourceMessageId: "fixture_jordan_availability", recordedAt: createdAt },
  ],
  contactSelections: [
    { id: "contact_taylor", ownerUserId: fixtureIds.alex, eventId: fixtureIds.charity5k, displayName: "Taylor", phoneE164: "+15550100004", selectedAt: createdAt, invitationId: "invitation_taylor" },
  ],
  invitations: [
    { id: "invitation_taylor", purpose: "event_invite", eventId: fixtureIds.charity5k, inviterUserId: fixtureIds.alex, contactSelectionId: "contact_taylor", targetUserId: fixtureIds.taylor, codeHash: "fixture-only-not-a-redeemable-code", state: "pending", expiresAt: createdAt + 86_400_000, failedAttempts: 0 },
  ],
};

// These intentionally preserve the examples in docs/05 for contract compatibility.
export const exampleAgentDecision: AgentDecision = {
  schemaVersion: 1,
  eventCandidateId: "event_charity_5k",
  confidenceClass: "clear",
  needsClarification: false,
  clarificationQuestion: null,
  actions: [{ type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" }],
  responseStyle: "concise",
  reasonCodes: ["RECENT_EVENT", "TASK_MATCH"],
};
export const exampleContextPacket: ContextPacket = {
  messageId: "msg_demo_29",
  sender: { userId: "usr_alex", role: "organizer" },
  recentEventFocusId: "event_charity_5k",
  candidateEvents: [{ id: "event_charity_5k", title: "Charity 5K", startsAt: "2026-10-17T14:00:00Z" }],
  relevantTasks: [{ id: "task_setup", name: "setup", activeAssigneeIds: ["usr_maya"], status: "confirmed", version: 3 }],
  pendingProposalsForSender: [],
  incomingText: "Maya can't do setup. Could Jordan cover it?",
  eventVersion: 7,
};
