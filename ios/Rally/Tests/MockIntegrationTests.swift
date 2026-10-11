import XCTest
@testable import Rally

/// Offline simulations only: these tests never authenticate, send, or enroll a real phone.
@MainActor
final class MockIntegrationTests: XCTestCase {
    private let initialTime = Date(timeIntervalSince1970: 1_791_600_000)

    func testPhoneProofRequiresExplicitSimulationAndCompletesIdempotently() async throws {
        let client = MockRallyClient(now: { self.initialTime })
        let account = try await client.register(displayName: "Alex")
        let challenge = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "phone-1")
        let repeated = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "phone-1")
        XCTAssertEqual(challenge, repeated)
        XCTAssertTrue(challenge.code.hasPrefix("SIMULATED-"))
        XCTAssertNil(client.simulatedLinkedPhone)
        await expectPhoneFailure(.proofRequired) { _ = try await client.completePhoneLink(invitationID: challenge.invitationId) }
        try await client.simulatePhoneJoin(invitationID: challenge.invitationId)
        XCTAssertNil(client.simulatedLinkedPhone)
        let linked = try await client.completePhoneLink(invitationID: challenge.invitationId)
        let linkedAgain = try await client.completePhoneLink(invitationID: challenge.invitationId)
        XCTAssertEqual(linked, account)
        XCTAssertEqual(linkedAgain, account)
        XCTAssertEqual(linked, "usr_alex")
        XCTAssertEqual(client.simulatedLinkedPhone, "+15550100001")
    }

    func testExpiredChallengeRetryKeepsExpiryUntilNewKeyAndCannotCreateProof() async throws {
        var time = initialTime
        let client = MockRallyClient(now: { time })
        let first = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "phone-1")
        time.addTimeInterval(601)
        let retry = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "phone-1")
        XCTAssertEqual(retry, first)
        await expectPhoneFailure(.expired) { try await client.simulatePhoneJoin(invitationID: first.invitationId) }
        await expectPhoneFailure(.expired) { _ = try await client.completePhoneLink(invitationID: first.invitationId) }
        let replacement = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "phone-2")
        XCTAssertNotEqual(replacement.invitationId, first.invitationId)
        XCTAssertGreaterThan(replacement.expiresAt, first.expiresAt)
        await expectPhoneFailure(.proofRequired) { _ = try await client.completePhoneLink(invitationID: replacement.invitationId) }
    }

    func testPhoneLinkRejectsAnotherFixtureAccountAndPhoneChange() async throws {
        let client = MockRallyClient(now: { self.initialTime })
        let another = try await client.beginPhoneLink(phoneE164: "+15550100003", idempotencyKey: "another-account")
        try await client.simulatePhoneJoin(invitationID: another.invitationId)
        await expectPhoneFailure(.identityConflict) { _ = try await client.completePhoneLink(invitationID: another.invitationId) }
        XCTAssertNil(client.simulatedLinkedPhone)
        let own = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "own-account")
        try await client.simulatePhoneJoin(invitationID: own.invitationId)
        _ = try await client.completePhoneLink(invitationID: own.invitationId)
        await expectPhoneFailure(.phoneChangeUnsupported) { _ = try await client.beginPhoneLink(phoneE164: "+15550100005", idempotencyKey: "change-phone") }
    }

    func testDraftConfirmationReplaysOnceAndKeepsTaskVersionAndConsentSeparate() async throws {
        let client = MockRallyClient(now: { self.initialTime })
        let eventID = try await createDraft(client)
        _ = try await client.createTask(CreateTaskInput(eventId: eventID, title: "Setup", windowStart: 1000, windowEnd: 2000,
                                                       expectedEventVersion: 1, idempotencyKey: "task"))
        let draft = try await detail(client, eventID)
        XCTAssertEqual(draft.event.status, .draft)
        XCTAssertFalse(client.simulatedMessagingConsent(eventID: eventID))
        let result = try await client.confirmDraft(eventID: eventID, expectedVersion: 1)
        let retry = try await client.confirmDraft(eventID: eventID, expectedVersion: 1)
        XCTAssertEqual(result, eventID)
        XCTAssertEqual(retry, eventID)
        let confirmed = try await detail(client, eventID)
        XCTAssertEqual(confirmed.event.status, .scheduled)
        XCTAssertEqual(confirmed.event.version, 2)
        XCTAssertEqual(confirmed.tasks.first?.version, 1)
        XCTAssertFalse(client.simulatedMessagingConsent(eventID: eventID))
        await expectClientFailure { _ = try await client.confirmDraft(eventID: eventID, expectedVersion: 2) }
        await expectClientFailure { _ = try await client.createTask(CreateTaskInput(eventId: eventID, title: "Stale", expectedEventVersion: 1, idempotencyKey: "stale")) }
    }

    func testOrganizerInvitationRequiresPhoneButOnlyExplicitJoinGrantsEventConsent() async throws {
        let client = MockRallyClient(now: { self.initialTime })
        let eventID = try await createDraft(client)
        await expectClientFailure { _ = try await client.organizerInvitation(eventID: eventID, idempotencyKey: "event-join") }
        let phone = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "phone")
        try await client.simulatePhoneJoin(invitationID: phone.invitationId)
        _ = try await client.completePhoneLink(invitationID: phone.invitationId)
        let invitation = try await client.organizerInvitation(eventID: eventID, idempotencyKey: "event-join")
        XCTAssertFalse(client.simulatedMessagingConsent(eventID: eventID))
        let retry = try await client.organizerInvitation(eventID: eventID, idempotencyKey: "event-join")
        XCTAssertEqual(retry, invitation)
        let before = try await detail(client, eventID)
        try await client.simulatePhoneJoin(invitationID: invitation.invitationId)
        try await client.simulatePhoneJoin(invitationID: invitation.invitationId)
        XCTAssertTrue(client.simulatedMessagingConsent(eventID: eventID))
        let after = try await detail(client, eventID)
        XCTAssertEqual(after, before, "Consent cannot create a commitment or confirm an event")
        await expectClientFailure { _ = try await client.completePhoneLink(invitationID: invitation.invitationId) }
    }

    func testOrganizerApprovalDoesNotCommitAndDoesNotDuplicateSimulatedRequest() async throws {
        let client = MockRallyClient(now: { self.initialTime })
        let before = try await detail(client, "event_hack_night")
        let proposalID = "proposal_simulated_organizer_review"
        XCTAssertEqual(client.simulatedRequestCount(proposalID: proposalID), 0)
        try await client.approveProposal(proposalID: proposalID)
        try await client.approveProposal(proposalID: proposalID)
        let after = try await detail(client, "event_hack_night")
        XCTAssertEqual(after.tasks, before.tasks)
        XCTAssertEqual(after.proposals.first?.state, .pending)
        XCTAssertNotNil(after.proposals.first?.organizerApprovedAt)
        XCTAssertEqual(after.proposals.first?.displayStatus(at: initialTime), .awaitingParticipant)
        XCTAssertEqual(client.simulatedRequestCount(proposalID: proposalID), 1)
        let member = MockRallyClient(session: .jordan, now: { self.initialTime })
        await expectClientFailure(.accessDenied) { try await member.approveProposal(proposalID: proposalID) }
        await expectClientFailure(.accessDenied) { _ = try await member.confirmDraft(eventID: "event_hack_night", expectedVersion: 1) }
        await expectClientFailure(.accessDenied) { _ = try await member.organizerInvitation(eventID: "event_hack_night", idempotencyKey: "member") }
    }

    func testExpiredApprovalDoesNotContactCandidate() async throws {
        var time = initialTime
        let client = MockRallyClient(now: { time })
        time.addTimeInterval(601)
        try await client.approveProposal(proposalID: "proposal_simulated_organizer_review")
        let expired = try await detail(client, "event_hack_night")
        XCTAssertEqual(expired.proposals.first?.state, .expired)
        XCTAssertEqual(expired.tasks.first?.activeAssigneeIds, [])
        XCTAssertEqual(client.simulatedRequestCount(proposalID: "proposal_simulated_organizer_review"), 0)
    }

    func testFractionalTimestampsAndUnpairedTaskWindowsNeverCreateRecords() async throws {
        let client = MockRallyClient(now: { self.initialTime })
        await expectClientFailure { _ = try await client.createEvent(CreateEventInput(title: "Fractional", startsAt: 1000.5, timezone: "UTC", idempotencyKey: "fractional")) }
        let eventID = try await createDraft(client)
        let invalidWindows: [(Double?, Double?)] = [(1000, nil), (nil, 2000), (1000.5, 2000), (1000, 1000), (-1, 1000)]
        for (index, window) in invalidWindows.enumerated() {
            await expectClientFailure { _ = try await client.createTask(CreateTaskInput(eventId: eventID, title: "Invalid window", windowStart: window.0,
                                                                                       windowEnd: window.1, expectedEventVersion: 1, idempotencyKey: "window-\(index)")) }
        }
        await expectClientFailure { _ = try await client.createTask(CreateTaskInput(eventId: eventID, title: "Too many", capacity: 21, expectedEventVersion: 1, idempotencyKey: "capacity")) }
        let unchanged = try await detail(client, eventID)
        XCTAssertEqual(unchanged.tasks, [])
    }

    func testInvitationRetryDoesNotRenewExpiryOrGrantConsent() async throws {
        var time = initialTime
        let client = MockRallyClient(now: { time })
        let contacts = [SelectedContact(displayName: "Pat", phoneE164: "+15550100005")]
        let first = try await client.createInvitations(eventID: "event_charity_5k", contacts: contacts, idempotencyKey: "invite")
        time.addTimeInterval(86_401)
        let retry = try await client.createInvitations(eventID: "event_charity_5k", contacts: contacts, idempotencyKey: "invite")
        let replacement = try await client.createInvitations(eventID: "event_charity_5k", contacts: contacts, idempotencyKey: "invite-new")
        XCTAssertEqual(retry, first)
        XCTAssertGreaterThan(replacement[0].expiresAt, first[0].expiresAt)
        let current = try await detail(client, "event_charity_5k")
        XCTAssertEqual(current.members.filter { $0.displayName == "Pat" }.map(\.state), [.invited])
    }

    private func createDraft(_ client: MockRallyClient) async throws -> String {
        try await client.createEvent(CreateEventInput(title: "Simulation draft", startsAt: 2000, timezone: "UTC", idempotencyKey: "draft"))
    }

    private func detail(_ client: MockRallyClient, _ eventID: String) async throws -> EventDetail {
        var iterator = client.detail(eventID: eventID).makeAsyncIterator()
        let value = try await iterator.next()
        return try XCTUnwrap(value)
    }

    private func expectPhoneFailure(_ expected: PhoneLinkFailure, operation: () async throws -> Void) async {
        do { try await operation(); XCTFail("Expected simulated phone failure") }
        catch { XCTAssertEqual(error as? PhoneLinkFailure, expected) }
    }

    private func expectClientFailure(_ expected: RallyClientError? = nil, operation: () async throws -> Void) async {
        do { try await operation(); XCTFail("Expected simulated authorization or validation failure") }
        catch {
            XCTAssertNotNil(error as? RallyClientError)
            if let expected { XCTAssertEqual(error as? RallyClientError, expected) }
        }
    }
}
