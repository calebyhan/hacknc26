import XCTest
@preconcurrency import Auth0
@preconcurrency import Combine
@preconcurrency import ConvexMobile
@testable import Rally

final class LiveTests: XCTestCase {
    @MainActor
    func testSDKLoginBackgroundNotificationsDoNotCrashSessionOrEnterDemo() async throws {
        let configuration = try XCTUnwrap(LiveConfiguration(
            deploymentURL: "https://fixture.convex.cloud",
            auth0Domain: "fixture.us.auth0.com", auth0ClientID: "fixture-public-client"
        ))
        let client = ConvexClientWithAuth<Credentials>(
            deploymentUrl: configuration.deploymentURL, authProvider: FailingFixtureAuthProvider()
        )
        let backgroundLoading = expectation(description: "SDK emitted loading outside main thread")
        let observation = client.authState.sink { @Sendable state in
            if case .loading = state, !Thread.isMainThread { backgroundLoading.fulfill() }
        }
        defer { observation.cancel() }
        let session = AppSession(configuration: configuration, makeAuthClient: { _ in client })

        await session.signIn()
        await fulfillment(of: [backgroundLoading], timeout: 2)

        XCTAssertNil(session.client)
        XCTAssertFalse(session.isSigningIn)
        XCTAssertEqual(session.connection, .inactive)
        XCTAssertNotNil(session.error)
    }

    func testLiveConfigurationRejectsMissingUnsafeAndPlaceholderValues() {
        for url in ["", "https:/$()/YOUR_DEPLOYMENT.convex.cloud", "http://fixture.convex.cloud", "https://name:password@fixture.convex.cloud", "https://fixture.convex.cloud/path", "https://fixture.convex.cloud?token=secret"] {
            XCTAssertNil(LiveConfiguration(deploymentURL: url, auth0Domain: "fixture.us.auth0.com", auth0ClientID: "fixture-public-client"))
        }
        for domain in ["", "YOUR_TENANT.us.auth0.com", "https://fixture.us.auth0.com", "fixture.us.auth0.com/path"] {
            XCTAssertNil(LiveConfiguration(deploymentURL: "https://fixture.convex.cloud", auth0Domain: domain, auth0ClientID: "fixture-public-client"))
        }
        XCTAssertNil(LiveConfiguration(deploymentURL: "https://fixture.convex.cloud", auth0Domain: "fixture.us.auth0.com", auth0ClientID: "$(AUTH0_CLIENT_ID)"))
        XCTAssertNotNil(LiveConfiguration(deploymentURL: "https://fixture.convex.cloud", auth0Domain: "fixture.us.auth0.com", auth0ClientID: "fixture-public-client"))
    }

    func testTaskMutationUsesNumberNotConvexInt64AndOmitsAbsentOptionals() throws {
        let input = CreateTaskInput(eventId: "event_fixture", title: "Fixture task", capacity: 1,
                                    expectedEventVersion: 7, idempotencyKey: "fixture-task-request")
        let arguments = try ConvexArguments.encode(input)
        XCTAssertEqual(try arguments["capacity"]??.convexEncode(), "1")
        XCTAssertEqual(try arguments["expectedEventVersion"]??.convexEncode(), "7")
        for key in ["location", "windowStart", "userId", "ownerId", "role"] {
            XCTAssertFalse(arguments.keys.contains(key), "Unexpected argument: \(key)")
        }
    }

    func testEventMutationPreservesMillisecondsAndNestedWeatherNumbers() throws {
        let policy = WeatherPolicy(enabled: true, thresholdPercent: 60, leadTimeHours: 2, version: 1)
        let input = CreateEventInput(title: "Fixture event", startsAt: 1_792_245_600_000,
                                     timezone: "America/New_York", weatherPolicy: policy,
                                     idempotencyKey: "fixture-event-request")
        let arguments = try ConvexArguments.encode(input)
        let timestamp = try XCTUnwrap(arguments["startsAt"] ?? nil).convexEncode()
        XCTAssertEqual(Double(timestamp), 1_792_245_600_000)
        let weather = try XCTUnwrap(arguments["weatherPolicy"] ?? nil).convexEncode()
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(weather.utf8)) as? [String: Any])
        XCTAssertEqual(decoded["version"] as? Double, 1)
        XCTAssertEqual(decoded["thresholdPercent"] as? Double, 60)
        XCTAssertFalse(weather.contains("$integer"))
        XCTAssertNil(decoded["latitude"])
        XCTAssertNil(decoded["alternative"])
    }

    func testConnectionStateDoesNotRepresentDeliveryOrWorkerHealth() {
        XCTAssertTrue(LiveConnectionState.inactive.isStale)
        XCTAssertTrue(LiveConnectionState.connecting.isStale)
        XCTAssertFalse(LiveConnectionState.connected.isStale)
        XCTAssertEqual(LiveConnectionState.connected.statusText, "Connected to backend")
    }
}

/// Exercises the real SDK's auth-state publisher without a browser, credentials,
/// successful authentication, or messaging. A failure must return to the gate.
private struct FailingFixtureAuthProvider: AuthProvider {
    enum Failure: Error { case fixtureLoginRejected }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> Credentials {
        throw Failure.fixtureLoginRejected
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> Credentials {
        throw Failure.fixtureLoginRejected
    }

    func logout() async throws {}
    func extractIdToken(from authResult: Credentials) -> String { "unused-fixture-token" }
}
