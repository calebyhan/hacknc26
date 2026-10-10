import XCTest
@testable import Rally

@MainActor
final class AppStatusTests: XCTestCase {
    func testMockAccountAndRoutePublishOnlyAfterExplicitPhoneProof() async throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let client = MockRallyClient(now: { now })
        var accounts = client.account().makeAsyncIterator()
        var routes = client.rallyRoute().makeAsyncIterator()
        let beforeAccount = try await accounts.next()
        let beforeRoute = try await routes.next()
        XCTAssertFalse(try XCTUnwrap(beforeAccount).phoneLinked)
        XCTAssertEqual(beforeRoute, .unavailable)
        let challenge = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "fixture-link")
        try await client.simulatePhoneJoin(invitationID: challenge.invitationId)
        _ = try await client.completePhoneLink(invitationID: challenge.invitationId)
        let linked = try await accounts.next()
        let route = try await routes.next()
        XCTAssertEqual(linked?.userId, "usr_alex")
        XCTAssertTrue(try XCTUnwrap(linked).phoneLinked)
        XCTAssertEqual(route, .available(destination: "+15550009999", expiresAt: 1_800_003_600_000))
    }

    func testOrganizerAppMembershipAndPhoneProofRemainSeparateFromEventConsent() async throws {
        let client = MockRallyClient()
        let eventID = try await client.createEvent(CreateEventInput(title: "Fixture meetup", startsAt: 1_900_000_000_000,
                                                                   timezone: "America/New_York", idempotencyKey: "status-event"))
        var statuses = client.eventStatus(eventID: eventID).makeAsyncIterator()
        let initial = try await statuses.next()
        XCTAssertEqual(initial?.messaging.membershipState, .enrolled)
        XCTAssertFalse(try XCTUnwrap(initial).messaging.consentRecorded)
        XCTAssertFalse(try XCTUnwrap(initial).messaging.canReceiveMessages)
        let phone = try await client.beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "status-phone")
        try await client.simulatePhoneJoin(invitationID: phone.invitationId)
        _ = try await client.completePhoneLink(invitationID: phone.invitationId)
        let linked = try await statuses.next()
        XCTAssertFalse(try XCTUnwrap(linked).messaging.canReceiveMessages)
        let invitation = try await client.organizerInvitation(eventID: eventID, idempotencyKey: "status-join")
        try await client.simulatePhoneJoin(invitationID: invitation.invitationId)
        let joined = try await statuses.next()
        XCTAssertTrue(try XCTUnwrap(joined).messaging.consentRecorded)
        XCTAssertTrue(try XCTUnwrap(joined).messaging.canReceiveMessages)
        XCTAssertTrue(try XCTUnwrap(joined).activity.allSatisfy { $0.title.hasPrefix("Simulated") })
    }

    func testProgressUsesCommittedTasksAndStatusQueriesRespectMembership() async throws {
        let client = MockRallyClient()
        var overview = client.eventProgress().makeAsyncIterator()
        let initialValue = try await overview.next()
        let initial = try XCTUnwrap(initialValue)
        XCTAssertFalse(initial.contains { $0.eventId == "event_private" })
        XCTAssertEqual(initial.first { $0.eventId == "event_charity_5k" }?.progress.confirmed, 1)
        XCTAssertEqual(initial.first { $0.eventId == "event_hack_night" }?.progress.needsCoverage, 1)
        try await client.approveProposal(proposalID: "proposal_simulated_organizer_review")
        let approvedValue = try await overview.next()
        let approved = try XCTUnwrap(approvedValue)
        XCTAssertEqual(approved.first { $0.eventId == "event_hack_night" }?.progress.confirmed, 0)
        XCTAssertEqual(approved.first { $0.eventId == "event_hack_night" }?.progress.needsCoverage, 1)
        var denied = client.eventStatus(eventID: "event_private").makeAsyncIterator()
        do { _ = try await denied.next(); XCTFail("Private status must not be exposed") }
        catch { XCTAssertEqual(error as? RallyClientError, .accessDenied) }
    }

    func testRouteRequiresCanonicalPhoneAndExpiryAndNewEnumsStayUnknown() throws {
        let decoder = JSONDecoder()
        for json in [
            #"{"status":"future"}"#, #"{"status":"available"}"#,
            #"{"status":"available","destination":"shared","expiresAt":2000000000000}"#,
            #"{"status":"available","destination":"+15550009999"}"#,
            #"{"status":"available","destination":"sms:+15550009999","expiresAt":2000000000000}"#
        ] {
            XCTAssertEqual(try decoder.decode(RallyRoute.self, from: Data(json.utf8)), .unavailable)
        }
        let activity = try decoder.decode(ActivityEntry.self, from: Data(#"{"id":"fixture","kind":"future","at":1800000000123,"title":"Redacted fixture","deliveryState":"future"}"#.utf8))
        XCTAssertEqual(activity.kind, .unknown)
        XCTAssertEqual(activity.deliveryState, .unknown)
        XCTAssertEqual(activity.date.timeIntervalSince1970, 1_800_000_000.123, accuracy: 0.001)
    }
}
