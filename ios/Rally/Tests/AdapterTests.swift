import XCTest
@preconcurrency import Combine
@preconcurrency import ConvexMobile
@testable import Rally

@MainActor
final class AdapterTests: XCTestCase {
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
}

@MainActor
private final class FixtureAPITransport: RallyAPITransport {
    struct Call { let name: String; let arguments: [String: String] }
    var calls: [Call] = []
    var result = "null"
    var failure: (any Error)?

    func mutation<Result: Decodable & Sendable>(_ name: String, arguments: sending [String: ConvexEncodable?]) async throws -> Result {
        calls.append(Call(name: name, arguments: try arguments.mapValues { try $0?.convexEncode() ?? "null" }))
        if let failure { throw failure }
        return try JSONDecoder().decode(Result.self, from: Data(result.utf8))
    }

    func subscribe<Value: Decodable & Sendable>(_ name: String, arguments: [String: ConvexEncodable?]) -> AnyPublisher<Value, ClientError> {
        Fail(error: ClientError.ServerError(msg: "private-token unauthorized event content")).eraseToAnyPublisher()
    }
}
