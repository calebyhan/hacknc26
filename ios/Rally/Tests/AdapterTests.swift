import XCTest
@preconcurrency import Combine
@preconcurrency import ConvexMobile
@testable import Rally

@MainActor
final class AdapterTests: XCTestCase {
    func testPhoneChallengeDecodesItsAssignedBotDestinationBeforePhoneProof() async throws {
        let transport = FixtureAPITransport()
        transport.result = #"{"invitationId":"fixture-link","code":"FIXTURE-ONLY","expiresAt":2000000000000,"route":{"status":"available","destination":"+15550009999","expiresAt":2000000000000}}"#
        let challenge = try await ConvexRallyClient(transport: transport).beginPhoneLink(phoneE164: "+15550100001", idempotencyKey: "fixture-assigned-link")
        XCTAssertEqual(challenge.route?.destination(at: Date(timeIntervalSince1970: 1_900_000_000)), "+15550009999")
        XCTAssertNil(challenge.route?.destination(at: Date(timeIntervalSince1970: 2_000_000_001)))
    }
    func testBackgroundAccountUpdateAndCompletionDoNotCrashAfterLogin() async throws {
        let transport = FixtureAPITransport()
        transport.subscriptionQueue = DispatchQueue(label: "rally.fixture.backend-callback")
        transport.subscriptionResult = #"{"userId":"current-user","displayName":"Alex","phoneLinked":false,"messagingState":"active"}"#
        let client = ConvexRallyClient(transport: transport)
        var account = client.account().makeAsyncIterator()

        let status = try await account.next()
        XCTAssertEqual(status?.userId, "current-user")
        let end = try await account.next()
        XCTAssertNil(end)
    }

    func testBackgroundProtectedQueryFailureIsSanitizedWithoutCrashing() async {
        let transport = FixtureAPITransport()
        transport.subscriptionQueue = DispatchQueue(label: "rally.fixture.backend-error")
        transport.subscriptionFailure = .ServerError(msg: "private-token unauthorized event content")
        let client = ConvexRallyClient(transport: transport)
        var account = client.account().makeAsyncIterator()

        do { _ = try await account.next(); XCTFail("Expected query failure") }
        catch {
            XCTAssertTrue(error.localizedDescription.contains("cleared"))
            XCTAssertFalse(error.localizedDescription.contains("private-token"))
        }
    }

    func testAccountAndPhoneRequestsNeverSendClientAuthority() async throws {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        transport.result = #""provisional-user""#
        let registered = try await client.register(displayName: "  Fixture Person  ")
        XCTAssertEqual(registered, "provisional-user")
        XCTAssertEqual(transport.calls.last?.name, "accounts:register")
        XCTAssertEqual(transport.calls.last?.arguments, ["displayName": #""Fixture Person""#])

        transport.result = #"{"invitationId":"fixture-link","code":"FIXTURE-ONLY","expiresAt":1792245600000}"#
        let challenge = try await client.beginPhoneLink(phoneE164: "+1 (555) 010-0001", idempotencyKey: "fixture-key")
        XCTAssertEqual(challenge.invitationId, "fixture-link")
        XCTAssertEqual(transport.calls.last?.arguments, ["phoneE164": #""+15550100001""#, "idempotencyKey": #""fixture-key""#])

        transport.result = #""canonical-user""#
        let linked = try await client.completePhoneLink(invitationID: challenge.invitationId)
        XCTAssertEqual(linked, "canonical-user")
        XCTAssertEqual(transport.calls.last?.arguments, ["invitationId": #""fixture-link""#])
        XCTAssertTrue(transport.calls.allSatisfy { Set($0.arguments.keys).isDisjoint(with: ["userId", "role", "authSubject", "verifiedPhoneE164"]) })
    }

    func testInvalidDisplayNameAndPhoneDoNotCallTransport() async {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        do { _ = try await client.register(displayName: "  "); XCTFail("Expected validation") }
        catch { XCTAssertNotNil(error as? RallyClientError) }
        do { _ = try await client.beginPhoneLink(phoneE164: "5550100001", idempotencyKey: "fixture"); XCTFail("Expected validation") }
        catch { XCTAssertNotNil(error as? RallyClientError) }
        XCTAssertTrue(transport.calls.isEmpty)
    }

    func testVersionIsJSONNumberAndApprovalDecodesNullWithoutCreatingCommitment() async throws {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        transport.result = #""fixture-event""#
        _ = try await client.confirmDraft(eventID: "fixture-event", expectedVersion: 3)
        XCTAssertEqual(transport.calls.last?.arguments, ["eventId": #""fixture-event""#, "expectedVersion": "3"])
        transport.result = "null"
        try await client.approveProposal(proposalID: "fixture-proposal")
        XCTAssertEqual(transport.calls.last?.name, "proposals:approve")
        XCTAssertEqual(transport.calls.last?.arguments, ["proposalId": #""fixture-proposal""#])
        XCTAssertEqual(transport.calls.count, 2)
    }

    func testOrdinaryBackendErrorsAreNotParsedAsPhoneProofOrShownToUser() async {
        let transport = FixtureAPITransport()
        transport.failure = ClientError.ServerError(msg: "Uncaught Error: PHONE_PROOF_REQUIRED private-token private-message")
        let client = ConvexRallyClient(transport: transport)
        do { _ = try await client.completePhoneLink(invitationID: "fixture"); XCTFail("Expected safe failure") }
        catch {
            XCTAssertNil(error as? PhoneLinkFailure)
            XCTAssertTrue(error.localizedDescription.contains("has not completed"))
            XCTAssertFalse(error.localizedDescription.contains("private-"))
            XCTAssertFalse(error.localizedDescription.contains("PHONE_PROOF_REQUIRED"))
        }
    }

    func testMalformedReplyFailsClosedAndCancellationRemainsCancellation() async {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        transport.result = #"{"success":true}"#
        do { _ = try await client.completePhoneLink(invitationID: "fixture"); XCTFail("Must not invent linked identity") }
        catch { XCTAssertNotNil(error as? RallyClientError) }
        transport.failure = CancellationError()
        do { _ = try await client.register(displayName: "Fixture"); XCTFail("Expected cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
    }

    func testProtectedSubscriptionFailureHasNoPrivateErrorText() async {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        var iterator = client.events().makeAsyncIterator()
        do { _ = try await iterator.next(); XCTFail("Expected query denial") }
        catch {
            XCTAssertTrue(error.localizedDescription.contains("cleared"))
            XCTAssertFalse(error.localizedDescription.contains("private-token"))
        }
    }

    func testVersionedStructuredPhoneErrorsPreserveProofAndConflictSemantics() async {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        let codes: [String: PhoneLinkFailure] = [
            "PHONE_PROOF_REQUIRED": .proofRequired, "PHONE_CHALLENGE_EXPIRED": .expired,
            "PHONE_IDENTITY_CONFLICT": .identityConflict, "PHONE_CHANGE_NOT_SUPPORTED": .phoneChangeUnsupported,
            "LINK_PHONE_BEFORE_CREATING_EVENTS": .linkBeforeEvents
        ]
        for (code, expected) in codes {
            transport.failure = ClientError.ConvexError(data: "{\"version\":1,\"code\":\"\(code)\"}")
            do { _ = try await client.completePhoneLink(invitationID: "fixture"); XCTFail("Expected \(code)") }
            catch { XCTAssertEqual(error as? PhoneLinkFailure, expected) }
        }
    }

    func testStructuredAuthorizationAndVersionConflictsUseSafeTypedErrors() async {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        let codes: [String: RallyClientError] = [
            "AUTHENTICATION_REQUIRED": .authenticationRequired, "ACCESS_DENIED": .accessDenied,
            "INVALID_INPUT": .validation("Check the details and try again."),
            "PHONE_LINK_REQUIRED": .phoneLinkRequired, "STALE_EVENT": .staleEvent,
            "STALE_TASK": .staleTask, "IDEMPOTENCY_CONFLICT": .idempotencyConflict,
            "EVENT_CLOSED": .eventClosed, "INVALID_EVENT_TRANSITION": .invalidEventTransition,
            "ALREADY_ENROLLED": .alreadyEnrolled, "INVITATIONS_UNAVAILABLE": .invitationsUnavailable
        ]
        for (code, expected) in codes {
            transport.failure = ClientError.ConvexError(data: "{\"version\":1,\"code\":\"\(code)\"}")
            do { _ = try await client.confirmDraft(eventID: "fixture", expectedVersion: 1); XCTFail("Expected \(code)") }
            catch { XCTAssertEqual(error as? RallyClientError, expected) }
        }
        transport.subscriptionFailure = ClientError.ConvexError(data: #"{"version":1,"code":"AUTHENTICATION_REQUIRED"}"#)
        var iterator = client.account().makeAsyncIterator()
        do { _ = try await iterator.next(); XCTFail("Expected typed query denial") }
        catch { XCTAssertEqual(error as? RallyClientError, .authenticationRequired) }
    }

    func testUnknownStructuredPayloadsRemainGenericWithoutRawText() async {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        for payload in [
            #"{"version":2,"code":"AUTHENTICATION_REQUIRED"}"#,
            #"{"version":1,"code":"FUTURE_ERROR"}"#,
            #"{"version":1,"code":"AUTHENTICATION_REQUIRED","private-token":"secret"}"#,
            #"{"code":"AUTHENTICATION_REQUIRED"}"#, #""AUTHENTICATION_REQUIRED""#, "not-json"
        ] {
            transport.failure = ClientError.ConvexError(data: payload)
            do { _ = try await client.register(displayName: "Fixture"); XCTFail("Expected generic error") }
            catch {
                guard let safe = error as? RallyClientError, case .unavailable = safe else { XCTFail("Unknown payload gained semantics"); continue }
                XCTAssertFalse(error.localizedDescription.contains("private-token"))
                XCTAssertFalse(error.localizedDescription.contains("AUTHENTICATION_REQUIRED"))
            }
        }
    }

    func testAccountStatusAndRouteQueriesUseCurrentIdentityOnly() async throws {
        let transport = FixtureAPITransport()
        let client = ConvexRallyClient(transport: transport)
        transport.subscriptionResult = #"{"userId":"current-user","displayName":"Alex","phoneLinked":true,"messagingState":"active"}"#
        var account = client.account().makeAsyncIterator()
        let accountValue = try await account.next()
        XCTAssertTrue(try XCTUnwrap(accountValue).phoneLinked)
        XCTAssertEqual(transport.calls.last?.name, "accounts:current")
        XCTAssertEqual(transport.calls.last?.arguments, [:])

        transport.subscriptionResult = #"{"status":"available","destination":"+15550009999","expiresAt":2000000000000}"#
        var route = client.rallyRoute().makeAsyncIterator()
        let routeValue = try await route.next()
        XCTAssertEqual(routeValue, .available(destination: "+15550009999", expiresAt: 2_000_000_000_000))
        XCTAssertEqual(transport.calls.last?.name, "appStatus:route")
        XCTAssertEqual(transport.calls.last?.arguments, [:])

        transport.subscriptionResult = #"[{"eventId":"event-fixture","progress":{"total":3,"confirmed":1,"needsCoverage":1,"completed":1,"canceled":0}}]"#
        var progress = client.eventProgress().makeAsyncIterator()
        let progressValue = try await progress.next()
        XCTAssertEqual(progressValue?.first?.progress.confirmed, 1)
        XCTAssertEqual(transport.calls.last?.name, "appStatus:overview")
        XCTAssertEqual(transport.calls.last?.arguments, [:])

        transport.subscriptionResult = #"{"eventId":"event-fixture","progress":{"total":1,"confirmed":1,"needsCoverage":0,"completed":0,"canceled":0},"messaging":{"membershipState":"enrolled","consentRecorded":false,"notificationsEnabled":false,"messagingState":"active","canReceiveMessages":false},"route":{"status":"unavailable"},"activity":[]}"#
        var status = client.eventStatus(eventID: "event-fixture").makeAsyncIterator()
        let statusValue = try await status.next()
        XCTAssertFalse(try XCTUnwrap(statusValue).messaging.canReceiveMessages)
        XCTAssertEqual(transport.calls.last?.name, "appStatus:event")
        XCTAssertEqual(transport.calls.last?.arguments, ["eventId": #""event-fixture""#])
    }
}

@MainActor
private final class FixtureAPITransport: RallyAPITransport {
    struct Call { let name: String; let arguments: [String: String] }
    var calls: [Call] = []
    var result = "null"
    var failure: (any Error)?
    var subscriptionResult: String?
    var subscriptionFailure: ClientError?
    var subscriptionQueue: DispatchQueue?

    func mutation<Result: Decodable & Sendable>(_ name: String, arguments: sending [String: ConvexEncodable?]) async throws -> Result {
        calls.append(Call(name: name, arguments: try arguments.mapValues { try $0?.convexEncode() ?? "null" }))
        if let failure { throw failure }
        return try JSONDecoder().decode(Result.self, from: Data(result.utf8))
    }

    func subscribe<Value: Decodable & Sendable>(_ name: String, arguments: [String: ConvexEncodable?]) -> AnyPublisher<Value, ClientError> {
        do {
            calls.append(Call(name: name, arguments: try arguments.mapValues { try $0?.convexEncode() ?? "null" }))
            if let subscriptionFailure { return deliver(Fail(error: subscriptionFailure).eraseToAnyPublisher()) }
            guard let subscriptionResult else {
                return Fail(error: ClientError.ServerError(msg: "private-token unauthorized event content")).eraseToAnyPublisher()
            }
            let value = try JSONDecoder().decode(Value.self, from: Data(subscriptionResult.utf8))
            return deliver(Just(value).setFailureType(to: ClientError.self).eraseToAnyPublisher())
        } catch {
            return Fail(error: ClientError.InternalError(msg: "Fixture decoding failed")).eraseToAnyPublisher()
        }
    }

    private func deliver<Value>(_ publisher: AnyPublisher<Value, ClientError>) -> AnyPublisher<Value, ClientError> {
        guard let subscriptionQueue else { return publisher }
        return publisher.receive(on: subscriptionQueue).eraseToAnyPublisher()
    }
}
