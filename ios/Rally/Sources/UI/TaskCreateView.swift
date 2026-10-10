import SwiftUI

struct TaskCreateView: View {
    let client: any RallyClient
    let event: EventSummary
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var saving = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        NavigationStack {
            Form {
                if client.mode == .demo { Section { DemoNotice() } }
                Section("Task") { TextField("What needs doing?", text: $title) }
                Section {
                    Text("This creates an open task for one person. Coordinate who takes it through iMessage; the participant must accept before it’s confirmed.")
                        .foregroundStyle(.secondary)
                }
                if let error { Section { ErrorNotice(message: error) } }
            }
            .disabled(saving)
            .navigationTitle("Add a task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await save() } }
                        .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
            _ = try await client.createTask(CreateTaskInput(
                eventId: event.id, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                capacity: 1, expectedEventVersion: event.version, idempotencyKey: idempotencyKey
            ))
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
