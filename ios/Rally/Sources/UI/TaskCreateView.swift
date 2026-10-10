import SwiftUI

struct TaskCreateView: View {
    let client: any RallyClient
    let event: EventSummary
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: AppSession
    @State private var title = ""
    @State private var windowStart: Date
    @State private var windowEnd: Date
    @State private var currentEvent: EventSummary?
    @State private var saving = false
    @State private var error: String?
    @State private var queryError: String?
    @State private var queryRetry = 0
    @State private var idempotencyKey = UUID().uuidString
    @State private var submittedInput: CreateTaskInput?
    @State private var showRestart = false

    init(client: any RallyClient, event: EventSummary) {
        self.client = client
        self.event = event
        _windowStart = State(initialValue: event.startDate)
        _windowEnd = State(initialValue: event.startDate.addingTimeInterval(3_600))
    }

    private var canWrite: Bool {
        guard let currentEvent, currentEvent.isOrganizer else { return false }
        return currentEvent.status == .draft || currentEvent.status == .scheduled
    }

    private var validWindow: Bool { (try? EventSetupTime.window(start: windowStart, end: windowEnd)) != nil }

    var body: some View {
        NavigationStack {
            Form {
                if client.mode == .demo { Section { DemoNotice() } }
                if let currentEvent {
                    Section("Event") {
                        Text(currentEvent.title)
                        Text("Times use \(currentEvent.timezone)").font(.caption).foregroundStyle(.secondary)
                        if !canWrite { Text("Tasks cannot be added with your current role or this event's status.") }
                    }
                } else if let queryError {
                    Section {
                        ErrorNotice(message: queryError)
                        Button("Refresh event") { queryRetry += 1 }
                    }
                } else {
                    Section { ProgressView("Loading current event…") }
                }
                Section("Task") {
                    TextField("What needs doing?", text: $title).accessibilityIdentifier("taskTitle")
                    DatePicker("Starts", selection: $windowStart).accessibilityIdentifier("taskStart")
                    DatePicker("Ends", selection: $windowEnd).accessibilityIdentifier("taskEnd")
                    if !validWindow { Text("The task must end after it starts.").foregroundStyle(.red) }
                }
                .environment(\.timeZone, TimeZone(identifier: currentEvent?.timezone ?? event.timezone) ?? .gmt)
                .disabled(saving || submittedInput != nil || !canWrite)
                Section {
                    Text("This creates an open task for one person. The participant must accept through iMessage before it is confirmed.")
                        .foregroundStyle(.secondary)
                }
                if let error { Section { ErrorNotice(message: error) } }
                if submittedInput != nil && !saving {
                    Section("Check before changing this request") {
                        Text("A failed response may still have saved the task. Retrying preserves the exact request and its event version. Review the event before starting another request.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button("Review event tasks") { dismiss() }
                        Button("Refresh event") { queryRetry += 1 }
                        Button("Start a new request") { showRestart = true }.disabled(!canWrite)
                    }
                }
            }
            .disabled(saving)
            .navigationTitle("Add a task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submittedInput == nil ? "Add" : "Retry same request") { Task { await save() } }
                        .disabled(saving || !canWrite || !validWindow || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("saveTask")
                }
            }
            .interactiveDismissDisabled(saving)
            .task(id: queryRetry) { await subscribe() }
            .confirmationDialog("Start a separate task request?", isPresented: $showRestart, titleVisibility: .visible) {
                Button("Start new request") {
                    submittedInput = nil
                    idempotencyKey = UUID().uuidString
                    error = nil
                    queryRetry += 1
                }
                Button("Keep this request", role: .cancel) { }
            } message: {
                Text("Check the event's tasks first. A new request may create another task if the previous attempt succeeded.")
            }
            .onChange(of: session.identityGeneration) { _, _ in dismiss() }
        }
    }

    private func subscribe() async {
        currentEvent = nil
        queryError = nil
        let generation = session.identityGeneration
        do {
            for try await detail in client.detail(eventID: event.id) {
                guard !Task.isCancelled, session.identityGeneration == generation else { return }
                currentEvent = detail.event
            }
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            currentEvent = nil
            queryError = "Event updates ended. Refresh before creating a task."
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            currentEvent = nil
            queryError = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
        }
    }

    private func save() async {
        guard !saving, canWrite, let currentEvent else { return }
        saving = true
        error = nil
        defer { saving = false }
        let generation = session.identityGeneration
        do {
            let window = try EventSetupTime.window(start: windowStart, end: windowEnd)
            let input = submittedInput ?? CreateTaskInput(
                eventId: currentEvent.id, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                windowStart: window.start, windowEnd: window.end,
                capacity: 1, expectedEventVersion: currentEvent.version, idempotencyKey: idempotencyKey
            )
            submittedInput = input
            _ = try await client.createTask(input)
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            dismiss()
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            self.error = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
        }
    }
}
