import Foundation

/// Wire enums tolerate newly deployed values without inventing a confirmed state.
protocol ForwardCompatibleStringEnum: RawRepresentable, Codable, Sendable where RawValue == String {
    static var unknown: Self { get }
}

extension ForwardCompatibleStringEnum {
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

enum EventKind: String, ForwardCompatibleStringEnum { case event, project, unknown }
enum MemberRole: String, ForwardCompatibleStringEnum { case organizer, member, unknown }
enum EventStatus: String, ForwardCompatibleStringEnum { case draft, scheduled, canceled, completed, unknown }
enum MembershipState: String, ForwardCompatibleStringEnum { case invited, enrolled, left, unknown }
enum TaskStatus: String, ForwardCompatibleStringEnum {
    case unassigned, confirmed, needsCoverage = "needs_coverage", completed, canceled, unknown

    var displayStatus: DisplayStatus {
        switch self {
        case .unassigned, .needsCoverage: .needsCoverage
        case .confirmed: .confirmed
        case .completed: .completed
        case .canceled: .canceled
        case .unknown: .unknown
        }
    }
}
enum ProposalState: String, ForwardCompatibleStringEnum { case pending, accepted, declined, expired, superseded, canceled, unknown }
enum ProposalType: String, ForwardCompatibleStringEnum { case assignment, reassignment, taskChange = "task_change", unknown }
enum InvitationState: String, ForwardCompatibleStringEnum { case pending, redeemed, expired, revoked, unknown }
enum CommitmentState: String, ForwardCompatibleStringEnum { case active, released, canceledByParticipant = "canceled_by_participant", completed, unknown }
enum MessagingState: String, ForwardCompatibleStringEnum { case active, paused, stopped, unknown }
enum OutboundState: String, ForwardCompatibleStringEnum { case queued, sending, sent, delivered, failed, unknown }
enum ReasoningJobStatus: String, ForwardCompatibleStringEnum { case queued, claimed, completed, failed, expired, unknown }
enum InboundProcessingState: String, ForwardCompatibleStringEnum { case received, processing, processed, failed, unknown }

/// The display vocabulary in docs/06. Delivery failure is never task failure.
enum DisplayStatus: String, ForwardCompatibleStringEnum, CaseIterable {
    case draft
    case waitingToJoin = "waiting_to_join"
    case pendingApproval = "pending_approval"
    case awaitingParticipant = "awaiting_participant"
    case confirmed
    case needsCoverage = "needs_coverage"
    case atRisk = "at_risk"
    case completed, failed, canceled, unknown

    var title: String {
        switch self {
        case .draft: "Draft"
        case .waitingToJoin: "Waiting for them to text Rally"
        case .pendingApproval: "Pending approval"
        case .awaitingParticipant: "Awaiting participant"
        case .confirmed: "Confirmed"
        case .needsCoverage: "Needs coverage"
        case .atRisk: "At risk"
        case .completed: "Completed"
        case .failed: "Delivery failed"
        case .canceled: "Canceled"
        case .unknown: "Unknown"
        }
    }

    var systemImage: String {
        switch self {
        case .draft: "pencil.circle"
        case .waitingToJoin: "person.crop.circle.badge.clock"
        case .pendingApproval: "hand.raised"
        case .awaitingParticipant: "clock"
        case .confirmed: "checkmark.circle.fill"
        case .needsCoverage: "person.crop.circle.badge.questionmark"
        case .atRisk: "exclamationmark.triangle"
        case .completed: "checkmark.seal.fill"
        case .failed: "exclamationmark.bubble"
        case .canceled: "xmark.circle"
        case .unknown: "questionmark.circle"
        }
    }
}

/// Mirrors convex/lib/validators.ts. All timestamps are Unix milliseconds.
struct EventSummary: Codable, Identifiable, Equatable, Sendable {
    var _id: String
    var title: String
    var kind: EventKind
    var startsAt: Double
    var timezone: String
    var location: String? = nil
    var status: EventStatus
    var version: Int
    var role: MemberRole

    var id: String { _id }
    var startDate: Date { Date(timeIntervalSince1970: startsAt / 1_000) }
    var isOrganizer: Bool { role == .organizer }
    var displayStatus: DisplayStatus? {
        switch status {
        case .draft: .draft
        case .scheduled: nil
        case .canceled: .canceled
        case .completed: .completed
        case .unknown: .unknown
        }
    }
}

struct RallyTaskSummary: Codable, Identifiable, Equatable, Sendable {
    var _id: String
    var eventId: String
    var title: String
    var location: String? = nil
    var windowStart: Double? = nil
    var windowEnd: Double? = nil
    var capacity: Int
    var status: TaskStatus
    var version: Int
    var activeAssigneeIds: [String]

    var id: String { _id }
    /// Only canonical committed task state controls this label; offers are separate.
    var committedDisplayStatus: DisplayStatus { status.displayStatus }
}

struct ProposalSummary: Codable, Identifiable, Equatable, Sendable {
    var _id: String
    var eventId: String
    var type: ProposalType
    var targetTaskId: String? = nil
    var targetUserId: String? = nil
    var state: ProposalState
    var requiresOrganizerApproval: Bool
    var organizerApprovedAt: Double? = nil
    var expiresAt: Double

    var id: String { _id }
    var expirationDate: Date { Date(timeIntervalSince1970: expiresAt / 1_000) }
    var displayStatus: DisplayStatus? {
        switch state {
        case .pending: requiresOrganizerApproval && organizerApprovedAt == nil ? .pendingApproval : .awaitingParticipant
        case .canceled: .canceled
        case .unknown: .unknown
        // Accepted proposal text is not evidence of an active commitment.
        case .accepted, .declined, .expired, .superseded: nil
        }
    }
}

struct MemberSummary: Codable, Identifiable, Equatable, Sendable {
    var userId: String
    var displayName: String
    var role: MemberRole
    var state: MembershipState

    var id: String { userId }
    var displayStatus: DisplayStatus? {
        switch state {
        case .invited: .waitingToJoin
        case .unknown: .unknown
        case .enrolled, .left: nil
        }
    }
}

struct EventDetail: Codable, Equatable, Sendable {
    var event: EventSummary
    var tasks: [RallyTaskSummary]
    var members: [MemberSummary]
    var proposals: [ProposalSummary]

    func memberName(_ userID: String) -> String {
        members.first { $0.userId == userID }?.displayName ?? "Unknown participant"
    }
    func pendingProposals(for taskID: String) -> [ProposalSummary] {
        proposals.filter { $0.targetTaskId == taskID && $0.state == .pending }
    }
}

struct WeatherPolicy: Codable, Equatable, Sendable {
    struct Alternative: Codable, Equatable, Sendable {
        var type: String = "indoor_backup"
        var location: String
    }
    var enabled: Bool
    var condition: String = "precipitation_probability_gte"
    var thresholdPercent: Double
    var leadTimeHours: Double
    var alternative: Alternative? = nil
    var version: Int
    var latitude: Double? = nil
    var longitude: Double? = nil
}

struct CreateEventInput: Codable, Equatable, Sendable {
    var title: String
    var kind: EventKind = .event
    var startsAt: Double
    var timezone: String
    var location: String? = nil
    var weatherPolicy: WeatherPolicy? = nil
    var idempotencyKey: String
}

struct CreateTaskInput: Codable, Equatable, Sendable {
    var eventId: String
    var title: String
    var location: String? = nil
    var windowStart: Double? = nil
    var windowEnd: Double? = nil
    var requiredSkills: [String]? = nil
    var capacity: Int? = nil
    var dependsOnTaskIds: [String]? = nil
    var expectedEventVersion: Int
    var idempotencyKey: String
}

struct SelectedContact: Codable, Identifiable, Hashable, Sendable {
    var displayName: String
    var phoneE164: String
    var id: String { phoneE164 }
}

struct CreatedInvitation: Codable, Identifiable, Equatable, Sendable {
    var invitationId: String
    var contactSelectionId: String
    var code: String
    var expiresAt: Double
    var id: String { invitationId }
    var expirationDate: Date { Date(timeIntervalSince1970: expiresAt / 1_000) }
}
