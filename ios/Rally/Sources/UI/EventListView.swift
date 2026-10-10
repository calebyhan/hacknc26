import SwiftUI

struct EventListView: View {
    let client: any RallyClient
    @EnvironmentObject private var session: AppSession
    @State private var events: [EventSummary] = []
    @State private var loading = true
    @State private var error: String?
    @State private var retry = 0
    @State private var showCreate = false
    @State private var showPhone = false

    var body: some View {
        NavigationStack {
            List {
                if client.mode == .demo {
                    Section { DemoNotice() }
                } else if session.connection.isStale {
                    Section { Label(session.connection.statusText, systemImage: "wifi.slash").font(.caption) }
                }
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("A little coordination.\nA lot more together.")
                            .font(.title2.bold())
                        Text("Your plans, people, and commitments in one place.")
                            .foregroundStyle(.secondary)
                    }.padding(.vertical, 10)
                }
                if loading {
                    Section { ProgressView("Loading events…") }
                } else if let error {
                    Section {
                        ErrorNotice(message: error)
                        if !events.isEmpty { Text("Showing the last received events. They may be out of date.").font(.caption) }
                        Button("Try again") { retry += 1 }
                    }
                }
                Section("Your events") {
                    if !loading && events.isEmpty && error == nil {
                        ContentUnavailableView("A plan starts here", systemImage: "calendar.badge.plus", description: Text("Create your first event to bring people together."))
                    }
                    ForEach(events) { event in
                        NavigationLink {
                            EventDetailView(client: client, eventID: event.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(event.title).font(.headline)
                                    Spacer()
                                    Text(event.role == .organizer ? "Organizer" : event.role == .member ? "Member" : "Unknown")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Label(eventDate(event.startsAt, timezone: event.timezone), systemImage: "calendar")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                if let location = event.location, !location.isEmpty {
                                    Label(location, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(.secondary)
                                }
                            }.padding(.vertical, 8)
                        }.accessibilityIdentifier("event-\(event.id)")
                    }
                }
                Section {
                    Button { showCreate = true } label: { Label("Create an event", systemImage: "plus.circle.fill") }
                    Button { showPhone = true } label: { Label("Connect iMessage", systemImage: "message") }
                }
            }
            .navigationTitle("Rally")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Connect iMessage", systemImage: "message") { showPhone = true }
                        Button(client.mode == .demo ? "Leave demo" : "Sign out", systemImage: "rectangle.portrait.and.arrow.right") {
                            Task { await session.signOut() }
                        }
                    } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Account")
                }
            }
            .sheet(isPresented: $showCreate) { EventCreateView(client: client) }
            .sheet(isPresented: $showPhone) { OnboardingAndLinkPhoneView(mode: client.mode) }
            .task(id: retry) { await subscribe() }
        }
    }

    private func subscribe() async {
        loading = events.isEmpty
        error = nil
        do {
            for try await received in client.events() {
                guard !Task.isCancelled else { return }
                events = received
                loading = false
            }
        } catch {
            guard !Task.isCancelled else { return }
            events = []
            self.error = error.localizedDescription
            loading = false
        }
    }
}
