import SwiftUI

struct EventCreateView: View {
    let client: any RallyClient
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: AppSession
    @State private var title = ""
    @State private var startsAt = Date().addingTimeInterval(86_400)
    @State private var timezone = TimeZone.current.identifier
    @State private var location = ""
    @State private var saving = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString
    @State private var submittedInput: CreateEventInput?
    @State private var showRestart = false

    var body: some View {
        NavigationStack {
            Form {
                if client.mode == .demo { Section { DemoNotice() } }
                if !session.canCreateEvents {
                    Section { Text("Connect your phone before creating an event. Return to Connect iMessage to finish verification.") }
                }
                Section("The plan") {
                    TextField("Event title", text: $title)
                        .accessibilityIdentifier("eventTitle")
                    DatePicker("Starts", selection: $startsAt)
                        .environment(\.timeZone, TimeZone(identifier: timezone) ?? .current)
                    TextField("Location (optional)", text: $location)
                    Picker("Time zone", selection: $timezone) {
                        ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { identifier in
                            Text(identifier.replacingOccurrences(of: "_", with: " ")).tag(identifier)
                        }
                    }
                }
                .disabled(saving || submittedInput != nil)
                Section {
                    Text("This creates a draft. Review it, add timed tasks, then confirm the event from its page.")
                    Text("People only join after they text Rally with their invitation code.")
                }.font(.subheadline).foregroundStyle(.secondary)
                if let error { Section { ErrorNotice(message: error) } }
                if submittedInput != nil && !saving {
                    Section("Check before changing this request") {
                        Text("A failed response may still have saved the event. Retry the same request or check your events before starting another.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button("Review my events") { dismiss() }
                        Button("Start a new request") { showRestart = true }
                    }
                }
            }
            .disabled(saving)
            .navigationTitle("Create an event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text(submittedInput == nil ? "Create" : "Retry same request") }
                    }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving || !session.canCreateEvents)
                        .accessibilityIdentifier("saveEvent")
                }
            }
            .interactiveDismissDisabled(saving)
            .confirmationDialog("Start a separate event request?", isPresented: $showRestart, titleVisibility: .visible) {
                Button("Start new request") {
                    submittedInput = nil
                    idempotencyKey = UUID().uuidString
                    error = nil
                }
                Button("Keep this request", role: .cancel) { }
            } message: {
                Text("Check your events first. If the earlier request saved successfully, a new request can create another event.")
            }
            .onChange(of: session.identityGeneration) { _, _ in dismiss() }
        }
    }

    private func save() async {
        guard !saving, session.canCreateEvents else { return }
        saving = true
        error = nil
        defer { saving = false }
        let generation = session.identityGeneration
        do {
            let cleanLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
            let input = try submittedInput ?? CreateEventInput(
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                startsAt: EventSetupTime.milliseconds(startsAt),
                timezone: timezone,
                location: cleanLocation.isEmpty ? nil : cleanLocation,
                idempotencyKey: idempotencyKey
            )
            submittedInput = input
            _ = try await client.createEvent(input)
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            dismiss()
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            self.error = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
        }
    }
}
