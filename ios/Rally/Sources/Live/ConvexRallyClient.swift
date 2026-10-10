@preconcurrency import Combine
@preconcurrency import ConvexMobile
import Foundation

/// Reads and writes only the frozen, authenticated public app contracts.
@MainActor
final class ConvexRallyClient: RallyClient {
    let mode = ClientMode.live
    private let convex: ConvexClient

    init(convex: ConvexClient) {
        self.convex = convex
    }

    func events() -> AsyncThrowingStream<[EventSummary], Error> {
        stream(convex.subscribe(to: "events:myEvents", yielding: [EventSummary].self))
    }

    func detail(eventID: String) -> AsyncThrowingStream<EventDetail, Error> {
        stream(convex.subscribe(to: "events:detail", with: ["eventId": eventID], yielding: EventDetail.self))
    }

    func createEvent(_ input: CreateEventInput) async throws -> String {
        try await convex.mutation("events:create", with: ConvexArguments.encode(input))
    }

    func createInvitations(
        eventID: String, contacts: [SelectedContact], idempotencyKey: String
    ) async throws -> [CreatedInvitation] {
        try await convex.mutation("invitations:createForContacts", with: ConvexArguments.encode(
            InvitationArguments(eventId: eventID, contacts: contacts, idempotencyKey: idempotencyKey)
        ))
    }

    func createTask(_ input: CreateTaskInput) async throws -> String {
        try await convex.mutation("tasks:create", with: ConvexArguments.encode(input))
    }

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
                case .failure(let error): continuation.finish(throwing: error)
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
    static func encode<Value: Encodable>(_ value: Value) throws -> [String: ConvexEncodable?] {
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
