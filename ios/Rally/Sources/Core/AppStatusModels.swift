import Foundation

/// Account fields are returned only for the authenticated identity. No phone
/// number or cached client assertion is needed to restore server-verified proof.
struct AccountStatus: Codable, Equatable, Sendable {
    let userId: String
    let displayName: String
    let phoneLinked: Bool
    let messagingState: MessagingState
}

struct TaskProgress: Codable, Equatable, Sendable {
    let total: Int
    let confirmed: Int
    let needsCoverage: Int
    let completed: Int
    let canceled: Int
}

struct EventProgressSummary: Codable, Identifiable, Equatable, Sendable {
    let eventId: String
    let progress: TaskProgress
    var id: String { eventId }
}

struct EventMessagingStatus: Codable, Equatable, Sendable {
    let membershipState: MembershipState
    let consentRecorded: Bool
    let notificationsEnabled: Bool
    let messagingState: MessagingState
    let canReceiveMessages: Bool
}

/// Only the current user's backend-provisioned route can enable a shortcut.
/// Unknown route variants deliberately decode to unavailable.
enum RallyRoute: Codable, Equatable, Sendable {
    case available(destination: String, expiresAt: Double)
    case unavailable

    private enum CodingKeys: String, CodingKey { case status, destination, expiresAt }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        guard try values.decode(String.self, forKey: .status) == "available",
              let destination = try values.decodeIfPresent(String.self, forKey: .destination),
              (try? ContactNormalization.normalize(destination)) == destination,
              let expiresAt = try values.decodeIfPresent(Double.self, forKey: .expiresAt),
              expiresAt.isFinite, expiresAt >= 0 else {
            self = .unavailable
            return
        }
        self = .available(destination: destination, expiresAt: expiresAt)
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .available(let destination, let expiresAt):
            try values.encode("available", forKey: .status)
            try values.encode(destination, forKey: .destination)
            try values.encode(expiresAt, forKey: .expiresAt)
        case .unavailable:
            try values.encode("unavailable", forKey: .status)
        }
    }
}

enum ActivityKind: String, ForwardCompatibleStringEnum { case domain, delivery, unknown }

struct ActivityEntry: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let kind: ActivityKind
    let at: Double
    let title: String
    let deliveryState: OutboundState?
    var date: Date { Date(timeIntervalSince1970: at / 1_000) }
}

struct EventAppStatus: Codable, Equatable, Sendable {
    let eventId: String
    let progress: TaskProgress
    let messaging: EventMessagingStatus
    let route: RallyRoute
    let activity: [ActivityEntry]
}
