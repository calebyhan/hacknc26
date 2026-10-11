import Foundation

/// Shared shape returned by phone linking and organizer event invitations.
/// A challenge is an instruction to JOIN, never proof of consent or acceptance.
struct PhoneLinkChallenge: Codable, Equatable, Sendable {
    let invitationId: String
    let code: String
    let expiresAt: Double

    var expirationDate: Date { Date(timeIntervalSince1970: expiresAt / 1_000) }
}

/// Specific errors can be provided by local fixtures or a future structured
/// backend error contract. Ordinary server-error text must not be parsed as auth.
enum PhoneLinkFailure: Error, LocalizedError, Equatable, Sendable {
    case proofRequired, expired, identityConflict, linkBeforeEvents, phoneChangeUnsupported

    var errorDescription: String? {
        switch self {
        case .proofRequired: "Your phone has not been verified yet. Send the JOIN code, then check again."
        case .expired: "This code expired. Request a new code to continue."
        case .identityConflict: "This phone is linked to another account. Use that account to continue."
        case .linkBeforeEvents: "This account already owns event data. Account linking needs support; no accounts were merged."
        case .phoneChangeUnsupported: "Changing a linked phone is not available. Use your linked number."
        }
    }
}
