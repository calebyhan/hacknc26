import XCTest
@testable import Rally

final class EventSetupTests: XCTestCase {
    func testFractionalDateUsesIntegerMillisecondsAndJSONNumbers() throws {
        let date = Date(timeIntervalSince1970: 1_792_245_600.123456)
        let milliseconds = try EventSetupTime.milliseconds(date)
        XCTAssertEqual(milliseconds, 1_792_245_600_123)
        let input = CreateEventInput(title: "Fixture", startsAt: milliseconds,
                                     timezone: "America/New_York", idempotencyKey: "fractional-date")
        let encoded = try ConvexArguments.encode(input)
        let wire = try XCTUnwrap(encoded["startsAt"] ?? nil).convexEncode()
        XCTAssertEqual(Double(wire), milliseconds)
        XCTAssertFalse(wire.contains("$integer"))
        XCTAssertThrowsError(try EventSetupTime.milliseconds(Date(timeIntervalSince1970: -.infinity)))
        XCTAssertThrowsError(try EventSetupTime.milliseconds(Date(timeIntervalSince1970: -1)))
    }

    func testTaskWindowRejectsReversedAndRoundedEqualTimes() throws {
        let start = Date(timeIntervalSince1970: 1_792_245_600.1231)
        XCTAssertThrowsError(try EventSetupTime.window(start: start, end: start))
        XCTAssertThrowsError(try EventSetupTime.window(start: start, end: start.addingTimeInterval(-1)))
        XCTAssertThrowsError(try EventSetupTime.window(start: start, end: start.addingTimeInterval(0.0001)))
        let window = try EventSetupTime.window(start: start, end: start.addingTimeInterval(3_600))
        XCTAssertEqual(window.end - window.start, 3_600_000)
    }

    func testWindowKeepsActualInstantsAcrossDaylightSavingChange() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let start = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 1, minute: 30)))
        let end = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 3, minute: 30)))
        let window = try EventSetupTime.window(start: start, end: end)
        XCTAssertEqual(window.end - window.start, 3_600_000)
    }

    func testServerLabelsCannotChangeCommittedAssignmentOrReviveExpiredOffer() throws {
        let taskJSON = #"{"_id":"task","eventId":"event","title":"Setup","capacity":1,"status":"confirmed","version":2,"activeAssigneeIds":["maya"],"displayLabel":"awaiting_participant"}"#
        let task = try JSONDecoder().decode(RallyTaskSummary.self, from: Data(taskJSON.utf8))
        XCTAssertEqual(task.displayLabel, .awaitingParticipant)
        XCTAssertEqual(task.committedDisplayStatus, .confirmed)
        var proposal = fixtureProposal()
        proposal.state = .expired
        proposal.displayLabel = .awaitingParticipant
        XCTAssertNil(proposal.displayStatus(at: fixtureNow))
        XCTAssertFalse(proposal.canOrganizerApprove(at: fixtureNow))
        proposal.state = .pending
        proposal.expiresAt = fixtureNow.timeIntervalSince1970 * 1_000 - 1
        XCTAssertNil(proposal.displayStatus(at: fixtureNow))
        XCTAssertFalse(proposal.isCurrent(at: fixtureNow))
    }

    func testUnknownProposalLabelAndStateAreNeutral() throws {
        let json = #"{"_id":"offer","eventId":"event","type":"assignment","state":"pending","requiresOrganizerApproval":true,"expiresAt":2000000000000,"displayLabel":"future_label"}"#
        var proposal = try JSONDecoder().decode(ProposalSummary.self, from: Data(json.utf8))
        XCTAssertEqual(proposal.displayStatus(at: fixtureNow), .unknown)
        XCTAssertFalse(proposal.canOrganizerApprove(at: fixtureNow))
        proposal.displayLabel = .confirmed
        XCTAssertEqual(proposal.displayStatus(at: fixtureNow), .unknown)
        proposal.state = .unknown
        proposal.displayLabel = .awaitingParticipant
        XCTAssertEqual(proposal.displayStatus(at: fixtureNow), .unknown)
        proposal.state = .pending
        proposal.displayLabel = .pendingApproval
        proposal.type = .unknown
        XCTAssertEqual(proposal.displayStatus(at: fixtureNow), .unknown)
        XCTAssertFalse(proposal.canOrganizerApprove(at: fixtureNow))
    }

    func testApprovalOutcomeRequiresRefreshedProposalRatherThanVoidResult() {
        var detail = fixtureDetail()
        let check = EventMutationVerification.approval(proposalID: "offer")
        XCTAssertEqual(check.message(in: detail, now: fixtureNow), "Organizer approval is still pending. Review the latest request before trying again.")
        detail.proposals[0].state = .expired
        XCTAssertEqual(check.message(in: detail, now: fixtureNow), "This offer expired or changed. It cannot be approved.")
        detail.proposals[0].state = .pending
        detail.proposals[0].organizerApprovedAt = fixtureNow.timeIntervalSince1970 * 1_000
        XCTAssertEqual(check.message(in: detail, now: fixtureNow), "Organizer approval is recorded. The participant still needs to respond.")
        XCTAssertEqual(detail.tasks.first?.activeAssigneeIds, ["maya"])
    }

    func testConfirmationUsesRefreshedScheduledVersionAndKeepsDraftOnNoOp() {
        var detail = fixtureDetail()
        let check = EventMutationVerification.confirmation(previousVersion: 1)
        XCTAssertEqual(check.message(in: detail, now: fixtureNow), "This event is still a draft. Review the latest details before confirming again.")
        detail.event.status = .scheduled
        detail.event.version = 2
        XCTAssertEqual(check.message(in: detail, now: fixtureNow), "The event is scheduled. Tasks still require participant acceptance.")
    }

    func testIdleExpiryRemovesPendingTaskOfferAndApprovalAtTheSameBoundary() {
        let detail = fixtureDetail()
        let expiry = detail.proposals[0].expirationDate
        XCTAssertEqual(detail.pendingProposals(for: "task", at: expiry.addingTimeInterval(-1)).count, 1)
        XCTAssertTrue(detail.proposals[0].canOrganizerApprove(at: expiry.addingTimeInterval(-1)))
        XCTAssertTrue(detail.pendingProposals(for: "task", at: expiry).isEmpty)
        XCTAssertFalse(detail.proposals[0].canOrganizerApprove(at: expiry))
        XCTAssertNil(detail.proposals[0].displayStatus(at: expiry))
        XCTAssertEqual(detail.tasks[0].committedDisplayStatus, .confirmed)
    }

    private var fixtureNow: Date { Date(timeIntervalSince1970: 1_792_000_000) }

    private func fixtureProposal() -> ProposalSummary {
        ProposalSummary(_id: "offer", eventId: "event", type: .reassignment,
                        targetTaskId: "task", targetUserId: "jordan", state: .pending,
                        requiresOrganizerApproval: true, expiresAt: 2_000_000_000_000)
    }

    private func fixtureDetail() -> EventDetail {
        EventDetail(event: EventSummary(_id: "event", title: "Fixture", kind: .event,
                                       startsAt: 1_792_245_600_000, timezone: "America/New_York",
                                       status: .draft, version: 1, role: .organizer),
                    tasks: [RallyTaskSummary(_id: "task", eventId: "event", title: "Setup", capacity: 1,
                                             status: .confirmed, version: 1, activeAssigneeIds: ["maya"])],
                    members: [], proposals: [fixtureProposal()])
    }
}
