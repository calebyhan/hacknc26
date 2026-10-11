import SwiftUI
import UIKit

struct EventDetailView: View {
    let client: any RallyClient
    let eventID: String
    @EnvironmentObject private var session: AppSession
    @State private var detail: EventDetail?
    @State private var appStatus: EventAppStatus?
    @State private var appStatusError: String?
    @State private var error: String?
    @State private var actionError: String?
    @State private var actionNotice: String?
    @State private var receivedAt: Date?
    @State private var retry = 0
    @State private var refreshing = true
    @State private var busyAction: String?
    @State private var verification: EventMutationVerification?
    @State private var verificationQuery: Int?
    @State private var showContacts = false
    @State private var showTask = false
    @State private var showPhone = false
    @State private var showConfirm = false
    @State private var confirmVersion: Int?
    @State private var organizerChallenge: PhoneLinkChallenge?
    @State private var organizerRequestKey = UUID().uuidString
    @State private var organizerRequestAttempted = false
    @State private var presentationDate = Date()

    private var pendingExpirations: [Double] {
        detail?.proposals.filter { $0.state == .pending && $0.expiresAt.isFinite }.map(\.expiresAt).sorted() ?? []
    }

    private var actionDisabled: Bool {
        refreshing || busyAction != nil || (client.mode == .live && session.connection.isStale)
    }

    var body: some View {
        List {
            if client.mode == .demo { Section { DemoNotice() } }
            if let detail {
                eventSection(detail)
                if detail.event.isOrganizer && detail.event.status == .draft {
                    Section("Review the draft") {
                        Text("Review the event time, location and tasks before scheduling. Confirming the event does not assign its tasks.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button("Confirm event") {
                            confirmVersion = detail.event.version
                            showConfirm = true
                        }
                        .disabled(actionDisabled)
                        .accessibilityIdentifier("confirmEvent")
                    }
                }
                taskSection(detail)
                peopleSection(detail)
                messagingSection
                if detail.event.isOrganizer && (detail.event.status == .draft || detail.event.status == .scheduled) {
                    if appStatus?.messaging.consentRecorded == false { organizerSection }
                }
                requestsSection(detail)
                activitySection
                Section {
                    Button { showPhone = true } label: { Label("Connect iMessage", systemImage: "message") }
                    if client.mode == .demo, let demo = client as? MockRallyClient,
                       eventID == "event_charity_5k" {
                        Button("Simulate Jordan accepting") {
                            Task {
                                do { try await demo.simulateAcceptance() }
                                catch { actionError = error.localizedDescription }
                            }
                        }.disabled(demo.simulationAccepted || actionDisabled)
                        Text("Demo control: updates this local fixture only.").font(.caption).foregroundStyle(.secondary)
                    }
                    if let busyAction { ProgressView(busyAction) }
                    if refreshing { ProgressView("Refreshing event state…") }
                    if let actionNotice { Text(actionNotice).font(.subheadline).accessibilityIdentifier("eventActionNotice") }
                    if let actionError { ErrorNotice(message: actionError) }
                }
                Section {
                    if client.mode == .live && session.connection.isStale {
                        Label("Reconnecting · this view may be out of date", systemImage: "wifi.slash")
                    }
                    Text("Event version \(detail.event.version)")
                    if let receivedAt {
                        Text("Last received \(receivedAt.formatted(date: .omitted, time: .shortened))")
                    }
                }.font(.caption).foregroundStyle(.secondary)
            } else if let error {
                Section {
                    ErrorNotice(message: error)
                    Button("Try again") { refresh() }
                }
            } else {
                ProgressView("Loading event…")
            }
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Refresh", systemImage: "arrow.clockwise") { refresh() }.disabled(busyAction != nil)
            }
        }
        .task(id: "\(retry):\(session.identityGeneration)") { await subscribe() }
        .task(id: "\(retry):\(session.identityGeneration)") { await subscribeAppStatus() }
        .task(id: pendingExpirations) { await updateExpiryClock() }
        .sheet(isPresented: $showContacts) { ContactReviewView(client: client, eventID: eventID) }
        .sheet(isPresented: $showTask) {
            if let detail { TaskCreateView(client: client, event: detail.event) }
        }
        .sheet(isPresented: $showPhone) { OnboardingAndLinkPhoneView(client: client) }
        .confirmationDialog("Confirm this event's current plan?", isPresented: $showConfirm, titleVisibility: .visible) {
            Button("Schedule event") { Task { await confirmEvent() } }
            Button("Keep draft", role: .cancel) { }
        } message: {
            Text("The event will be scheduled. Participant invitations and task acceptance remain separate steps.")
        }
        .onChange(of: session.identityGeneration) { _, _ in
            detail = nil
            appStatus = nil
            appStatusError = nil
            organizerChallenge = nil
            organizerRequestKey = UUID().uuidString
            organizerRequestAttempted = false
            verification = nil
            verificationQuery = nil
            actionNotice = nil
            actionError = nil
            busyAction = nil
            showContacts = false
            showTask = false
            showConfirm = false
            refreshing = true
        }
    }

    private func eventSection(_ detail: EventDetail) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                Text(detail.event.title).font(.largeTitle.bold())
                Label(eventDate(detail.event.startsAt, timezone: detail.event.timezone), systemImage: "calendar")
                Text(detail.event.timezone).font(.caption).foregroundStyle(.secondary)
                if let location = detail.event.location { Label(location, systemImage: "mappin.and.ellipse") }
                if let status = detail.event.displayStatus { StatusBadge(status: status) }
                if let progress = appStatus?.progress {
                    Text(progress.summary).font(.subheadline).foregroundStyle(.secondary)
                }
            }.padding(.vertical, 8)
        }
    }

    private func taskSection(_ detail: EventDetail) -> some View {
        Section("Tasks") {
            if detail.tasks.isEmpty { Text("No tasks yet.").foregroundStyle(.secondary) }
            ForEach(detail.tasks) { task in TaskRow(task: task, detail: detail, now: presentationDate) }
            if detail.event.isOrganizer && (detail.event.status == .draft || detail.event.status == .scheduled) {
                Button { showTask = true } label: { Label("Add a task", systemImage: "plus") }
                    .disabled(actionDisabled)
            }
        }
    }

    private func peopleSection(_ detail: EventDetail) -> some View {
        Section("People") {
            ForEach(detail.members) { member in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(member.displayName).font(.headline)
                        Spacer()
                        if member.role == .organizer { Text("Organizer").font(.caption).foregroundStyle(.secondary) }
                    }
                    if let status = member.displayStatus {
                        StatusBadge(status: status)
                    } else {
                        Text(member.state == .enrolled ? (member.role == .organizer ? "Organizer access" : "Joined event") : "Left event")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 3)
            }
            if detail.event.isOrganizer && (detail.event.status == .draft || detail.event.status == .scheduled) {
                Button { showContacts = true } label: { Label("Invite people", systemImage: "person.badge.plus") }
                    .disabled(actionDisabled)
            }
        }
    }

    private var organizerSection: some View {
        Section("Your event messages") {
            Text("Text this event's JOIN code from your linked phone to enable its messages. Phone verification and organizer access are separate.")
                .font(.subheadline).foregroundStyle(.secondary)
            if let challenge = organizerChallenge {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    let expired = challenge.expirationDate <= context.date
                    VStack(alignment: .leading, spacing: 8) {
                        Text("JOIN \(challenge.code)").font(.body.monospaced()).textSelection(.enabled)
                        Text(expired ? "This code expired." : "Expires \(challenge.expirationDate.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                        Button("Copy JOIN code") { UIPasteboard.general.string = "JOIN \(challenge.code)" }
                            .disabled(expired)
                        if expired {
                            Button("Request a new code") { Task { await requestOrganizerCode(renew: true) } }
                                .disabled(actionDisabled || !session.phoneVerifiedForSession)
                        }
                    }
                }
                Text(client.mode == .demo ? "This is a simulated code and cannot be redeemed." : "Text the code in your provisioned Rally conversation. Use the contact shortcut above when available.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Button(organizerRequestAttempted ? "Retry code request" : "Get my event JOIN code") {
                    Task { await requestOrganizerCode(renew: false) }
                }
                .disabled(actionDisabled || !session.phoneVerifiedForSession)
                .accessibilityIdentifier("organizerInvitation")
                if !session.phoneVerifiedForSession {
                    Text("Verify your linked phone through Connect iMessage first.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("The messaging status above updates after a verified JOIN. Copying a code does not join the event.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func requestsSection(_ detail: EventDetail) -> some View {
        Section("Requests") {
            if detail.proposals.isEmpty { Text("No requests.") }
            ForEach(detail.proposals) { proposal in
                VStack(alignment: .leading, spacing: 6) {
                    if let taskID = proposal.targetTaskId,
                       let task = detail.tasks.first(where: { $0.id == taskID }) {
                        Text(task.title.capitalized).font(.headline)
                    }
                    Text(proposal.statusDescription(at: presentationDate))
                    if proposal.isCurrent(at: presentationDate), proposal.displayStatus(at: presentationDate) != .unknown, let target = proposal.targetUserId {
                        Text("Participant: \(detail.memberName(target))").font(.subheadline)
                    }
                    if let status = proposal.displayStatus(at: presentationDate) { StatusBadge(status: status) }
                    if detail.event.isOrganizer && detail.event.status == .scheduled && proposal.canOrganizerApprove(at: presentationDate) {
                        Button("Approve asking participant") { Task { await approve(proposal) } }
                            .disabled(actionDisabled)
                            .accessibilityIdentifier("approve-\(proposal.id)")
                        Text("This approval allows the request. The participant must still accept.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 4)
            }
        }
    }

    private var messagingSection: some View {
        Section("Your messaging status") {
            if let appStatus {
                Text(appStatus.messaging.statusTitle).font(.headline)
                    .accessibilityIdentifier("eventMessagingStatus")
                if appStatus.messaging.messagingState == .stopped || appStatus.messaging.messagingState == .paused {
                    Text("Text RESUME in your Rally conversation to resume messages. Event consent is still required.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                RallyRouteView(route: appStatus.route, mode: client.mode,
                               isStale: client.mode == .live && session.connection.isStale)
            } else if let appStatusError {
                ErrorNotice(message: appStatusError)
                Button("Retry messaging status") { refresh() }
            } else {
                ProgressView("Loading messaging status…")
            }
        }
    }

    private var activitySection: some View {
        Section("Recent activity") {
            if let appStatus {
                EventActivityView(entries: appStatus.activity)
            } else {
                Text(appStatusError == nil ? "Loading activity…" : "Activity unavailable until status reloads.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func subscribeAppStatus() async {
        appStatus = nil
        appStatusError = nil
        let generation = session.identityGeneration
        let query = retry
        do {
            for try await status in client.eventStatus(eventID: eventID) {
                guard !Task.isCancelled, session.identityGeneration == generation, query == retry else { return }
                guard status.eventId == eventID else {
                    throw RallyClientError.unavailable("The status response did not match this event.")
                }
                appStatus = status
                if status.messaging.consentRecorded { organizerChallenge = nil }
            }
            guard !Task.isCancelled, session.identityGeneration == generation, query == retry else { return }
            appStatus = nil
            appStatusError = "Status updates ended. Retry to load current activity and consent."
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation, query == retry else { return }
            appStatus = nil
            appStatusError = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
            if error as? RallyClientError == .accessDenied {
                detail = nil
                organizerChallenge = nil
                self.error = error.localizedDescription
            }
        }
    }

    private func refresh() {
        refreshing = true
        retry += 1
    }

    /// Only tick while a displayed pending offer still has an expiry ahead.
    /// This updates copy/buttons while idle; actual actions recheck Date() too.
    private func updateExpiryClock() async {
        let expirations = pendingExpirations
        presentationDate = Date()
        while expirations.contains(where: { $0 > presentationDate.timeIntervalSince1970 * 1_000 }) {
            do { try await Task.sleep(for: .seconds(1)) }
            catch { return }
            guard !Task.isCancelled else { return }
            presentationDate = Date()
        }
    }

    private func subscribe() async {
        error = nil
        refreshing = true
        let generation = session.identityGeneration
        let query = retry
        do {
            for try await received in client.detail(eventID: eventID) {
                guard !Task.isCancelled, session.identityGeneration == generation, query == retry else { return }
                detail = received
                receivedAt = Date()
                refreshing = false
                if verificationQuery == query, let verification {
                    actionNotice = verification.message(in: received)
                    self.verification = nil
                    verificationQuery = nil
                }
            }
            guard !Task.isCancelled, session.identityGeneration == generation, query == retry else { return }
            detail = nil
            appStatus = nil
            refreshing = false
            error = "Event updates ended. Refresh to load the current event."
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation, query == retry else { return }
            // A failed query may mean revoked access. Clear all protected response data.
            detail = nil
            appStatus = nil
            organizerChallenge = nil
            actionNotice = nil
            refreshing = false
            self.error = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
        }
    }

    private func confirmEvent() async {
        guard !actionDisabled, let detail, detail.event.isOrganizer, detail.event.status == .draft,
              let version = confirmVersion else { return }
        guard detail.event.version == version else {
            actionNotice = "The event changed while you reviewed it. Review the updated draft before confirming."
            refresh()
            return
        }
        await mutate(check: .confirmation(previousVersion: version), label: "Confirming event…") {
            _ = try await client.confirmDraft(eventID: eventID, expectedVersion: version)
        }
    }

    private func approve(_ proposal: ProposalSummary) async {
        guard !actionDisabled, let detail, detail.event.isOrganizer, detail.event.status == .scheduled,
              let current = detail.proposals.first(where: { $0.id == proposal.id }), current.canOrganizerApprove() else { return }
        await mutate(check: .approval(proposalID: current.id), label: "Submitting organizer approval…") {
            try await client.approveProposal(proposalID: current.id)
        }
    }

    private func mutate(check: EventMutationVerification, label: String, operation: () async throws -> Void) async {
        let generation = session.identityGeneration
        busyAction = label
        actionError = nil
        actionNotice = nil
        do {
            try await operation()
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            verification = check
            verificationQuery = retry + 1
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            actionError = error.localizedDescription
            actionNotice = "Review the refreshed event before trying this action again."
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
        }
        guard session.identityGeneration == generation else { return }
        busyAction = nil
        // A new subscription is required even for a null/no-op result or an uncertain failure.
        refresh()
    }

    private func requestOrganizerCode(renew: Bool) async {
        guard !actionDisabled, session.phoneVerifiedForSession, detail?.event.isOrganizer == true,
              appStatus?.messaging.consentRecorded == false else { return }
        let generation = session.identityGeneration
        if renew {
            organizerRequestKey = UUID().uuidString
            organizerChallenge = nil
        }
        organizerRequestAttempted = true
        busyAction = "Getting your event JOIN code…"
        actionError = nil
        defer { if session.identityGeneration == generation { busyAction = nil } }
        do {
            let challenge = try await client.organizerInvitation(eventID: eventID, idempotencyKey: organizerRequestKey)
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            organizerChallenge = challenge
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            actionError = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
            if error as? RallyClientError == .accessDenied { refresh() }
        }
    }
}

private struct TaskRow: View {
    let task: RallyTaskSummary
    let detail: EventDetail
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(task.title.capitalized).font(.headline)
            if task.status != .unassigned || detail.pendingProposals(for: task.id, at: now).isEmpty {
                StatusBadge(status: task.committedDisplayStatus)
            }
            if let status = task.attentionDisplayStatus { StatusBadge(status: status) }
            if task.status != .completed && task.status != .canceled {
                Text("\(task.activeAssigneeIds.count) of \(task.capacity) people confirmed")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            if !task.activeAssigneeIds.isEmpty {
                Text("\(task.status == .confirmed ? "Confirmed" : "Assigned"): \(task.activeAssigneeIds.map(detail.memberName).joined(separator: ", "))")
                    .font(.subheadline.weight(.medium))
            }
            if let start = task.windowStart { Text(timeRange(start: start)).font(.caption).foregroundStyle(.secondary) }
            ForEach(detail.pendingProposals(for: task.id, at: now)) { proposal in
                VStack(alignment: .leading, spacing: 5) {
                    if let target = proposal.targetUserId {
                        Text("Proposed: \(detail.memberName(target))").font(.subheadline.weight(.medium))
                    } else {
                        Text("A change has been proposed").font(.subheadline)
                    }
                    if let status = proposal.displayStatus(at: now) { StatusBadge(status: status) }
                    Text("This request has not changed the assignment.").font(.caption).foregroundStyle(.secondary)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(uiColor: .tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }.padding(.vertical, 8)
    }

    private func timeRange(start: Double) -> String {
        let beginning = displayTime(start, timezone: detail.event.timezone)
        guard let end = task.windowEnd else { return beginning }
        return "\(beginning) – \(displayTime(end, timezone: detail.event.timezone))"
    }
}
