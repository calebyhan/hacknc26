import Foundation

enum ClientMode: Sendable { case demo, live }

@MainActor
protocol RallyClient {
    var mode: ClientMode { get }
    func register(displayName: String) async throws -> String
    func beginPhoneLink(phoneE164: String, idempotencyKey: String) async throws -> PhoneLinkChallenge
    func completePhoneLink(invitationID: String) async throws -> String
    func events() -> AsyncThrowingStream<[EventSummary], Error>
    func detail(eventID: String) -> AsyncThrowingStream<EventDetail, Error>
    func createEvent(_ input: CreateEventInput) async throws -> String
    func createInvitations(eventID: String, contacts: [SelectedContact], idempotencyKey: String) async throws -> [CreatedInvitation]
    func createTask(_ input: CreateTaskInput) async throws -> String
    func confirmDraft(eventID: String, expectedVersion: Int) async throws -> String
    func organizerInvitation(eventID: String, idempotencyKey: String) async throws -> PhoneLinkChallenge
    func approveProposal(proposalID: String) async throws
}

enum RallyClientError: Error, LocalizedError, Equatable, Sendable {
    case authenticationRequired
    case accessDenied
    case unavailable(String)
    case validation(String)

    var errorDescription: String? {
        switch self {
        case .authenticationRequired: "Sign in to see your Rally events."
        case .accessDenied: "This event is unavailable to your account."
        case .unavailable(let message), .validation(let message): message
        }
    }
}

enum ContactNormalization {
    /// Conservative formatting only, not proof of phone ownership or reachability.
    /// A country prefix must be explicit; the app never guesses from device locale.
    static func normalize(_ raw: String) throws -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("+") else {
            throw RallyClientError.validation("Include the country code, starting with +, for this selected phone number.")
        }
        let separators = CharacterSet(charactersIn: " ()-.")
        var digits = ""
        for scalar in trimmed.dropFirst().unicodeScalars {
            if scalar.value >= 48 && scalar.value <= 57 {
                digits.unicodeScalars.append(scalar)
            } else if !separators.contains(scalar) {
                throw RallyClientError.validation("Use a phone number with digits and a + country code. Letters and extensions are not supported.")
            }
        }
        guard (8...15).contains(digits.count), digits.first != "0" else {
            throw RallyClientError.validation("Check the country code and phone number; use 8–15 digits after +.")
        }
        return "+" + digits
    }
}
