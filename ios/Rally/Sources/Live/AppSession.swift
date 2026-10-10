@preconcurrency import Auth0
@preconcurrency import Combine
@preconcurrency import ConvexAuth0
@preconcurrency import ConvexMobile
import Foundation

/// Injectable without a browser, credentials, a socket, or a real account.
@MainActor
protocol SessionAuthenticating: AnyObject {
    var rallyClient: any RallyClient { get }
    var connected: AnyPublisher<Bool, Never> { get }
    var unauthenticated: AnyPublisher<Bool, Never> { get }
    func login() async throws
    func logout() async -> Bool
    func clearLocalCredentials() -> Bool
}

@MainActor
private final class SDKSessionAuthentication: SessionAuthenticating {
    private let sdk: ConvexClientWithAuth<Credentials>
    private let clearCredentialCache: () -> Bool
    let rallyClient: any RallyClient

    init(sdk: ConvexClientWithAuth<Credentials>, clearCredentialCache: @escaping () -> Bool) {
        self.sdk = sdk
        self.clearCredentialCache = clearCredentialCache
        rallyClient = ConvexRallyClient(convex: sdk)
    }

    var connected: AnyPublisher<Bool, Never> {
        sdk.watchWebSocketState().map { @Sendable state in state == .connected }.eraseToAnyPublisher()
    }

    var unauthenticated: AnyPublisher<Bool, Never> {
        // Reduce credentials on the SDK executor, before scheduling UI delivery.
        sdk.authState.dropFirst().map { @Sendable state in
            if case .unauthenticated = state { return true }
            return false
        }.eraseToAnyPublisher()
    }

    func login() async throws { _ = try await sdk.login().get() }

    func clearLocalCredentials() -> Bool {
        clearCredentialCache()
    }

    func logout() async -> Bool {
        // SDK logout swallows provider errors. Clear this device's cache even
        // when the user cancels the provider's browser logout.
        let cleared = clearLocalCredentials()
        await sdk.logout()
        // A canceled login may finish while browser logout is suspended.
        let clearedAfterLogout = clearLocalCredentials()
        return cleared && clearedAfterLogout
    }
}

/// Protected subscriptions cannot start until account registration succeeds.
@MainActor
final class AppSession: ObservableObject {
    @Published private(set) var client: (any RallyClient)?
    @Published private var authenticationOperations = 0
    @Published private(set) var isRegistering = false
    @Published private(set) var canRetryRegistration = false
    @Published private(set) var canCreateEvents = false
    @Published private(set) var phoneVerifiedForSession = false
    @Published private(set) var accountUserID: String?
    @Published private(set) var identityGeneration = UUID()
    @Published private(set) var error: String?
    @Published private(set) var connection: LiveConnectionState = .inactive

    private let makeAuthentication: (() -> any SessionAuthenticating)?
    private var authentication: (any SessionAuthenticating)?
    private var authSubscription: AnyCancellable?
    private var connectionSubscription: AnyCancellable?
    private var sessionGeneration = UUID()
    private var registrationName = ""
    private var signOutInFlight = false
    private var loginSucceeded = false

    var liveConfigured: Bool { makeAuthentication != nil }
    var isSigningIn: Bool { authenticationOperations > 0 }

    init(
        configuration: LiveConfiguration? = LiveConfiguration.load(),
        makeAuthClient: @escaping (LiveConfiguration) -> ConvexClientWithAuth<Credentials> = {
            ConvexClientWithAuth(deploymentUrl: $0.deploymentURL, authProvider: Auth0Provider())
        },
        clearCredentialCache: @escaping () -> Bool = {
            CredentialsManager(authentication: Auth0.authentication()).clear()
        }
    ) {
        if let configuration {
            makeAuthentication = {
                SDKSessionAuthentication(sdk: makeAuthClient(configuration), clearCredentialCache: clearCredentialCache)
            }
        } else {
            makeAuthentication = nil
        }
    }

    init(authentication: any SessionAuthenticating) {
        makeAuthentication = { authentication }
    }

    func enterDemo() {
        guard !isSigningIn, authentication == nil else { return }
        error = nil
        connection = .inactive
        identityGeneration = UUID()
        let demo = MockRallyClient()
        accountUserID = demo.session.userID
        client = demo
        phoneVerifiedForSession = false
        canCreateEvents = true // Explicit fictional fixture, never live proof.
    }

    func signIn(displayName: String) async {
        guard !isSigningIn, client == nil, authentication == nil else { return }
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 120 else {
            error = "Enter your name using 1–120 characters."
            return
        }
        guard let makeAuthentication else {
            error = "Live sign-in is not configured for this build."
            return
        }
        registrationName = name
        authenticationOperations += 1
        defer { authenticationOperations -= 1 }
        error = nil
        loginSucceeded = false
        let generation = UUID()
        sessionGeneration = generation
        let boundary = makeAuthentication()
        authentication = boundary
        connection = .connecting
        connectionSubscription = boundary.connected.receive(on: DispatchQueue.main)
            .sink { [weak self] connected in
                guard let self, self.sessionGeneration == generation else { return }
                self.connection = connected ? .connected : .connecting
            }
        authSubscription = boundary.unauthenticated.receive(on: DispatchQueue.main)
            .sink { [weak self] unauthenticated in
                guard unauthenticated, let self, self.sessionGeneration == generation,
                      self.loginSucceeded else { return }
                self.authenticationExpired()
            }
        do {
            try await boundary.login()
            guard sessionGeneration == generation else {
                // A canceled login may finish after sign-out. Discard its newly
                // stored credentials before allowing another login attempt.
                _ = await boundary.logout()
                return
            }
            loginSucceeded = true
            await register(using: boundary, generation: generation)
        } catch {
            guard sessionGeneration == generation else {
                _ = boundary.clearLocalCredentials()
                return
            }
            sessionGeneration = UUID()
            clearProtectedState()
            _ = boundary.clearLocalCredentials()
            authentication = nil
            self.error = error is CancellationError
                ? "Sign-in was canceled. You can try again."
                : "Sign-in did not complete. Try again or check this build’s Auth0 and Convex configuration."
        }
    }

    func retryRegistration() async {
        guard canRetryRegistration, !isSigningIn, let authentication else { return }
        authenticationOperations += 1
        defer { authenticationOperations -= 1 }
        await register(using: authentication, generation: sessionGeneration)
    }

    private func register(using boundary: any SessionAuthenticating, generation: UUID) async {
        isRegistering = true
        canRetryRegistration = false
        error = nil
        do {
            let userID = try await boundary.rallyClient.register(displayName: registrationName)
            guard sessionGeneration == generation else { return }
            accountUserID = userID
            identityGeneration = UUID()
            // No account/link read API exists. Never restore proof from a flag.
            canCreateEvents = false
            phoneVerifiedForSession = false
            client = boundary.rallyClient
        } catch {
            guard sessionGeneration == generation else { return }
            if error as? RallyClientError == .authenticationRequired {
                authenticationExpired()
                return
            }
            client = nil
            accountUserID = nil
            canCreateEvents = false
            canRetryRegistration = true
            self.error = "Your Rally account could not be prepared. Retry setup or sign out and try again."
        }
        isRegistering = false
    }

    /// Accept only the completion result belonging to the current view session.
    func phoneLinkCompleted(canonicalUserID: String, expectedGeneration: UUID) {
        guard client != nil, identityGeneration == expectedGeneration else { return }
        if accountUserID != canonicalUserID {
            accountUserID = canonicalUserID
            identityGeneration = UUID() // Recreate all identity-scoped views.
        }
        phoneVerifiedForSession = true
        canCreateEvents = true
    }

    func authenticationExpired() {
        let previous = authentication
        sessionGeneration = UUID()
        clearProtectedState()
        authentication = nil
        _ = previous?.clearLocalCredentials()
        error = "Your session ended. Sign in again to view your events."
    }

    func signOut() async {
        guard !signOutInFlight else { return }
        signOutInFlight = true
        authenticationOperations += 1
        defer {
            signOutInFlight = false
            authenticationOperations -= 1
        }
        let generation = UUID()
        sessionGeneration = generation
        let previous = authentication
        authentication = nil
        clearProtectedState()
        error = nil
        let cleared = await previous?.logout() ?? true
        guard sessionGeneration == generation else { return }
        if !cleared {
            error = "The local sign-in cache could not be cleared. Close the app and retry sign-out."
        }
    }

    private func clearProtectedState() {
        client = nil
        accountUserID = nil
        canCreateEvents = false
        phoneVerifiedForSession = false
        identityGeneration = UUID()
        canRetryRegistration = false
        isRegistering = false
        loginSucceeded = false
        authSubscription = nil
        connectionSubscription = nil
        connection = .inactive
    }
}
