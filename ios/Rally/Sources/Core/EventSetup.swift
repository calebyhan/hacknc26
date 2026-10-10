import Foundation

enum EventSetupTime {
    /// Keep v.number() wire encoding while matching the backend's integer timestamps.
    static func milliseconds(_ date: Date) throws -> Double {
        let value = date.timeIntervalSince1970 * 1_000
        guard value.isFinite, value >= 0, value <= 9_007_199_254_740_991 else {
            throw RallyClientError.validation("Choose a valid date after January 1, 1970.")
        }
        return value.rounded()
    }

    static func window(start: Date, end: Date) throws -> (start: Double, end: Double) {
        let startsAt = try milliseconds(start)
        let endsAt = try milliseconds(end)
        guard endsAt > startsAt else {
            throw RallyClientError.validation("The task must end after it starts.")
        }
        return (startsAt, endsAt)
    }
}

/// Mutation responses are acknowledgements; only a fresh authorized query supplies
/// the resulting domain state. In particular, approval's null result may be a no-op.
enum EventMutationVerification: Equatable {
    case confirmation(previousVersion: Int)
    case approval(proposalID: String)

    func message(in detail: EventDetail, now: Date = Date()) -> String {
        switch self {
        case .confirmation(let version):
            if detail.event.status == .scheduled && detail.event.version > version {
                return "The event is scheduled. Tasks still require participant acceptance."
            }
            if detail.event.status == .draft {
                return "This event is still a draft. Review the latest details before confirming again."
            }
            return "The event changed. Review its current status before continuing."
        case .approval(let proposalID):
            guard let proposal = detail.proposals.first(where: { $0.id == proposalID }) else {
                return "This request is no longer available. Review the latest event state."
            }
            if proposal.state == .expired || (proposal.state == .pending && !proposal.isCurrent(at: now)) {
                return "This offer expired or changed. It cannot be approved."
            }
            if proposal.displayStatus(at: now) == .unknown {
                return "Request status is unavailable. Refresh before taking another action."
            }
            if proposal.isCurrent(at: now) && proposal.organizerApprovedAt != nil {
                return "Organizer approval is recorded. The participant still needs to respond."
            }
            if proposal.isCurrent(at: now) && proposal.requiresOrganizerApproval {
                return "Organizer approval is still pending. Review the latest request before trying again."
            }
            return "The request changed. Review the committed task and request status above."
        }
    }
}
