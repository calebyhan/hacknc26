import SwiftUI

struct EventCreateView: View {
    let client: any RallyClient
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var startsAt = Date().addingTimeInterval(86_400)
    @State private var timezone = TimeZone.current.identifier
    @State private var location = ""
    @State private var saving = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        NavigationStack {
            Form {
                if client.mode == .demo { Section { DemoNotice() } }
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
                Section {
                    Text("You’ll be the organizer. Add people from the event page after creating your event.")
                    Text("People only join after they text Rally with their invitation code.")
                }.font(.subheadline).foregroundStyle(.secondary)
                if let error { Section { ErrorNotice(message: error) } }
            }
            .disabled(saving)
            .navigationTitle("Create an event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if saving { ProgressView() } else { Text("Create") }
                    }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || saving)
                        .accessibilityIdentifier("saveEvent")
                }
            }
            .interactiveDismissDisabled(saving)
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            let cleanLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
            _ = try await client.createEvent(CreateEventInput(
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                startsAt: startsAt.timeIntervalSince1970 * 1000,
                timezone: timezone,
                location: cleanLocation.isEmpty ? nil : cleanLocation,
                idempotencyKey: idempotencyKey
            ))
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
