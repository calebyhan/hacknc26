import { describe, expect, it } from "vitest";
import { AgentActionSchema, AgentDecisionSchema, MAX_DECISION_ACTIONS, forbiddenActionTypes } from "../agentDecision";
import { FakeInferenceProvider, FakeMessagingAdapter, SendRequestSchema, SendResultSchema, type SendRequest } from "../adapters";
import { ContextPacketSchema } from "../contextPacket";
import { CommandSchema, parseCommand } from "../commands";
import { TaskSchema } from "../domain";
import { CommitmentStateSchema, EventStatusSchema, InboundProcessingStateSchema, InvitationStateSchema, MembershipStateSchema, MessagingStateSchema, OutboundStateSchema, ProposalStateSchema, ReasoningJobStatusSchema, TaskStatusSchema, commitmentStates, eventStatuses, inboundProcessingStates, invitationStates, membershipStates, messagingStates, outboundStates, proposalStates, reasoningJobStatuses, taskStatuses } from "../enums";
import { SeedFixtureSchema, exampleAgentDecision, exampleContextPacket, fixtureIds, seedFixture } from "../fixtures";

describe("AgentDecision contract", () => {
  it("accepts the complete decision example from docs/05", () => {
    expect(AgentDecisionSchema.parse(exampleAgentDecision)).toEqual(exampleAgentDecision);
  });

  it.each(forbiddenActionTypes)("rejects forbidden action %s", (type) => {
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, actions: [{ type }] }).success).toBe(false);
  });

  it("rejects unknown actions, extra envelope fields and extra nested action fields", () => {
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, actions: [{ type: "IMPERSONATE_USER" }] }).success).toBe(false);
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, admin: true }).success).toBe(false);
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, actions: [{ ...exampleAgentDecision.actions[0], approved: true }] }).success).toBe(false);
  });

  it.each([
    ["clear", true], ["ambiguous", false], ["unsupported", true],
  ] as const)("rejects mismatched confidence %s / clarification %s", (confidenceClass, needsClarification) => {
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, confidenceClass, needsClarification }).success).toBe(false);
  });

  it("only permits clarification actions for an ambiguous decision", () => {
    const ambiguous = { ...exampleAgentDecision, confidenceClass: "ambiguous", needsClarification: true, clarificationQuestion: "Charity 5K or Hack Night?" };
    expect(AgentDecisionSchema.safeParse(ambiguous).success).toBe(false);
    expect(AgentDecisionSchema.safeParse({ ...ambiguous, actions: [{ type: "ASK_CLARIFICATION", question: "Charity 5K or Hack Night?" }] }).success).toBe(true);
    expect(AgentDecisionSchema.safeParse({ ...ambiguous, actions: [{ type: "ASK_CLARIFICATION", question: "Which event?" }, { type: "REQUEST_STATUS" }] }).success).toBe(false);
  });

  it("bounds action count", () => {
    const action = { type: "REQUEST_STATUS" };
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, actions: [] }).success).toBe(false);
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, actions: Array.from({ length: MAX_DECISION_ACTIONS }, () => action) }).success).toBe(true);
    expect(AgentDecisionSchema.safeParse({ ...exampleAgentDecision, actions: Array.from({ length: MAX_DECISION_ACTIONS + 1 }, () => action) }).success).toBe(false);
  });

  const window = { startsAt: "2026-10-17T14:00:00Z", endsAt: "2026-10-17T15:00:00Z" };
  it.each([
    { type: "CREATE_EVENT_DRAFT", title: "Charity 5K", startsAt: window.startsAt, timezone: "America/New_York" },
    { type: "ADD_INVITEE_DRAFT", contactRef: "Taylor" },
    { type: "PROPOSE_ASSIGNMENT", taskRef: "setup", toParticipantRef: "Jordan" },
    { type: "PROPOSE_REASSIGNMENT", taskRef: "setup", fromParticipantRef: "Maya", toParticipantRef: "Jordan" },
    { type: "RECORD_SELF_COMMITMENT", taskRef: "speakers", window },
    { type: "REPORT_UNAVAILABILITY", participantRef: "Maya", taskRef: "setup", window },
    { type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "time", newValue: window },
    { type: "PROPOSE_TASK_CHANGE", taskRef: "setup", field: "location", newValue: "UNC campus" },
    { type: "RECORD_AVAILABILITY", kind: "available", window },
    { type: "REQUEST_STATUS" },
    { type: "ASK_CLARIFICATION", question: "Which event?" },
    { type: "NO_ACTION", reason: "Unsupported request" },
  ])("validates the $type payload and rejects extra fields", (action) => {
    expect(AgentActionSchema.safeParse(action).success).toBe(true);
    expect(AgentActionSchema.safeParse({ ...action, performWithoutApproval: true }).success).toBe(false);
  });

  it("validates nested windows and prevents self-report payloads from choosing another actor", () => {
    expect(AgentActionSchema.safeParse({ type: "RECORD_AVAILABILITY", kind: "available", window: { ...window, secret: true } }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "RECORD_AVAILABILITY", kind: "available", window: { startsAt: window.endsAt, endsAt: window.startsAt } }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "RECORD_SELF_COMMITMENT", taskRef: "setup", participantRef: "Jordan" }).success).toBe(false);
  });
});

describe("context and commands", () => {
  it("accepts the context example from docs/05", () => {
    expect(ContextPacketSchema.parse(exampleContextPacket)).toEqual(exampleContextPacket);
  });

  it("rejects unexpected private data in envelope and nested context", () => {
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, contactList: [] }).success).toBe(false);
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, sender: { ...exampleContextPacket.sender, phone: "+15550100001" } }).success).toBe(false);
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, candidateEvents: [{ ...exampleContextPacket.candidateEvents[0], unrelatedMembers: [] }] }).success).toBe(false);
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, relevantTasks: [{ ...exampleContextPacket.relevantTasks[0], version: 0 }] }).success).toBe(false);
    const participant = { userId: "fixture_person", displayName: "Caleb", role: "member" };
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, relevantParticipants: [participant] }).success).toBe(true);
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, relevantParticipants: [{ ...participant, phone: "+15550100001" }] }).success).toBe(false);
    expect(ContextPacketSchema.safeParse({ ...exampleContextPacket, relevantParticipants: Array.from({ length: 101 }, () => participant) }).success).toBe(false);
  });

  it("defines all deterministic commands and parses explicit YES", () => {
    const commands = [
      { type: "JOIN", code: "fixture-code" },
      ...["YES", "NO", "STATUS", "HELP", "STOP", "PAUSE", "RESUME"].map((type) => ({ type })),
      { type: "LEAVE", eventRef: "Charity 5K" },
      { type: "UNKNOWN", text: "Maybe?" },
    ];
    for (const command of commands) expect(CommandSchema.safeParse(command).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "JOIN" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "YES", userId: "usr_jordan" }).success).toBe(false);
    expect(parseCommand("YES")).toEqual({ type: "YES" });
  });
});

describe("canonical enums and simulation fixtures", () => {
  it("every canonical enum accepts its array and rejects invented state labels", () => {
    const entries = [
      [messagingStates, MessagingStateSchema], [invitationStates, InvitationStateSchema],
      [eventStatuses, EventStatusSchema], [membershipStates, MembershipStateSchema],
      [taskStatuses, TaskStatusSchema], [commitmentStates, CommitmentStateSchema],
      [proposalStates, ProposalStateSchema], [outboundStates, OutboundStateSchema],
      [reasoningJobStatuses, ReasoningJobStatusSchema], [inboundProcessingStates, InboundProcessingStateSchema],
    ] as const;
    for (const [values, schema] of entries) {
      for (const value of values) expect(schema.safeParse(value).success).toBe(true);
      expect(schema.safeParse("pretend_complete").success).toBe(false);
    }
  });

  it("validates all fixture records and uses fake phone numbers only", () => {
    expect(SeedFixtureSchema.parse(seedFixture)).toEqual(seedFixture);
    expect(seedFixture.simulation).toBe(true);
    for (const user of seedFixture.users) {
      if (user.verifiedPhoneE164) expect(user.verifiedPhoneE164).toMatch(/^\+1555/);
    }
    for (const contact of seedFixture.contactSelections) expect(contact.phoneE164).toMatch(/^\+1555/);
    const invalid = structuredClone(seedFixture);
    invalid.tasks[0] = { ...seedFixture.tasks[0]!, status: "awaiting_participant" as never };
    expect(SeedFixtureSchema.safeParse(invalid).success).toBe(false);
  });

  it("supports an optional task location without accepting malformed location data", () => {
    const task = seedFixture.tasks[0]!;
    expect(TaskSchema.safeParse(task).success).toBe(true);
    expect(TaskSchema.safeParse({ ...task, location: "UNC campus" }).success).toBe(true);
    expect(TaskSchema.safeParse({ ...task, location: 17 }).success).toBe(false);
  });

  it("keeps Taylor invited without consent and Maya active on Charity setup", () => {
    const taylor = seedFixture.memberships.find((membership) => membership.userId === fixtureIds.taylor);
    expect(taylor).toMatchObject({ state: "invited", notificationsEnabled: false });
    expect(taylor?.consentAt).toBeUndefined();
    expect(seedFixture.commitments).toContainEqual(expect.objectContaining({ participantId: fixtureIds.maya, taskId: fixtureIds.charitySetup, state: "active" }));
    expect(seedFixture.tasks.filter((task) => task.title === "setup").map((task) => task.eventId)).toEqual([fixtureIds.charity5k, fixtureIds.hackNight]);
    for (const membership of seedFixture.memberships) {
      expect(seedFixture.users.some((user) => user.id === membership.userId)).toBe(true);
      expect(seedFixture.events.some((event) => event.id === membership.eventId)).toBe(true);
    }
    for (const commitment of seedFixture.commitments) {
      const task = seedFixture.tasks.find((candidate) => candidate.id === commitment.taskId);
      expect(task?.eventId).toBe(commitment.eventId);
    }
  });
});

describe("fake adapters are explicit simulations", () => {
  const request: SendRequest = {
    idempotencyKey: "fixture:proposal:request",
    recipientUserId: fixtureIds.jordan,
    toPhoneE164: "+15550100003",
    eventId: fixtureIds.charity5k,
    content: "Fixture request. Reply YES or NO.",
  };

  it("records every attempt, without pretending the provider deduplicated retries", async () => {
    const adapter = new FakeMessagingAdapter();
    const mutableRequest = { ...request };
    const first = await adapter.send(mutableRequest);
    const second = await adapter.send(request);
    mutableRequest.content = "Changed by caller";
    expect(adapter.sends).toEqual([request, request]);
    expect(first).toEqual({ state: "sent", providerMessageId: "fake_message_1" });
    expect(second).toEqual({ state: "sent", providerMessageId: "fake_message_2" });
  });

  it("models failure and uncertain timeout separately from provider acceptance", async () => {
    const adapter = new FakeMessagingAdapter({ outcome: "failed" });
    adapter.queueOutcome("timeout");
    expect(await adapter.send(request)).toEqual({ state: "unknown", errorCode: "FAKE_TIMEOUT" });
    expect(await adapter.send(request)).toEqual({ state: "failed", errorCode: "FAKE_FAILURE" });
    adapter.setOutcome("sent");
    expect(await adapter.send(request)).toMatchObject({ state: "sent" });
    expect(adapter.sends).toHaveLength(3);
    expect(SendResultSchema.safeParse({ state: "delivered" }).success).toBe(false);
  });

  it("rejects invalid send requests before recording a provider attempt", async () => {
    const adapter = new FakeMessagingAdapter();
    expect(SendRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
    await expect(adapter.send({ ...request, toPhoneE164: "unverified text" })).rejects.toThrow();
    expect(adapter.sends).toHaveLength(0);
  });

  it("returns validated scripted decisions keyed by exact input text", async () => {
    const provider = new FakeInferenceProvider({ [exampleContextPacket.incomingText]: exampleAgentDecision });
    const decision = await provider.decide(exampleContextPacket);
    expect(decision).toEqual(exampleAgentDecision);
    expect(provider.calls).toEqual([exampleContextPacket]);
    decision.actions.splice(0);
    expect(await provider.decide(exampleContextPacket)).toEqual(exampleAgentDecision);
    await expect(provider.decide({ ...exampleContextPacket, incomingText: "Unscripted" })).rejects.toThrow("NO_SCRIPTED_DECISION");
  });
});
