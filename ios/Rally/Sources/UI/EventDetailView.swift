import SwiftUI

struct EventDetailView: View {
    let client: any RallyClient
    let eventID: String
    @EnvironmentObject private var session: AppSession
    @State private var detail: EventDetail?
    @State private var error: String?
    @State private var actionError: String?
    @State private var receivedAt: Date?
    @State private var retry = 0
    @State private var showContacts = false
    @State private var showTask = false
    @State private var showPhone = false

    var body: some View {
        List {
            if client.mode == .demo { Section { DemoNotice() } }
            if let detail {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(detail.event.title).font(.largeTitle.bold())
                        Label(eventDate(detail.event.startsAt, timezone: detail.event.timezone), systemImage: "calendar")
                        Text(detail.event.timezone).font(.caption).foregroundStyle(.secondary)
                        if let location = detail.event.location {
                            Label(location, systemImage: "mappin.and.ellipse")
                        }
                        if let status = detail.event.displayStatus { StatusBadge(status: status) }
                    }.padding(.vertical, 8)
                }
                Section("Tasks") {
                    if detail.tasks.isEmpty { Text("No tasks yet.").foregroundStyle(.secondary) }
                    ForEach(detail.tasks) { task in
                        TaskRow(task: task, detail: detail)
                    }
                    if detail.event.isOrganizer {
                        Button { showTask = true } label: { Label("Add a task", systemImage: "plus") }
                    }
                }
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
                                Text(member.state == .enrolled ? "Joined" : "Left event")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 3)
                    }
                    if detail.event.isOrganizer {
                        Button { showContacts = true } label: { Label("Invite people", systemImage: "person.badge.plus") }
                    }
                }
                Section("Agent activity") {
                    let pending = detail.proposals.filter { $0.state == .pending }
                    if pending.isEmpty {
                        Text("No pending requests.")
                    } else {
                        ForEach(pending) { proposal in
                            VStack(alignment: .leading, spacing: 6) {
                                if proposal.displayStatus == .pendingApproval {
                                    Text("Waiting for organizer approval")
                                } else if let target = proposal.targetUserId {
                                    Text("Rally is waiting for \(detail.memberName(target))")
                                } else {
                                    Text("A request is pending")
                                }
                                if let status = proposal.displayStatus { StatusBadge(status: status) }
                            }
                        }
                    }
                    Text("Activity history isn’t available in this build.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Button { showPhone = true } label: { Label("Connect iMessage", systemImage: "message") }
                    if client.mode == .demo, let demo = client as? MockRallyClient,
                       eventID == "event_charity_5k" {
                        Button("Simulate Jordan accepting") {
                            Task {
                                do { try await demo.simulateAcceptance() }
                                catch { actionError = error.localizedDescription }
                            }
                        }.disabled(demo.simulationAccepted)
                        Text("Demo control: updates this local fixture only.").font(.caption).foregroundStyle(.secondary)
                    }
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
                    Button("Try again") { retry += 1 }
                }
            } else {
                ProgressView("Loading event…")
            }
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: retry) { await subscribe() }
        .sheet(isPresented: $showContacts) { ContactReviewView(client: client, eventID: eventID) }
        .sheet(isPresented: $showTask) {
            if let detail { TaskCreateView(client: client, event: detail.event) }
        }
        .sheet(isPresented: $showPhone) { OnboardingAndLinkPhoneView(mode: client.mode) }
    }

    private func subscribe() async {
        error = nil
        do {
            for try await received in client.detail(eventID: eventID) {
                guard !Task.isCancelled else { return }
                detail = received
                receivedAt = Date()
            }
        } catch {
            guard !Task.isCancelled else { return }
            // A query error may mean permission was revoked. Never retain its protected data.
            detail = nil
            self.error = error.localizedDescription
        }
    }
}

private struct TaskRow: View {
    let task: RallyTaskSummary
    let detail: EventDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(task.title.capitalized).font(.headline)
            if task.status != .unassigned || detail.pendingProposals(for: task.id).isEmpty {
                StatusBadge(status: task.committedDisplayStatus)
            }
            if !task.activeAssigneeIds.isEmpty {
                Text("\(task.status == .confirmed ? "Confirmed" : "Assigned"): \(task.activeAssigneeIds.map(detail.memberName).joined(separator: ", "))")
                    .font(.subheadline.weight(.medium))
            }
            if let start = task.windowStart {
                Text(timeRange(start: start)).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(detail.pendingProposals(for: task.id)) { proposal in
                VStack(alignment: .leading, spacing: 5) {
                    if let target = proposal.targetUserId {
                        Text("Proposed: \(detail.memberName(target))").font(.subheadline.weight(.medium))
                    } else {
                        Text("A change has been proposed").font(.subheadline)
                    }
                    if let status = proposal.displayStatus { StatusBadge(status: status) }
                    Text("This request has not changed the assignment.")
                        .font(.caption).foregroundStyle(.secondary)
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
