import XCTest
@testable import Rally

final class CoreTests: XCTestCase {
    func testUnknownStatesDecodeToNeutralUnknown() throws {
        XCTAssertEqual(try JSONDecoder().decode(TaskStatus.self, from: Data("\"future_status\"".utf8)), .unknown)
        XCTAssertEqual(try JSONDecoder().decode(DisplayStatus.self, from: Data("\"future_label\"".utf8)), .unknown)
        XCTAssertEqual(TaskStatus.unknown.displayStatus, .unknown)
        XCTAssertEqual(DisplayStatus.unknown.title, "Unknown")
        XCTAssertEqual(DisplayStatus.waitingToJoin.title, "Waiting for them to text Rally")
    }

    func testWireKeysAndMillisecondsArePreserved() throws {
        let json = #"{"_id":"event_fixture","title":"Fixture","kind":"event","startsAt":1792245600000,"timezone":"America/New_York","status":"scheduled","version":1,"role":"organizer"}"#
        let event = try JSONDecoder().decode(EventSummary.self, from: Data(json.utf8))
        XCTAssertEqual(event.id, "event_fixture")
        XCTAssertEqual(event.startDate.timeIntervalSince1970, 1_792_245_600)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(event)) as? [String: Any])
        XCTAssertEqual(encoded["_id"] as? String, "event_fixture")
        XCTAssertNil(encoded["id"])
        XCTAssertEqual(encoded["startsAt"] as? Double, 1_792_245_600_000)
    }

    func testContactWireContainsOnlySelectedFields() throws {
        let selected = SelectedContact(displayName: "Fixture Person", phoneE164: "+15550100005")
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(selected)) as? [String: Any])
        XCTAssertEqual(Set(encoded.keys), ["displayName", "phoneE164"])
    }

    func testPhoneNormalizationRequiresExplicitCountryCode() throws {
        XCTAssertEqual(try ContactNormalization.normalize("+1 (555) 010-0005"), "+15550100005")
        XCTAssertEqual(try ContactNormalization.normalize(" +44 7700 900123 "), "+447700900123")
        for invalid in ["5550100005", "+1 FLOWERS", "+15550100005 ext 2", "+15550100005#2", "++15550100005", "+05550100005", "+123", "+1234567890123456"] {
            XCTAssertThrowsError(try ContactNormalization.normalize(invalid), invalid)
        }
    }

    @MainActor
    func testPendingProposalDoesNotReplaceConfirmedMaya() async throws {
        let client = MockRallyClient()
        let detail = try await firstDetail(client)
        let task = try XCTUnwrap(detail.tasks.first)
        XCTAssertEqual(task.activeAssigneeIds, ["usr_maya"])
        XCTAssertEqual(task.committedDisplayStatus, .confirmed)
        XCTAssertEqual(detail.proposals.first?.displayStatus, .awaitingParticipant)
        XCTAssertEqual(detail.members.first(where: { $0.userId == "usr_taylor" })?.state, .invited)
    }

    @MainActor
    func testSimulatedAcceptanceRefreshesSubscriptionExactlyOnce() async throws {
        let client = MockRallyClient()
        var updates = client.detail(eventID: "event_charity_5k").makeAsyncIterator()
        let originalValue = try await updates.next()
        let original = try XCTUnwrap(originalValue)
        try await client.simulateAcceptance()
        let acceptedValue = try await updates.next()
        let accepted = try XCTUnwrap(acceptedValue)
        XCTAssertEqual(accepted.tasks.first?.activeAssigneeIds, ["usr_jordan"])
        XCTAssertEqual(accepted.tasks.first?.version, (original.tasks.first?.version ?? 0) + 1)
        XCTAssertEqual(accepted.event.version, original.event.version)
        XCTAssertEqual(accepted.proposals.first?.state, .accepted)
        try await client.simulateAcceptance()
        let reread = try await firstDetail(client)
        XCTAssertEqual(reread, accepted)
        XCTAssertTrue(client.simulationAccepted)
    }

    @MainActor
    func testOnlyEnrolledEventsAreVisible() async throws {
        let alex = MockRallyClient(session: .alex)
        var alexEvents = alex.events().makeAsyncIterator()
        let visibleValue = try await alexEvents.next()
        let visible = try XCTUnwrap(visibleValue)
        XCTAssertEqual(Set(visible.map(\.id)), ["event_charity_5k", "event_hack_night"])
        XCTAssertFalse(visible.contains(where: { $0.id == "event_private" }))
        let stranger = MockRallyClient(session: .stranger)
        var strangerEvents = stranger.events().makeAsyncIterator()
        let strangerVisible = try await strangerEvents.next()
        XCTAssertEqual(strangerVisible, [])
        do {
            _ = try await firstDetail(stranger)
            XCTFail("Unrelated user must not read the event")
        } catch {
            XCTAssertEqual(error as? RallyClientError, .accessDenied)
        }
    }

    @MainActor
    func testMemberCannotCreateTaskOrInvitations() async throws {
        let client = MockRallyClient(session: .jordan)
        let detail = try await firstDetail(client)
        XCTAssertEqual(detail.event.role, .member)
        do {
            _ = try await client.createTask(CreateTaskInput(eventId: detail.event.id, title: "Fixture task", expectedEventVersion: 1, idempotencyKey: "member-task"))
            XCTFail("Member cannot create tasks")
        } catch {
            XCTAssertEqual(error as? RallyClientError, .accessDenied)
        }
        do {
            _ = try await client.createInvitations(eventID: detail.event.id, contacts: [SelectedContact(displayName: "Pat", phoneE164: "+15550100005")], idempotencyKey: "member-invite")
            XCTFail("Member cannot invite contacts")
        } catch {
            XCTAssertEqual(error as? RallyClientError, .accessDenied)
        }
    }

    @MainActor
    func testSelectedContactsRemainInvitedAndReplayDoesNotDuplicate() async throws {
        let client = MockRallyClient()
        let contact = SelectedContact(displayName: "Pat", phoneE164: "+15550100005")
        let invitations = try await client.createInvitations(eventID: "event_charity_5k", contacts: [contact, contact], idempotencyKey: "invite-pat")
        let replay = try await client.createInvitations(eventID: "event_charity_5k", contacts: [contact, contact], idempotencyKey: "invite-pat")
        XCTAssertEqual(invitations, replay)
        XCTAssertEqual(invitations.count, 1)
        let detail = try await firstDetail(client)
        let added = detail.members.filter { $0.displayName == "Pat" }
        XCTAssertEqual(added.count, 1)
        XCTAssertEqual(added.first?.state, .invited)
        XCTAssertEqual(added.first?.displayStatus, .waitingToJoin)
        XCTAssertTrue(invitations[0].code.hasPrefix("SIMULATED-"))
    }

    @MainActor
    func testEventAndTaskCreationAreIdempotent() async throws {
        let client = MockRallyClient()
        let input = CreateEventInput(title: "Fixture picnic", startsAt: 1_792_245_600_000, timezone: "America/New_York", idempotencyKey: "create-picnic")
        let first = try await client.createEvent(input)
        let replay = try await client.createEvent(input)
        XCTAssertEqual(first, replay)
        let taskInput = CreateTaskInput(eventId: first, title: "Bring snacks", expectedEventVersion: 1, idempotencyKey: "create-snacks")
        let task = try await client.createTask(taskInput)
        let repeatedTask = try await client.createTask(taskInput)
        XCTAssertEqual(task, repeatedTask)
        let detail = try await firstDetail(client, eventID: first)
        XCTAssertEqual(detail.tasks.count, 1)
        XCTAssertEqual(detail.tasks.first?.status, .unassigned)
        XCTAssertEqual(detail.members.count, 1)
        XCTAssertEqual(detail.members.first?.role, .organizer)
    }

    @MainActor
    func testInvalidInputAndConflictingIdempotencyAreRejected() async throws {
        let client = MockRallyClient()
        do {
            _ = try await client.createEvent(CreateEventInput(title: " \n", startsAt: 1, timezone: "America/New_York", idempotencyKey: "empty-title"))
            XCTFail("Empty title must fail")
        } catch { XCTAssertNotNil(error as? RallyClientError) }
        do {
            _ = try await client.createInvitations(eventID: "event_charity_5k", contacts: [SelectedContact(displayName: "Pat", phoneE164: "5550100005")], idempotencyKey: "bad-phone")
            XCTFail("Unnormalized phone must fail")
        } catch { XCTAssertNotNil(error as? RallyClientError) }
        let input = CreateEventInput(title: "Fixture", startsAt: 1_792_245_600_000, timezone: "America/New_York", idempotencyKey: "shared-key")
        _ = try await client.createEvent(input)
        do {
            _ = try await client.createEvent(CreateEventInput(title: "Changed payload", startsAt: input.startsAt, timezone: input.timezone, idempotencyKey: "shared-key"))
            XCTFail("A replay key cannot authorize a different payload")
        } catch { XCTAssertNotNil(error as? RallyClientError) }
    }

    @MainActor
    private func firstDetail(_ client: MockRallyClient, eventID: String = "event_charity_5k") async throws -> EventDetail {
        var iterator = client.detail(eventID: eventID).makeAsyncIterator()
        let value = try await iterator.next()
        return try XCTUnwrap(value)
    }
}
