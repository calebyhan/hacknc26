import XCTest
@preconcurrency import Combine
@testable import Rally

@MainActor
final class SessionTests: XCTestCase {
    func testRegistrationPrecedesProtectedClientAndPhoneProofGatesCreation() async {
        let client = SessionFixtureClient()
        let gate = SessionTestGate<String>()
        client.registrationOperation = { _ in await gate.wait() }
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        let login = Task { await session.signIn(displayName: "  Alex Example  ") }
        await fulfillment(of: [gate.entered], timeout: 2)
        XCTAssertNil(session.client)
        XCTAssertTrue(session.isRegistering)
        XCTAssertFalse(session.canCreateEvents)
        XCTAssertFalse(session.phoneVerifiedForSession)
        gate.resume("temporary-account")
        await login.value
        XCTAssertNotNil(session.client)
        XCTAssertEqual(client.registrationNames, ["Alex Example"])
        XCTAssertFalse(session.canCreateEvents)
        let originalGeneration = session.identityGeneration
        session.phoneLinkCompleted(canonicalUserID: "phone-canonical-account", expectedGeneration: originalGeneration)
        XCTAssertTrue(session.canCreateEvents)
        XCTAssertTrue(session.phoneVerifiedForSession)
        XCTAssertEqual(session.accountUserID, "phone-canonical-account")
        XCTAssertNotEqual(session.identityGeneration, originalGeneration)
        session.phoneLinkCompleted(canonicalUserID: "stale-account", expectedGeneration: originalGeneration)
        XCTAssertEqual(session.accountUserID, "phone-canonical-account")
    }

    func testRegistrationFailureCanRetryWithoutReloginOrDemoFallback() async {
        let client = SessionFixtureClient()
        client.registrationOperation = { _ in throw RallyClientError.unavailable("Fixture unavailable") }
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "Alex")
        XCTAssertNil(session.client)
        XCTAssertTrue(session.canRetryRegistration)
        session.enterDemo()
        XCTAssertNil(session.client)
        client.registrationOperation = nil
        await session.retryRegistration()
        XCTAssertEqual(auth.loginCount, 1)
        XCTAssertEqual(client.registrationNames, ["Alex", "Alex"])
        XCTAssertNotNil(session.client)
        XCTAssertFalse(session.canRetryRegistration)
    }

    func testSignOutDiscardsRegistrationThatCompletesAfterward() async {
        let client = SessionFixtureClient()
        let gate = SessionTestGate<String>()
        client.registrationOperation = { _ in await gate.wait() }
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        let login = Task { await session.signIn(displayName: "Alex") }
        await fulfillment(of: [gate.entered], timeout: 2)
        await session.signOut()
        gate.resume("late-account")
        await login.value
        XCTAssertNil(session.client)
        XCTAssertNil(session.accountUserID)
        XCTAssertFalse(session.canCreateEvents)
        XCTAssertFalse(session.isSigningIn)
        XCTAssertEqual(auth.logoutCount, 1)
    }

    func testCanceledInflightLoginCannotExposeAccountOrSurviveInCredentialCache() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        let gate = SessionTestGate<Void>()
        auth.loginOperation = { await gate.wait() }
        let session = AppSession(authentication: auth)
        let login = Task { await session.signIn(displayName: "Alex") }
        await fulfillment(of: [gate.entered], timeout: 2)
        await session.signOut()
        XCTAssertNil(session.client)
        XCTAssertTrue(session.isSigningIn) // No overlapping login/cache race.
        gate.resume(())
        await login.value
        XCTAssertNil(session.client)
        XCTAssertFalse(session.isSigningIn)
        XCTAssertEqual(auth.logoutCount, 2) // Late credentials cleared again.
    }

    func testAuthExpiryClearsIdentityProofAndProtectedClient() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "Alex")
        session.phoneLinkCompleted(canonicalUserID: "registered-account", expectedGeneration: session.identityGeneration)
        XCTAssertTrue(session.canCreateEvents)
        let changed = expectation(description: "Auth invalidation reaches UI")
        let token = session.$client.dropFirst().sink { if $0 == nil { changed.fulfill() } }
        auth.authChanges.send(true)
        await fulfillment(of: [changed], timeout: 2)
        token.cancel()
        XCTAssertNil(session.accountUserID)
        XCTAssertFalse(session.canCreateEvents)
        XCTAssertEqual(session.connection, .inactive)
        XCTAssertFalse(session.phoneVerifiedForSession)
        XCTAssertEqual(auth.clearCount, 1)
        await session.signIn(displayName: "Alex")
        XCTAssertNotNil(session.client)
        XCTAssertFalse(session.canCreateEvents) // Never restore cached proof.
        XCTAssertFalse(session.phoneVerifiedForSession)
    }

    func testDemoCreationConvenienceDoesNotEstablishPhoneProof() async {
        let session = AppSession(configuration: nil)
        session.enterDemo()
        XCTAssertTrue(session.canCreateEvents)
        XCTAssertFalse(session.phoneVerifiedForSession)
        session.phoneLinkCompleted(canonicalUserID: "usr_alex", expectedGeneration: session.identityGeneration)
        XCTAssertTrue(session.phoneVerifiedForSession)
        await session.signOut()
        XCTAssertFalse(session.phoneVerifiedForSession)
        session.enterDemo()
        XCTAssertTrue(session.canCreateEvents)
        XCTAssertFalse(session.phoneVerifiedForSession)
    }

    func testInvalidNameAndCanceledLoginNeverProvisionAnAccount() async {
        let client = SessionFixtureClient()
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "  \n ")
        await session.signIn(displayName: String(repeating: "A", count: 121))
        XCTAssertEqual(auth.loginCount, 0)
        auth.loginOperation = { throw CancellationError() }
        await session.signIn(displayName: "Alex")
        XCTAssertNil(session.client)
        XCTAssertTrue(client.registrationNames.isEmpty)
        XCTAssertFalse(session.isSigningIn)
    }

    func testSignOutRemovesViewsBeforeAwaitingProviderLogout() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "Alex")
        let gate = SessionTestGate<Bool>()
        auth.logoutOperation = { await gate.wait() }
        let logout = Task { await session.signOut() }
        await fulfillment(of: [gate.entered], timeout: 2)
        XCTAssertNil(session.client)
        XCTAssertNil(session.accountUserID)
        XCTAssertFalse(session.canCreateEvents)
        gate.resume(false)
        await logout.value
        XCTAssertNotNil(session.error)
    }

    func testRepeatedSignOutCannotEnableNewLoginWhileLogoutIsSuspended() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "Alex")
        let gate = SessionTestGate<Bool>()
        auth.logoutOperation = { await gate.wait() }
        let firstSignOut = Task { await session.signOut() }
        await fulfillment(of: [gate.entered], timeout: 2)

        await session.signOut()
        await session.signIn(displayName: "Another account")
        session.enterDemo()
        XCTAssertTrue(session.isSigningIn)
        XCTAssertNil(session.client)
        XCTAssertEqual(auth.loginCount, 1)
        XCTAssertEqual(auth.logoutCount, 1)

        gate.resume(true)
        await firstSignOut.value
        XCTAssertFalse(session.isSigningIn)
        await session.signIn(displayName: "Another account")
        XCTAssertEqual(auth.loginCount, 2)
        XCTAssertNotNil(session.client)
    }

    func testLateLoginSuccessOrFailureCannotReenableSignInDuringLogout() async {
        for shouldFail in [false, true] {
            let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
            let loginGate = SessionTestGate<Void>()
            let logoutGate = SessionTestGate<Bool>()
            auth.loginOperation = {
                await loginGate.wait()
                if shouldFail { throw CancellationError() }
            }
            auth.logoutOperation = {
                // The late-login cleanup may finish before the initial browser
                // logout. Neither completion may permit another login yet.
                if auth.logoutCount == 1 { return await logoutGate.wait() }
                return true
            }
            let session = AppSession(authentication: auth)
            let login = Task { await session.signIn(displayName: "Alex") }
            await fulfillment(of: [loginGate.entered], timeout: 2)
            let logout = Task { await session.signOut() }
            await fulfillment(of: [logoutGate.entered], timeout: 2)
            loginGate.resume(())
            await login.value

            XCTAssertTrue(session.isSigningIn)
            XCTAssertNil(session.client)
            await session.signOut()
            await session.signIn(displayName: "Another account")
            XCTAssertEqual(auth.loginCount, 1)
            XCTAssertEqual(auth.logoutCount, shouldFail ? 1 : 2)

            logoutGate.resume(true)
            await logout.value
            XCTAssertFalse(session.isSigningIn)
            XCTAssertNil(session.client)
        }
    }
}

@MainActor
final class SessionTestGate<Value: Sendable> {
    let entered = XCTestExpectation(description: "Operation suspended")
    private var continuation: CheckedContinuation<Value, Never>?
    func wait() async -> Value {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            entered.fulfill()
        }
    }
    func resume(_ value: Value) { continuation?.resume(returning: value); continuation = nil }
}

@MainActor
final class SessionFixtureAuthentication: SessionAuthenticating {
    let rallyClient: any RallyClient
    let authChanges = PassthroughSubject<Bool, Never>()
    let connections = PassthroughSubject<Bool, Never>()
    var connected: AnyPublisher<Bool, Never> { connections.eraseToAnyPublisher() }
    var unauthenticated: AnyPublisher<Bool, Never> { authChanges.eraseToAnyPublisher() }
    var loginOperation: (() async throws -> Void)?
    var logoutOperation: (() async -> Bool)?
    private(set) var loginCount = 0
    private(set) var logoutCount = 0
    private(set) var clearCount = 0
    init(client: any RallyClient) { rallyClient = client }
    func login() async throws { loginCount += 1; try await loginOperation?() }
    func logout() async -> Bool { logoutCount += 1; return await logoutOperation?() ?? true }
    func clearLocalCredentials() -> Bool { clearCount += 1; return true }
}

/// All methods are local, with no provider, network, or account side effects.
@MainActor
final class SessionFixtureClient: RallyClient {
    let mode = ClientMode.live
    var registrationOperation: ((String) async throws -> String)?
    var beginOperation: ((String, String) async throws -> PhoneLinkChallenge)?
    var completeOperation: ((String) async throws -> String)?
    private(set) var registrationNames: [String] = []
    private(set) var requestedKeys: [String] = []
    private(set) var completionCalls = 0
    func register(displayName: String) async throws -> String {
        registrationNames.append(displayName)
        return try await registrationOperation?(displayName) ?? "registered-account"
    }
    func beginPhoneLink(phoneE164: String, idempotencyKey: String) async throws -> PhoneLinkChallenge {
        requestedKeys.append(idempotencyKey)
        if let beginOperation { return try await beginOperation(phoneE164, idempotencyKey) }
        return PhoneLinkChallenge(invitationId: "phone-invite", code: "FIXTURE", expiresAt: 2_000_000_000_000)
    }
    func completePhoneLink(invitationID: String) async throws -> String {
        completionCalls += 1
        if let completeOperation { return try await completeOperation(invitationID) }
        throw PhoneLinkFailure.proofRequired
    }
    func events() -> AsyncThrowingStream<[EventSummary], Error> { .init { $0.finish() } }
    func detail(eventID: String) -> AsyncThrowingStream<EventDetail, Error> { .init { $0.finish() } }
    func createEvent(_ input: CreateEventInput) async throws -> String { throw RallyClientError.accessDenied }
    func createInvitations(eventID: String, contacts: [SelectedContact], idempotencyKey: String) async throws -> [CreatedInvitation] { throw RallyClientError.accessDenied }
    func createTask(_ input: CreateTaskInput) async throws -> String { throw RallyClientError.accessDenied }
    func confirmDraft(eventID: String, expectedVersion: Int) async throws -> String { throw RallyClientError.accessDenied }
    func organizerInvitation(eventID: String, idempotencyKey: String) async throws -> PhoneLinkChallenge { throw RallyClientError.accessDenied }
    func approveProposal(proposalID: String) async throws { throw RallyClientError.accessDenied }
}
