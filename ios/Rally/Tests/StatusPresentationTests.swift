import XCTest
@testable import Rally

final class StatusPresentationTests: XCTestCase {
    func testMessagesURLAcceptsOnlyVerifiedE164WithoutBodyOrOtherRecipients() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let expiry = now.timeIntervalSince1970 * 1_000 + 10_000
        XCTAssertNil(RallyRoute.unavailable.messagesURL(at: now))
        XCTAssertEqual(RallyRoute.available(destination: "+15555550123", expiresAt: expiry).messagesURL(at: now)?.absoluteString, "sms:+15555550123")
        for value in ["shared", "15555550123", "+15555550123?body=JOIN", "+15555550123,+15555550124",
                      "https://example.com", "+0", "+15555550123\n", "+１５５５５５５０１２３"] {
            XCTAssertNil(RallyRoute.available(destination: value, expiresAt: expiry).messagesURL(at: now))
        }
    }

    func testRouteExpiryDisablesShortcutWithoutAnotherQueryValue() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let route = RallyRoute.available(destination: "+15555550123", expiresAt: now.timeIntervalSince1970 * 1_000 + 1_000)
        XCTAssertNotNil(route.messagesURL(at: now))
        XCTAssertNil(route.messagesURL(at: now.addingTimeInterval(1)))
        XCTAssertNil(RallyRoute.available(destination: "+15555550123", expiresAt: .infinity).messagesURL(at: now))
    }

    func testConsentIsSeparateFromEnrollmentAndGlobalMessagePreference() {
        func status(consent: Bool, notifications: Bool, global: MessagingState, canReceive: Bool) -> EventMessagingStatus {
            EventMessagingStatus(membershipState: .enrolled, consentRecorded: consent, notificationsEnabled: notifications,
                                 messagingState: global, canReceiveMessages: canReceive)
        }
        XCTAssertEqual(status(consent: false, notifications: false, global: .active, canReceive: false).statusTitle, "Join this event to enable messages")
        XCTAssertEqual(status(consent: true, notifications: true, global: .active, canReceive: true).statusTitle, "Event messages enabled")
        XCTAssertEqual(status(consent: true, notifications: true, global: .stopped, canReceive: false).statusTitle, "Messages stopped")
        XCTAssertEqual(status(consent: true, notifications: true, global: .paused, canReceive: false).statusTitle, "Messages paused")
        XCTAssertEqual(status(consent: true, notifications: false, global: .active, canReceive: false).statusTitle, "Event notifications disabled")
        XCTAssertEqual(status(consent: true, notifications: true, global: .active, canReceive: false).statusTitle, "Messaging status unavailable")
    }

    func testDeliveryReceiptAndProviderAcceptanceRemainDistinct() {
        XCTAssertNotEqual(OutboundState.sent.deliveryTitle, OutboundState.delivered.deliveryTitle)
        XCTAssertEqual(OutboundState.unknown.deliveryTitle, "Delivery outcome unknown")
        XCTAssertEqual(TaskProgress(total: 3, confirmed: 1, needsCoverage: 1, completed: 0, canceled: 1).summary,
                       "1 confirmed · 1 need coverage · 0 completed · 1 canceled")
    }
}
