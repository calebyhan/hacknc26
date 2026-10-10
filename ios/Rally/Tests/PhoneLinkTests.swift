import XCTest
@testable import Rally

@MainActor
final class PhoneLinkTests: XCTestCase {
    func testCodeAndFailedProofStayPendingUntilServerCompletion() async {
        let client = SessionFixtureClient()
        let model = PhoneLinkModel(client: client)
        model.phone = "+1 (555) 555-0100"
        await model.requestCode()
        XCTAssertEqual(model.state, .pending)
        XCTAssertNil(model.verifiedUserID)
        XCTAssertEqual(model.phone, "+15555550100")
        await model.checkProof()
        XCTAssertEqual(model.state, .pending)
        XCTAssertNil(model.verifiedUserID)
        XCTAssertEqual(model.message, PhoneLinkFailure.proofRequired.localizedDescription)
        client.completeOperation = { _ in "canonical-phone-account" }
        await model.checkProof()
        XCTAssertEqual(model.state, .linked)
        XCTAssertEqual(model.verifiedUserID, "canonical-phone-account")
        await model.checkProof()
        XCTAssertEqual(client.completionCalls, 2)
    }

    func testUncertainRequestRetriesSameKeyAndExplicitExpiryRenewalUsesNewKey() async {
        let client = SessionFixtureClient()
        var time = Date(timeIntervalSince1970: 1_000)
        client.beginOperation = { _, _ in throw RallyClientError.unavailable("Fixture timeout") }
        let model = PhoneLinkModel(client: client, now: { time })
        model.phone = "+15555550100"
        await model.requestCode()
        client.beginOperation = { _, _ in
            PhoneLinkChallenge(invitationId: "first", code: "FIRST", expiresAt: 1_001_000)
        }
        await model.requestCode()
        XCTAssertEqual(client.requestedKeys.count, 2)
        XCTAssertEqual(client.requestedKeys[0], client.requestedKeys[1])
        time = Date(timeIntervalSince1970: 1_002)
        model.refreshExpiry()
        XCTAssertEqual(model.state, .expired)
        await model.checkProof()
        await model.requestCode()
        XCTAssertEqual(client.completionCalls, 0)
        XCTAssertEqual(client.requestedKeys.count, 2)
        client.beginOperation = { _, _ in throw RallyClientError.unavailable("Fixture renewal timeout") }
        await model.requestCode(renew: true)
        XCTAssertNil(model.challenge)
        XCTAssertNotEqual(client.requestedKeys[1], client.requestedKeys[2])
        client.beginOperation = { _, _ in
            PhoneLinkChallenge(invitationId: "second", code: "SECOND", expiresAt: 1_100_000)
        }
        await model.requestCode()
        XCTAssertEqual(client.requestedKeys[2], client.requestedKeys[3])
        XCTAssertEqual(model.state, .pending)
    }

    func testIdentityConflictsAndExpiryNeverEstablishProof() async {
        for failure in [PhoneLinkFailure.identityConflict, .linkBeforeEvents, .phoneChangeUnsupported, .expired] {
            let client = SessionFixtureClient()
            client.completeOperation = { _ in throw failure }
            let model = PhoneLinkModel(client: client)
            model.phone = "+15555550100"
            await model.requestCode()
            await model.checkProof()
            XCTAssertNil(model.verifiedUserID)
            XCTAssertEqual(model.message, failure.localizedDescription)
            XCTAssertEqual(model.state, failure == .expired ? .expired : .pending)
        }
    }

    func testRawBackendErrorsAreNeverParsedOrDisplayedAndAuthFailureIsExplicit() async {
        let client = SessionFixtureClient()
        let model = PhoneLinkModel(client: client)
        model.phone = "+15555550100"
        await model.requestCode()
        client.completeOperation = { _ in
            throw NSError(domain: "Fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "UNAUTHORIZED PHONE_PROOF_REQUIRED private-server-detail"])
        }
        await model.checkProof()
        XCTAssertEqual(model.state, .pending)
        XCTAssertFalse(model.authenticationRequired)
        XCTAssertFalse(model.message?.contains("private-server-detail") ?? true)
        client.completeOperation = { _ in throw RallyClientError.authenticationRequired }
        await model.checkProof()
        XCTAssertTrue(model.authenticationRequired)
        XCTAssertNil(model.verifiedUserID)
    }

    func testInvalidPhoneCannotRequestChallenge() async {
        let client = SessionFixtureClient()
        let model = PhoneLinkModel(client: client)
        model.phone = "5555550100"
        await model.requestCode()
        XCTAssertEqual(model.state, .idle)
        XCTAssertTrue(client.requestedKeys.isEmpty)
        XCTAssertNotNil(model.message)
    }
}
