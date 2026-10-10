import Combine
import Foundation

@MainActor
final class PhoneLinkModel: ObservableObject {
    enum State: Equatable { case idle, requesting, pending, checking, expired, linked }

    @Published var phone = ""
    @Published private(set) var state: State = .idle
    @Published private(set) var challenge: PhoneLinkChallenge?
    @Published private(set) var message: String?
    @Published private(set) var verifiedUserID: String?
    @Published private(set) var authenticationRequired = false
    private let client: any RallyClient
    private let now: () -> Date
    private var requestKey: String?
    private var requestedPhone: String?

    var isBusy: Bool { state == .requesting || state == .checking }

    init(client: any RallyClient, now: @escaping () -> Date = Date.init) {
        self.client = client
        self.now = now
    }

    func refreshExpiry() {
        guard let challenge, state != .linked, !isBusy,
              challenge.expirationDate <= now() else { return }
        state = .expired
        message = PhoneLinkFailure.expired.localizedDescription
    }

    func requestCode(renew: Bool = false) async {
        guard !isBusy, state != .linked else { return }
        refreshExpiry()
        if state == .expired && !renew { return }
        do {
            let normalized = try ContactNormalization.normalize(phone)
            if requestKey == nil || renew || requestedPhone != normalized {
                requestKey = UUID().uuidString
                requestedPhone = normalized
                challenge = nil
            }
            guard let requestKey else { return }
            state = .requesting
            message = nil
            authenticationRequired = false
            let result = try await client.beginPhoneLink(phoneE164: normalized, idempotencyKey: requestKey)
            challenge = result
            phone = normalized
            state = .pending
            refreshExpiry()
        } catch {
            state = challenge == nil ? .idle : .pending
            handle(error)
        }
    }

    func checkProof() async {
        guard !isBusy, state != .linked else { return }
        refreshExpiry()
        guard state != .expired, let challenge else { return }
        state = .checking
        message = nil
        do {
            // This mutation alone verifies proof. A code, copy action or JOIN
            // instruction never changes the local verified state.
            verifiedUserID = try await client.completePhoneLink(invitationID: challenge.invitationId)
            state = .linked
        } catch {
            state = .pending
            handle(error)
        }
    }

    func simulateDemoProof() async {
        guard !isBusy, state != .linked, let mock = client as? MockRallyClient,
              let challenge else { return }
        refreshExpiry()
        guard state != .expired else { return }
        do {
            try await mock.simulatePhoneJoin(invitationID: challenge.invitationId)
            await checkProof()
        } catch {
            handle(error)
        }
    }

    private func handle(_ error: Error) {
        if let failure = error as? PhoneLinkFailure {
            if failure == .expired { state = .expired }
            message = failure.localizedDescription
        } else if let failure = error as? RallyClientError {
            authenticationRequired = failure == .authenticationRequired
            message = failure.localizedDescription
        } else {
            // Ordinary backend errors have no stable public code. Never parse
            // or display their raw text (which can include implementation data).
            message = "Phone verification is unavailable right now. Try again. Your phone has not been verified."
        }
    }
}
