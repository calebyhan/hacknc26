@preconcurrency import Combine
@preconcurrency import ConvexMobile
import Foundation

/// Injectable SDK boundary: local adapter tests never connect to Convex.
@MainActor
protocol RallyAPITransport {
    func mutation<Result: Decodable & Sendable>(_ name: String, arguments: sending [String: ConvexEncodable?]) async throws -> Result
    func subscribe<Value: Decodable & Sendable>(_ name: String, arguments: [String: ConvexEncodable?]) -> AnyPublisher<Value, ClientError>
}

@MainActor
private final class SDKRallyTransport: RallyAPITransport {
    let convex: ConvexClient
    init(convex: ConvexClient) { self.convex = convex }

    func mutation<Result: Decodable & Sendable>(_ name: String, arguments: sending [String: ConvexEncodable?]) async throws -> Result {
        try await convex.mutation(name, with: arguments)
    }

    func subscribe<Value: Decodable & Sendable>(_ name: String, arguments: [String: ConvexEncodable?]) -> AnyPublisher<Value, ClientError> {
        convex.subscribe(to: name, with: arguments, yielding: Value.self)
    }
}

/// Public authenticated APIs only. Backend Error messages are deliberately not
/// parsed or displayed: production errors can be opaque or contain private data.
@MainActor
final class ConvexRallyClient: RallyClient {
    let mode = ClientMode.live
    private let transport: any RallyAPITransport

    init(convex: ConvexClient) { transport = SDKRallyTransport(convex: convex) }
    init(transport: any RallyAPITransport) { self.transport = transport }

    func register(displayName: String) async throws -> String {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 120 else {
            throw RallyClientError.validation("Enter a display name with 1–120 characters.")
        }
        return try await mutate("accounts:register", RegisterArguments(displayName: name),
                                failure: "Your Rally account could not be prepared. Try again or sign in again.")
    }

    func beginPhoneLink(phoneE164: String, idempotencyKey: String) async throws -> PhoneLinkChallenge {
        let phone = try ContactNormalization.normalize(phoneE164)
        return try await mutate("accounts:beginPhoneLink", PhoneArguments(phoneE164: phone, idempotencyKey: idempotencyKey),
                                failure: "A phone-link code could not be created. Check your number and account, then retry.")
    }

    func completePhoneLink(invitationID: String) async throws -> String {
        try await mutate("accounts:completePhoneLink", LinkArguments(invitationId: invitationID),
                         failure: "Phone verification has not completed. Check that you sent this JOIN code from the selected phone, then check again. If the code expired, request a new one.")
    }

    func events() -> AsyncThrowingStream<[EventSummary], Error> {
        stream(transport.subscribe("events:myEvents", arguments: [:]))
    }

    func detail(eventID: String) -> AsyncThrowingStream<EventDetail, Error> {
        stream(transport.subscribe("events:detail", arguments: ["eventId": eventID]))
    }

    func createEvent(_ input: CreateEventInput) async throws -> String {
        try await mutate("events:create", input,
                         failure: "The event request could not be confirmed. Check your events before retrying the same request.")
    }

    func createInvitations(eventID: String, contacts: [SelectedContact], idempotencyKey: String) async throws -> [CreatedInvitation] {
        try await mutate("invitations:createForContacts", InvitationArguments(eventId: eventID, contacts: contacts, idempotencyKey: idempotencyKey),
                         failure: "The invitation request could not be confirmed. Check participant status before retrying the same request.")
    }

    func createTask(_ input: CreateTaskInput) async throws -> String {
        try await mutate("tasks:create", input,
                         failure: "The task request could not be confirmed. Refresh the event and check existing tasks before retrying.")
    }

    func confirmDraft(eventID: String, expectedVersion: Int) async throws -> String {
        try await mutate("events:confirmDraft", ConfirmArguments(eventId: eventID, expectedVersion: expectedVersion),
                         failure: "The event could not be confirmed. Refresh its details before trying again.")
    }

    func organizerInvitation(eventID: String, idempotencyKey: String) async throws -> PhoneLinkChallenge {
        try await mutate("events:organizerInvitation", OrganizerArguments(eventId: eventID, idempotencyKey: idempotencyKey),
                         failure: "An organizer JOIN code could not be created. Check your phone link and event, then retry.")
    }

    func approveProposal(proposalID: String) async throws {
        let _: String? = try await mutate("proposals:approve", ApprovalArguments(proposalId: proposalID),
                                          failure: "Approval could not be verified. Refresh the proposal before trying again.")
    }

    private func mutate<Arguments: Encodable, Result: Decodable & Sendable>(
        _ name: String, _ arguments: Arguments, failure: String
    ) async throws -> Result {
        try Task.checkCancellation()
        do {
            let result: Result = try await transport.mutation(name, arguments: ConvexArguments.encode(arguments))
            try Task.checkCancellation()
            return result
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw RallyClientError.unavailable(failure)
        }
    }

    private struct RegisterArguments: Encodable { let displayName: String }
    private struct PhoneArguments: Encodable { let phoneE164: String; let idempotencyKey: String }
    private struct LinkArguments: Encodable { let invitationId: String }
    private struct ConfirmArguments: Encodable { let eventId: String; let expectedVersion: Int }
    private struct OrganizerArguments: Encodable { let eventId: String; let idempotencyKey: String }
    private struct ApprovalArguments: Encodable { let proposalId: String }
    private struct InvitationArguments: Encodable {
        let eventId: String
        let contacts: [SelectedContact]
        let idempotencyKey: String
    }

    private func stream<Value: Decodable & Sendable>(
        _ publisher: AnyPublisher<Value, ClientError>
    ) -> AsyncThrowingStream<Value, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let token = SubscriptionLifetime()
            continuation.onTermination = { _ in token.cancel() }
            token.store(publisher.sink { completion in
                switch completion {
                case .finished: continuation.finish()
                case .failure:
                    continuation.finish(throwing: RallyClientError.unavailable("This data could not be loaded for your account. Retry or sign in again. Previously loaded data has been cleared."))
                }
            } receiveValue: { value in
                continuation.yield(value)
            })
        }
    }
}

/// Convex's built-in Swift Int encoding is int64, but Rally uses v.number().
/// Encode the shared Codable input as JSON numbers, including nested objects,
/// and omit absent optionals instead of sending null to optional validators.
enum ConvexArguments {
    static func encode<Value: Encodable>(_ value: Value) throws -> sending [String: ConvexEncodable?] {
        let data = try JSONEncoder().encode(value)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RallyClientError.validation("Request arguments must be an object.")
        }
        return try object.mapValues { value in
            JSONArgument(data: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
        }
    }

    private struct JSONArgument: ConvexEncodable {
        let data: Data
        func convexEncode() throws -> String { String(decoding: data, as: UTF8.self) }
    }
}

/// Combine can complete synchronously while the cancellation token is installed.
/// Serialize installation/cancellation so stream termination never leaks a query.
private final class SubscriptionLifetime: @unchecked Sendable {
    private let lock = NSLock()
    private var token: AnyCancellable?
    private var canceled = false

    func store(_ token: AnyCancellable) {
        lock.lock()
        if canceled {
            lock.unlock()
            token.cancel()
        } else {
            self.token = token
            lock.unlock()
        }
    }

    func cancel() {
        lock.lock()
        canceled = true
        let current = token
        token = nil
        lock.unlock()
        current?.cancel()
    }
}
