import XCTest
@preconcurrency import Combine
@testable import Rally

@MainActor
final class SessionTests: XCTestCase {
    func testLaunchRestoresCachedLoginOnceWithoutRegisteringOrOpeningBrowser() async {
        let client = SessionFixtureClient()
        client.accountInitialStatus = AccountStatus(userId: "canonical", displayName: "Alex", phoneLinked: true, messagingState: .active)
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        await session.restoreSession()
        await session.restoreSession()
        XCTAssertEqual(auth.restoreCount, 1)
        XCTAssertEqual(auth.loginCount, 0)
        XCTAssertTrue(client.registrationNames.isEmpty)
        XCTAssertNotNil(session.client)
        XCTAssertEqual(session.accountUserID, "canonical")
        XCTAssertTrue(session.phoneVerifiedForSession)
        await session.signOut()
        await session.restoreSession()
        XCTAssertNil(session.client)
        XCTAssertEqual(auth.restoreCount, 1)
    }

    func testMissingCacheLeavesOrdinarySignInAvailable() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        auth.restoreOperation = { false }
        let session = AppSession(authentication: auth)
        await session.restoreSession()
        XCTAssertNil(session.client)
        XCTAssertNil(session.error)
        XCTAssertFalse(session.isSigningIn)
        await session.signIn(displayName: "Alex")
        XCTAssertNotNil(session.client)
        XCTAssertEqual(auth.loginCount, 1)
    }

    func testRestorationWaitsForAuthorizedAccountAndCanRetryReadWithoutLogin() async {
        let client = SessionFixtureClient()
        client.accountInitialStatus = nil
        let subscribed = expectation(description: "Restored account read started")
        client.onAccountSubscribe = { subscribed.fulfill() }
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        let restore = Task { await session.restoreSession() }
        await fulfillment(of: [subscribed], timeout: 2)
        XCTAssertNil(session.client)
        XCTAssertTrue(session.isRestoring)
        client.failAccount(RallyClientError.unavailable("Offline fixture"))
        await restore.value
        XCTAssertTrue(session.canRetryRegistration)
        XCTAssertEqual(auth.clearCount, 0)
        client.onAccountSubscribe = nil
        client.accountInitialStatus = AccountStatus(userId: "canonical", displayName: "Alex", phoneLinked: true, messagingState: .active)
        await session.retryRegistration()
        XCTAssertNotNil(session.client)
        XCTAssertTrue(client.registrationNames.isEmpty)
        XCTAssertEqual(auth.loginCount, 0)
        await session.signOut()
    }

    func testSignOutDuringRestoreRejectsLateCredentials() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        let gate = SessionTestGate<Bool>()
        auth.restoreOperation = { await gate.wait() }
        let session = AppSession(authentication: auth)
        let restore = Task { await session.restoreSession() }
        await fulfillment(of: [gate.entered], timeout: 2)
        await session.signOut()
        gate.resume(true)
        await restore.value
        XCTAssertNil(session.client)
        XCTAssertFalse(session.isSigningIn)
        XCTAssertEqual(auth.logoutCount, 2)
    }

    func testCacheNetworkFailureDoesNotDeleteSavedCredentials() async {
        let auth = SessionFixtureAuthentication(client: SessionFixtureClient())
        auth.restoreOperation = { throw RallyClientError.unavailable("Offline fixture") }
        let session = AppSession(authentication: auth)
        await session.restoreSession()
        XCTAssertNil(session.client)
        XCTAssertNotNil(session.error)
        XCTAssertEqual(auth.clearCount, 0)
        XCTAssertEqual(auth.logoutCount, 0)
    }

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

    func testAccountReadMustSucceedBeforeExposureAndRestoresServerPhoneProof() async {
        let client = SessionFixtureClient()
        client.accountInitialStatus = nil
        let subscribed = expectation(description: "Account read started after registration")
        client.onAccountSubscribe = { subscribed.fulfill() }
        let session = AppSession(authentication: SessionFixtureAuthentication(client: client))
        let login = Task { await session.signIn(displayName: "Alex") }
        await fulfillment(of: [subscribed], timeout: 2)
        XCTAssertEqual(client.registrationNames, ["Alex"])
        XCTAssertNil(session.client)
        XCTAssertFalse(session.phoneVerifiedForSession)
        client.sendAccount(AccountStatus(userId: "server-canonical", displayName: "Alex", phoneLinked: true, messagingState: .paused))
        await login.value
        XCTAssertNotNil(session.client)
        XCTAssertEqual(session.accountUserID, "server-canonical")
        XCTAssertTrue(session.phoneVerifiedForSession)
        XCTAssertTrue(session.canCreateEvents)
        XCTAssertEqual(session.accountStatus?.messagingState, .paused)
        await session.signOut()
    }

    func testAccountSubscriptionRebindsIdentityAndRevokesPhoneProof() async {
        let client = SessionFixtureClient()
        client.accountInitialStatus = AccountStatus(userId: "initial", displayName: "Alex", phoneLinked: true, messagingState: .active)
        let session = AppSession(authentication: SessionFixtureAuthentication(client: client))
        await session.signIn(displayName: "Alex")
        let initialGeneration = session.identityGeneration
        let rebound = expectation(description: "Canonical identity update")
        let identityToken = session.$accountStatus.dropFirst().sink { if $0?.userId == "replacement" { rebound.fulfill() } }
        client.sendAccount(AccountStatus(userId: "replacement", displayName: "Alex", phoneLinked: true, messagingState: .active))
        await fulfillment(of: [rebound], timeout: 2)
        identityToken.cancel()
        XCTAssertNotEqual(session.identityGeneration, initialGeneration)
        let linkedGeneration = session.identityGeneration
        let revoked = expectation(description: "Phone proof removed")
        let proofToken = session.$phoneVerifiedForSession.dropFirst().sink { if !$0 { revoked.fulfill() } }
        client.sendAccount(AccountStatus(userId: "replacement", displayName: "Alex", phoneLinked: false, messagingState: .stopped))
        await fulfillment(of: [revoked], timeout: 2)
        proofToken.cancel()
        XCTAssertFalse(session.canCreateEvents)
        XCTAssertNotEqual(session.identityGeneration, linkedGeneration)
        await session.signOut()
    }

    func testLostAccountReadClearsProtectedStateAndCanRetrySameAuthentication() async {
        let client = SessionFixtureClient()
        client.accountInitialStatus = AccountStatus(userId: "registered-account", displayName: "Alex", phoneLinked: true, messagingState: .active)
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "Alex")
        let cleared = expectation(description: "Protected views removed on read failure")
        let token = session.$client.dropFirst().sink { if $0 == nil { cleared.fulfill() } }
        client.failAccount(RallyClientError.unavailable("Fixture disconnected"))
        await fulfillment(of: [cleared], timeout: 2)
        token.cancel()
        XCTAssertNil(session.accountStatus)
        XCTAssertFalse(session.phoneVerifiedForSession)
        XCTAssertFalse(session.canCreateEvents)
        XCTAssertTrue(session.canRetryRegistration)
        await session.retryRegistration()
        XCTAssertEqual(auth.loginCount, 1)
        XCTAssertTrue(session.phoneVerifiedForSession)
        XCTAssertNotNil(session.client)
        await session.signOut()
    }

    func testAccountAuthenticationDenialEndsSessionWithoutRetryingProtectedReads() async {
        let client = SessionFixtureClient()
        let auth = SessionFixtureAuthentication(client: client)
        let session = AppSession(authentication: auth)
        await session.signIn(displayName: "Alex")
        let cleared = expectation(description: "Denied account invalidates authentication")
        let token = session.$client.dropFirst().sink { if $0 == nil { cleared.fulfill() } }
        client.failAccount(RallyClientError.authenticationRequired)
        await fulfillment(of: [cleared], timeout: 2)
        token.cancel()
        XCTAssertFalse(session.canRetryRegistration)
        XCTAssertNil(session.accountStatus)
        XCTAssertEqual(auth.clearCount, 1)
    }

    func testSignOutCancelsPendingInitialAccountRead() async {
        let client = SessionFixtureClient()
        client.accountInitialStatus = nil
        let subscribed = expectation(description: "Waiting for account")
        client.onAccountSubscribe = { subscribed.fulfill() }
        let session = AppSession(authentication: SessionFixtureAuthentication(client: client))
        let login = Task { await session.signIn(displayName: "Alex") }
        await fulfillment(of: [subscribed], timeout: 2)
        await session.signOut()
        await login.value
        XCTAssertNil(session.client)
        XCTAssertNil(session.accountStatus)
        XCTAssertFalse(session.isSigningIn)
        client.sendAccount(AccountStatus(userId: "late-account", displayName: "Alex", phoneLinked: true, messagingState: .active))
        XCTAssertFalse(session.phoneVerifiedForSession)
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
    var restoreOperation: (() async throws -> Bool)?
    var logoutOperation: (() async -> Bool)?
    private(set) var loginCount = 0
    private(set) var restoreCount = 0
    private(set) var logoutCount = 0
    private(set) var clearCount = 0
    init(client: any RallyClient) { rallyClient = client }
    func login() async throws { loginCount += 1; try await loginOperation?() }
    func restore() async throws -> Bool { restoreCount += 1; return try await restoreOperation?() ?? true }
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
    var accountInitialStatus: AccountStatus? = AccountStatus(userId: "registered-account", displayName: "Alex",
                                                            phoneLinked: false, messagingState: .active)
    var onAccountSubscribe: (() -> Void)?
    private var accountListeners: [UUID: AsyncThrowingStream<AccountStatus, Error>.Continuation] = [:]
    private(set) var registrationNames: [String] = []
    private(set) var requestedKeys: [String] = []
    private(set) var completionCalls = 0
    func register(displayName: String) async throws -> String {
        registrationNames.append(displayName)
        return try await registrationOperation?(displayName) ?? "registered-account"
    }
    func account() -> AsyncThrowingStream<AccountStatus, Error> {
        let token = UUID()
        return AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            accountListeners[token] = continuation
            if let accountInitialStatus { continuation.yield(accountInitialStatus) }
            onAccountSubscribe?()
            continuation.onTermination = { @Sendable [weak self] _ in
                Task { @MainActor [weak self] in self?.accountListeners.removeValue(forKey: token) }
            }
        }
    }
    func sendAccount(_ status: AccountStatus) {
        accountInitialStatus = status
        for listener in accountListeners.values { listener.yield(status) }
    }
    func failAccount(_ error: Error) {
        for listener in accountListeners.values { listener.finish(throwing: error) }
        accountListeners.removeAll()
    }
    func rallyRoute() -> AsyncThrowingStream<RallyRoute, Error> { .init { $0.yield(.unavailable); $0.finish() } }
    func eventStatus(eventID: String) -> AsyncThrowingStream<EventAppStatus, Error> { .init { $0.finish(throwing: RallyClientError.accessDenied) } }
    func eventProgress() -> AsyncThrowingStream<[EventProgressSummary], Error> { .init { $0.yield([]); $0.finish() } }
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
