import Foundation

enum DemoSession: String, CaseIterable, Identifiable, Sendable {
    case alex, jordan, stranger

    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .alex: "Alex · organizer"
        case .jordan: "Jordan · member"
        case .stranger: "Unrelated account"
        }
    }
    var userID: String { "usr_" + rawValue }
    var participantName: String {
        switch self {
        case .alex: "Alex"
        case .jordan: "Jordan"
        case .stranger: "Fixture user"
        }
    }
}

/// Local simulation only. No auth, messaging, backend, or network is invoked here.
/// Seed identities match packages/shared/fixtures.ts; the pending proposal and
/// private-event privacy probe are explicit iOS-only simulation scenarios.
@MainActor
final class MockRallyClient: RallyClient {
    let mode = ClientMode.demo
    let session: DemoSession
    private let now: () -> Date
    private(set) var simulatedLinkedPhone: String?
    private var records: [String: EventDetail]
    private var nextID = 1
    private var eventListeners: [UUID: AsyncThrowingStream<[EventSummary], Error>.Continuation] = [:]
    private var detailListeners: [UUID: (eventID: String, continuation: AsyncThrowingStream<EventDetail, Error>.Continuation)] = [:]
    private var createdEvents: [String: Replay<String>] = [:]
    private var createdTasks: [String: Replay<String>] = [:]
    private var createdInvitations: [String: Replay<[CreatedInvitation]>] = [:]
    private var challengeKeys: [String: PhoneLinkChallenge] = [:]
    private var challenges: [String: SimulatedChallenge] = [:]
    private var messagingConsent: Set<String> = []
    private var requestCounts = ["proposal_simulated_jordan": 1]
    private var phoneUserIDs: [String: String] = [
        "+15550100001": "usr_alex", "+15550100002": "usr_maya",
        "+15550100003": "usr_jordan", "+15550100004": "usr_taylor"
    ]

    private struct Replay<Value> {
        let input: Data
        let result: Value
    }
    private struct InvitationInput: Encodable {
        let eventId: String
        let contacts: [SelectedContact]
        let idempotencyKey: String
    }
    private enum ChallengePurpose {
        case phoneLink(String)
        case organizerOptIn(String)
    }
    private struct SimulatedChallenge {
        let challenge: PhoneLinkChallenge
        let purpose: ChallengePurpose
        var joined = false
        var completed = false
    }

    init(session: DemoSession = .alex, now: @escaping () -> Date = Date.init) {
        self.session = session
        self.now = now
        records = Self.fixtures(proposalExpiry: floor(now().timeIntervalSince1970 * 1_000) + 600_000)
        // Existing sample memberships and consent are explicitly fixture state.
        // Newly created events and app phone linking never inherit this consent.
        if session != .stranger { messagingConsent = ["event_charity_5k", "event_hack_night"] }
    }

    func register(displayName: String) async throws -> String {
        _ = try checkedTitle(displayName)
        // DemoSession is an already registered simulated identity. Registration
        // replays its canonical ID without changing any phone or event permission.
        return session.userID
    }

    func beginPhoneLink(phoneE164: String, idempotencyKey: String) async throws -> PhoneLinkChallenge {
        let phone = try ContactNormalization.normalize(phoneE164)
        guard phone == phoneE164 else { throw RallyClientError.validation("Use the reviewed E.164 phone number.") }
        let key = try checkedKey(idempotencyKey)
        if let linked = simulatedLinkedPhone, linked != phone { throw PhoneLinkFailure.phoneChangeUnsupported }
        return makeChallenge(key: "phone:\(key):\(phone)", purpose: .phoneLink(phone), lifetime: 600_000)
    }

    func completePhoneLink(invitationID: String) async throws -> String {
        guard var proof = challenges[invitationID], case .phoneLink(let phone) = proof.purpose else {
            throw RallyClientError.accessDenied
        }
        if proof.completed && simulatedLinkedPhone == phone { return session.userID }
        guard proof.challenge.expiresAt > nowMilliseconds else { throw PhoneLinkFailure.expired }
        guard proof.joined else { throw PhoneLinkFailure.proofRequired }
        if let existing = phoneUserIDs[phone], existing != session.userID { throw PhoneLinkFailure.identityConflict }
        if let linked = simulatedLinkedPhone, linked != phone { throw PhoneLinkFailure.phoneChangeUnsupported }
        simulatedLinkedPhone = phone
        phoneUserIDs[phone] = session.userID
        proof.completed = true
        challenges[invitationID] = proof
        return session.userID
    }

    /// Explicitly simulated JOIN only; no message is sent, received, or fabricated
    /// in the backend. The phone-link UI must still call completePhoneLink.
    func simulatePhoneJoin(invitationID: String) async throws {
        guard var proof = challenges[invitationID] else { throw RallyClientError.accessDenied }
        if proof.joined { return }
        guard proof.challenge.expiresAt > nowMilliseconds else { throw PhoneLinkFailure.expired }
        if case .organizerOptIn(let eventID) = proof.purpose {
            _ = try authorizedDetail(eventID, organizer: true)
            messagingConsent.insert(eventID)
            proof.completed = true
        }
        proof.joined = true
        challenges[invitationID] = proof
    }

    func simulatedMessagingConsent(eventID: String) -> Bool { messagingConsent.contains(eventID) }
    func simulatedRequestCount(proposalID: String) -> Int { requestCounts[proposalID, default: 0] }

    var simulationAccepted: Bool {
        records["event_charity_5k"]?.proposals.first?.state == .accepted
    }

    func events() -> AsyncThrowingStream<[EventSummary], Error> {
        let token = UUID()
        return AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            eventListeners[token] = continuation
            continuation.yield(visibleEvents())
            continuation.onTermination = { @Sendable [weak self] _ in
                Task { @MainActor [weak self] in self?.eventListeners.removeValue(forKey: token) }
            }
        }
    }

    func detail(eventID: String) -> AsyncThrowingStream<EventDetail, Error> {
        let token = UUID()
        return AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            do {
                let value = try authorizedDetail(eventID)
                detailListeners[token] = (eventID, continuation)
                continuation.yield(value)
                continuation.onTermination = { @Sendable [weak self] _ in
                    Task { @MainActor [weak self] in self?.detailListeners.removeValue(forKey: token) }
                }
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }

    func createEvent(_ input: CreateEventInput) async throws -> String {
        let fingerprint = try encoded(input)
        let key = try checkedKey(input.idempotencyKey)
        if let replay = createdEvents[key] { return try replayResult(replay, input: fingerprint) }
        let title = try checkedTitle(input.title)
        guard input.kind == .event || input.kind == .project,
              validTimestamp(input.startsAt),
              TimeZone(identifier: input.timezone) != nil else {
            throw RallyClientError.validation("Check the event date, timezone, and event type.")
        }
        if let weather = input.weatherPolicy {
            guard weather.condition == "precipitation_probability_gte",
                  (0...100).contains(weather.thresholdPercent), weather.leadTimeHours > 0,
                  weather.leadTimeHours.isFinite, weather.version > 0 else {
                throw RallyClientError.validation("Check the weather policy.")
            }
        }
        let id = makeID("event")
        let event = EventSummary(_id: id, title: title, kind: input.kind, startsAt: input.startsAt,
                                 timezone: input.timezone, location: cleanedLocation(input.location),
                                 status: .draft, version: 1, role: .organizer)
        records[id] = EventDetail(event: event, tasks: [], members: [
            MemberSummary(userId: session.userID, displayName: session.participantName, role: .organizer, state: .enrolled)
        ], proposals: [])
        createdEvents[key] = Replay(input: fingerprint, result: id)
        emit(eventID: id)
        return id
    }

    func confirmDraft(eventID: String, expectedVersion: Int) async throws -> String {
        var detail = try authorizedDetail(eventID, organizer: true)
        if detail.event.status == .scheduled, expectedVersion > 0,
           detail.event.version - 1 == expectedVersion { return eventID }
        guard expectedVersion > 0, detail.event.version == expectedVersion else {
            throw RallyClientError.validation("This event changed. Refresh it before confirming.")
        }
        guard detail.event.status == .draft else {
            throw RallyClientError.validation("Only a draft event can be confirmed.")
        }
        detail.event.status = .scheduled
        detail.event.version += 1
        records[eventID] = detail
        emit(eventID: eventID)
        return eventID
    }

    func organizerInvitation(eventID: String, idempotencyKey: String) async throws -> PhoneLinkChallenge {
        let detail = try authorizedDetail(eventID, organizer: true)
        guard simulatedLinkedPhone != nil else { throw RallyClientError.validation("Link your phone before requesting an event JOIN code.") }
        guard detail.event.status != .completed, detail.event.status != .canceled else {
            throw RallyClientError.validation("This event is closed.")
        }
        let key = "organizer:\(eventID):\(try checkedKey(idempotencyKey))"
        if let replay = challengeKeys[key] { return replay }
        guard !messagingConsent.contains(eventID) else { throw RallyClientError.validation("You already opted in to this simulated event.") }
        return makeChallenge(key: key, purpose: .organizerOptIn(eventID), lifetime: 86_400_000)
    }

    func approveProposal(proposalID: String) async throws {
        guard let eventID = records.first(where: { $0.value.proposals.contains { $0.id == proposalID } })?.key else {
            throw RallyClientError.accessDenied
        }
        var detail = try authorizedDetail(eventID, organizer: true)
        guard let index = detail.proposals.firstIndex(where: { $0.id == proposalID }) else { throw RallyClientError.accessDenied }
        let proposal = detail.proposals[index]
        guard proposal.state == .pending else { return }
        guard proposal.expiresAt > nowMilliseconds, detail.event.status == .scheduled,
              detail.event.version == 1, detail.tasks.contains(where: { $0.id == proposal.targetTaskId && $0.version == 1 }) else {
            detail.proposals[index].state = .expired
            records[eventID] = detail
            emit(eventID: eventID)
            return
        }
        guard proposal.requiresOrganizerApproval, proposal.organizerApprovedAt == nil else { return }
        detail.proposals[index].organizerApprovedAt = nowMilliseconds
        // A request counter is an explicit offline surrogate, never delivery or
        // acceptance. Approval changes no task or commitment state.
        requestCounts[proposalID, default: 0] += 1
        records[eventID] = detail
        emit(eventID: eventID)
    }

    func createInvitations(eventID: String, contacts: [SelectedContact], idempotencyKey: String) async throws -> [CreatedInvitation] {
        var detail = try authorizedDetail(eventID, organizer: true)
        guard detail.event.status != .completed, detail.event.status != .canceled, contacts.count <= 20 else {
            throw RallyClientError.validation("Choose at most 20 contacts for an open event.")
        }
        let key = eventID + ":" + (try checkedKey(idempotencyKey))
        let fingerprint = try encoded(InvitationInput(eventId: eventID, contacts: contacts, idempotencyKey: idempotencyKey))
        if let replay = createdInvitations[key] { return try replayResult(replay, input: fingerprint) }

        // Validate the entire batch before changing local state. No partial invitations.
        var selected: [SelectedContact] = []
        var phones = Set<String>()
        for contact in contacts {
            let name = try checkedTitle(contact.displayName)
            let phone = try ContactNormalization.normalize(contact.phoneE164)
            guard phone == contact.phoneE164 else {
                throw RallyClientError.validation("Review and normalize the selected phone number before inviting.")
            }
            if phones.insert(phone).inserted {
                if let userID = phoneUserIDs[phone], detail.members.contains(where: { $0.userId == userID && $0.state == .enrolled }) {
                    throw RallyClientError.validation("This participant is already enrolled in the event.")
                }
                selected.append(SelectedContact(displayName: name, phoneE164: phone))
            }
        }

        var result: [CreatedInvitation] = []
        for contact in selected {
            let userID = phoneUserIDs[contact.phoneE164] ?? makeID("user")
            phoneUserIDs[contact.phoneE164] = userID
            if !detail.members.contains(where: { $0.userId == userID }) {
                detail.members.append(MemberSummary(userId: userID, displayName: contact.displayName, role: .member, state: .invited))
            }
            let invitationID = makeID("invitation")
            result.append(CreatedInvitation(invitationId: invitationID, contactSelectionId: makeID("contact"),
                                            code: "SIMULATED-\(invitationID.uppercased())", expiresAt: nowMilliseconds + 86_400_000))
        }
        records[eventID] = detail
        createdInvitations[key] = Replay(input: fingerprint, result: result)
        emit(eventID: eventID)
        return result
    }

    func createTask(_ input: CreateTaskInput) async throws -> String {
        var detail = try authorizedDetail(input.eventId, organizer: true)
        let key = input.eventId + ":" + (try checkedKey(input.idempotencyKey))
        let fingerprint = try encoded(input)
        if let replay = createdTasks[key] { return try replayResult(replay, input: fingerprint) }
        let title = try checkedTitle(input.title)
        guard detail.event.version == input.expectedEventVersion else {
            throw RallyClientError.validation("This event changed. Refresh it before creating a task.")
        }
        guard detail.event.status != .completed, detail.event.status != .canceled else {
            throw RallyClientError.validation("This event is closed.")
        }
        let capacity = input.capacity ?? 1
        guard (1...20).contains(capacity), input.expectedEventVersion > 0 else { throw RallyClientError.validation("A task needs 1–20 available places and a current event version.") }
        guard (input.windowStart == nil) == (input.windowEnd == nil) else {
            throw RallyClientError.validation("Provide both task start and end times.")
        }
        if let start = input.windowStart, !validTimestamp(start) {
            throw RallyClientError.validation("Check the task start time.")
        }
        if let end = input.windowEnd, !validTimestamp(end) {
            throw RallyClientError.validation("Check the task end time.")
        }
        if let start = input.windowStart, let end = input.windowEnd, end <= start {
            throw RallyClientError.validation("The task must end after it starts.")
        }
        let dependencies = input.dependsOnTaskIds ?? []
        guard dependencies.count <= 20, dependencies.allSatisfy({ dependency in
            guard let task = detail.tasks.first(where: { $0.id == dependency }), task.status != .canceled,
                  let end = task.windowEnd, let start = input.windowStart else { return false }
            return end <= start
        }) else {
            throw RallyClientError.validation("Dependencies must belong to this event and end before this task starts.")
        }
        if let skills = input.requiredSkills {
            guard skills.count <= 20 else { throw RallyClientError.validation("Choose at most 20 required skills.") }
            for skill in skills { _ = try checkedTitle(skill) }
        }
        let id = makeID("task")
        detail.tasks.append(RallyTaskSummary(_id: id, eventId: input.eventId, title: title, location: cleanedLocation(input.location),
                                            windowStart: input.windowStart, windowEnd: input.windowEnd,
                                            capacity: capacity, status: .unassigned, version: 1, activeAssigneeIds: []))
        records[input.eventId] = detail
        createdTasks[key] = Replay(input: fingerprint, result: id)
        emit(eventID: input.eventId)
        return id
    }

    /// Explicit demo control: injects a simulated Jordan YES; never impersonates a
    /// real participant or claims a Photon reply occurred. Repeated presses are inert.
    func simulateAcceptance() async throws {
        var detail = try authorizedDetail("event_charity_5k")
        guard let proposalIndex = detail.proposals.firstIndex(where: { $0.id == "proposal_simulated_jordan" }),
              let taskIndex = detail.tasks.firstIndex(where: { $0.id == "task_charity_setup" }) else {
            throw RallyClientError.unavailable("The simulated offer is unavailable.")
        }
        if detail.proposals[proposalIndex].state == .accepted { return }
        guard detail.proposals[proposalIndex].state == .pending,
              detail.proposals[proposalIndex].expiresAt > nowMilliseconds,
              detail.event.version == 1, detail.tasks[taskIndex].version == 1,
              detail.members.contains(where: { $0.userId == "usr_jordan" && $0.state == .enrolled }) else {
            throw RallyClientError.validation("The simulated offer changed and cannot be accepted.")
        }
        detail.proposals[proposalIndex].state = .accepted
        detail.tasks[taskIndex].activeAssigneeIds = ["usr_jordan"]
        detail.tasks[taskIndex].status = .confirmed
        detail.tasks[taskIndex].version += 1
        records[detail.event.id] = detail
        emit(eventID: detail.event.id)
    }

    private func authorizedDetail(_ eventID: String, organizer: Bool = false) throws -> EventDetail {
        guard var detail = records[eventID],
              let member = detail.members.first(where: { $0.userId == session.userID && $0.state == .enrolled }),
              !organizer || member.role == .organizer else {
            // Missing and forbidden IDs deliberately share the same response.
            throw RallyClientError.accessDenied
        }
        detail.event.role = member.role
        return detail
    }

    private func visibleEvents() -> [EventSummary] {
        records.keys.compactMap { try? authorizedDetail($0).event }
            .sorted { $0.startsAt == $1.startsAt ? $0.id < $1.id : $0.startsAt < $1.startsAt }
    }

    private func emit(eventID: String) {
        let summaries = visibleEvents()
        for continuation in eventListeners.values { continuation.yield(summaries) }
        for listener in detailListeners.values where listener.eventID == eventID {
            do { listener.continuation.yield(try authorizedDetail(eventID)) }
            catch { listener.continuation.finish(throwing: error) }
        }
    }

    private func encoded<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(value)
    }

    private func replayResult<T>(_ replay: Replay<T>, input: Data) throws -> T {
        guard replay.input == input else {
            throw RallyClientError.validation("This request was already used for different details. Start a new request.")
        }
        return replay.result
    }

    private func checkedKey(_ key: String) throws -> String {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 128 else {
            throw RallyClientError.validation("A request identifier of at most 128 characters is required.")
        }
        return trimmed
    }

    private func checkedTitle(_ raw: String) throws -> String {
        let title = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.count <= 256 else {
            throw RallyClientError.validation("Enter a name with 1–256 characters.")
        }
        return title
    }

    private func cleanedLocation(_ raw: String?) -> String? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    private func makeID(_ kind: String) -> String {
        defer { nextID += 1 }
        return "simulated_\(kind)_\(nextID)"
    }

    private var nowMilliseconds: Double { floor(now().timeIntervalSince1970 * 1_000) }

    private func validTimestamp(_ value: Double) -> Bool {
        value.isFinite && value >= 0 && value <= 9_007_199_254_740_991 && value.rounded(.towardZero) == value
    }

    private func makeChallenge(key: String, purpose: ChallengePurpose, lifetime: Double) -> PhoneLinkChallenge {
        if let previous = challengeKeys[key] { return previous }
        let id = makeID("challenge")
        let challenge = PhoneLinkChallenge(invitationId: id, code: "SIMULATED-\(id.uppercased())", expiresAt: nowMilliseconds + lifetime)
        challengeKeys[key] = challenge
        challenges[id] = SimulatedChallenge(challenge: challenge, purpose: purpose)
        return challenge
    }

    private static func fixtures(proposalExpiry: Double) -> [String: EventDetail] {
        let start = 1_792_245_600_000.0
        let charity = EventDetail(
            event: EventSummary(_id: "event_charity_5k", title: "Charity 5K", kind: .event, startsAt: start,
                                timezone: "America/New_York", location: "UNC campus", status: .scheduled, version: 1, role: .organizer),
            tasks: [RallyTaskSummary(_id: "task_charity_setup", eventId: "event_charity_5k", title: "setup", windowStart: start,
                                    windowEnd: start + 3_600_000, capacity: 1, status: .confirmed, version: 1, activeAssigneeIds: ["usr_maya"])],
            members: [
                MemberSummary(userId: "usr_alex", displayName: "Alex", role: .organizer, state: .enrolled),
                MemberSummary(userId: "usr_maya", displayName: "Maya", role: .member, state: .enrolled),
                MemberSummary(userId: "usr_jordan", displayName: "Jordan", role: .member, state: .enrolled),
                MemberSummary(userId: "usr_taylor", displayName: "Taylor", role: .member, state: .invited)
            ],
            proposals: [ProposalSummary(_id: "proposal_simulated_jordan", eventId: "event_charity_5k", type: .reassignment,
                                        targetTaskId: "task_charity_setup", targetUserId: "usr_jordan", state: .pending,
                                        requiresOrganizerApproval: false, expiresAt: proposalExpiry)]
        )
        let hackStart = 1_792_278_000_000.0
        let hack = EventDetail(
            event: EventSummary(_id: "event_hack_night", title: "Hack Night", kind: .event, startsAt: hackStart,
                                timezone: "America/New_York", location: "Fixture meeting room", status: .scheduled, version: 1, role: .organizer),
            tasks: [RallyTaskSummary(_id: "task_hack_setup", eventId: "event_hack_night", title: "setup", windowStart: hackStart,
                                    windowEnd: hackStart + 3_600_000, capacity: 1, status: .unassigned, version: 1, activeAssigneeIds: [])],
            members: [
                MemberSummary(userId: "usr_alex", displayName: "Alex", role: .organizer, state: .enrolled),
                MemberSummary(userId: "usr_jordan", displayName: "Jordan", role: .member, state: .enrolled)
            ], proposals: [ProposalSummary(_id: "proposal_simulated_organizer_review", eventId: "event_hack_night", type: .assignment,
                                          targetTaskId: "task_hack_setup", targetUserId: "usr_jordan", state: .pending,
                                          requiresOrganizerApproval: true, expiresAt: proposalExpiry)]
        )
        let unrelated = EventDetail(
            event: EventSummary(_id: "event_private", title: "Private fixture event", kind: .event, startsAt: start,
                                timezone: "America/New_York", status: .scheduled, version: 1, role: .organizer),
            tasks: [], members: [MemberSummary(userId: "usr_unrelated", displayName: "Private fixture owner", role: .organizer, state: .enrolled)], proposals: []
        )
        return [charity.event.id: charity, hack.event.id: hack, unrelated.event.id: unrelated]
    }
}
