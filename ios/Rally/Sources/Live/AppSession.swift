@preconcurrency import Auth0
@preconcurrency import Combine
@preconcurrency import ConvexAuth0
@preconcurrency import ConvexMobile
import Foundation

/// Demo mode is always an explicit choice. A live failure never swaps data sources.
@MainActor
final class AppSession: ObservableObject {
    @Published private(set) var client: (any RallyClient)?
    @Published private(set) var isSigningIn = false
    @Published private(set) var error: String?
    @Published private(set) var connection: LiveConnectionState = .inactive

    private let configuration: LiveConfiguration?
    private let makeAuthClient: (LiveConfiguration) -> ConvexClientWithAuth<Credentials>
    private var authClient: ConvexClientWithAuth<Credentials>?
    private var authSubscription: AnyCancellable?
    private var connectionSubscription: AnyCancellable?
    private var sessionGeneration = UUID()

    var liveConfigured: Bool { configuration != nil }

    init(
        configuration: LiveConfiguration? = LiveConfiguration.load(),
        makeAuthClient: @escaping (LiveConfiguration) -> ConvexClientWithAuth<Credentials> = {
            ConvexClientWithAuth(deploymentUrl: $0.deploymentURL, authProvider: Auth0Provider())
        }
    ) {
        self.configuration = configuration
        self.makeAuthClient = makeAuthClient
    }

    func enterDemo() {
        guard !isSigningIn, authClient == nil else { return }
        error = nil
        connection = .inactive
        client = MockRallyClient()
    }

    func signIn() async {
        guard !isSigningIn, client == nil else { return }
        guard let configuration else {
            error = "Live sign-in is not configured for this build."
            return
        }
        isSigningIn = true
        error = nil
        let generation = UUID()
        sessionGeneration = generation
        // The configuration gate ensures Auth0.plist exists before the SDK reads it.
        let authenticatedClient = makeAuthClient(configuration)
        authClient = authenticatedClient
        connection = .connecting
        // SDK publishers can emit from Swift/Rust background executors. Schedule
        // delivery before entering closures isolated to this UI session.
        connectionSubscription = authenticatedClient.watchWebSocketState()
            .map { @Sendable state in state == .connected }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] connected in
                guard let self, self.sessionGeneration == generation else { return }
                self.connection = connected ? .connected : .connecting
            }
        authSubscription = authenticatedClient.authState.dropFirst()
            // Reduce credentials to a Sendable flag on the emitting executor;
            // credentials never enter the UI subscription's scheduled closure.
            .map { @Sendable state in
                if case .unauthenticated = state { return true }
                return false
            }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] unauthenticated in
                guard unauthenticated, let self, self.sessionGeneration == generation,
                      self.client?.mode == .live else { return }
                self.sessionGeneration = UUID()
                self.client = nil
                self.authSubscription = nil
                self.connectionSubscription = nil
                self.authClient = nil
                self.error = "Your session ended. Sign in again to view your events."
                self.connection = .inactive
            }

        let result = await authenticatedClient.login()
        guard sessionGeneration == generation else { return }
        isSigningIn = false
        switch result {
        case .success:
            client = ConvexRallyClient(convex: authenticatedClient)
        case .failure:
            authSubscription = nil
            connectionSubscription = nil
            authClient = nil
            connection = .inactive
            error = "Sign-in did not complete. Try again or check this build’s Auth0 and Convex configuration."
        }
    }

    func signOut() async {
        sessionGeneration = UUID()
        // Remove protected views immediately, even if browser logout is canceled.
        client = nil
        isSigningIn = true
        error = nil
        connection = .inactive
        authSubscription = nil
        connectionSubscription = nil
        let previous = authClient
        authClient = nil
        if let previous {
            // The Convex SDK's logout returns no result. Always clear this device's
            // credential cache too, including when Auth0 browser logout fails.
            let manager = CredentialsManager(authentication: Auth0.authentication())
            let cleared = manager.clear()
            await previous.logout()
            if !cleared {
                error = "The local sign-in cache could not be cleared. Close the app and retry sign-out."
            }
        }
        isSigningIn = false
    }
}
