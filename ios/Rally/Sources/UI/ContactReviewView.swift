import SwiftUI

struct ContactReviewView: View {
    let client: any RallyClient
    let eventID: String
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: AppSession
    @State private var drafts: [ContactDraft] = []
    @State private var showPicker = false
    @State private var saving = false
    @State private var error: String?
    @State private var invitations: [CreatedInvitation] = []
    @State private var invitedName = ""
    @State private var idempotencyKey = UUID().uuidString
    @State private var submittedContacts: [SelectedContact]?
    @State private var showNewRequestWarning = false

    var body: some View {
        NavigationStack {
            Form {
                if client.mode == .demo { Section { DemoNotice() } }
                if invitations.isEmpty {
                    Section {
                        Text("Choose people, then review")
                            .font(.title2.bold())
                        Text("Only the name and phone number you select are used. Choosing a contact doesn’t enroll or message them.")
                            .foregroundStyle(.secondary)
                    }
                    Section {
                        if drafts.isEmpty { Text("No one selected yet.").foregroundStyle(.secondary) }
                        ForEach($drafts) { $draft in
                            VStack(alignment: .leading, spacing: 8) {
                                TextField("Name", text: $draft.displayName)
                                    .textContentType(.name)
                                    .disabled(submittedContacts != nil)
                                TextField("Phone with + country code", text: $draft.phone)
                                    .keyboardType(.phonePad)
                                    .textContentType(.telephoneNumber)
                                    .accessibilityLabel("Selected phone number, including country code")
                                    .disabled(submittedContacts != nil)
                            }.padding(.vertical, 4)
                        }
                        .onDelete { drafts.remove(atOffsets: $0) }
                        .deleteDisabled(submittedContacts != nil)
                        Button { showPicker = true } label: { Label("Choose from Contacts", systemImage: "person.crop.circle.badge.plus") }
                            .disabled(!drafts.isEmpty || submittedContacts != nil)
                            .accessibilityIdentifier("chooseContacts")
                        if client.mode == .demo && drafts.isEmpty {
                            Button("Use fictional contact Casey") {
                                drafts.append(ContactDraft(displayName: "Casey", phone: "+15550100005"))
                            }.accessibilityIdentifier("useFictionalContact")
                        }
                    } header: {
                        Text("Selected people")
                    } footer: {
                        Text("Invite one person at a time. Include a + country code. If a contact has several numbers, choose the intended one in the picker. Swipe to remove a selection.")
                    }
                    Section {
                        Button { Task { await save() } } label: {
                            HStack {
                                if saving { ProgressView() }
                                Text(client.mode == .demo ? "Create demo invitations" : "Create invitations")
                            }
                        }
                        .disabled(drafts.isEmpty || saving)
                        .accessibilityIdentifier("createInvitations")
                        Text("They’ll stay “Waiting for them to text Rally” until they join from their own phone.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        Label("Invitations created", systemImage: "checkmark.circle")
                            .font(.headline)
                        Text("No messages have been sent. Share each invitation yourself using the participant’s assigned Rally contact instructions.")
                        if client.mode == .demo {
                            Text("These demo codes cannot be redeemed.").font(.subheadline.bold())
                        } else {
                            Text("Rally contact instructions aren’t available in this build. Don’t send a code to an assumed shared number.")
                                .font(.subheadline)
                        }
                    }
                    Section("Invitation instructions") {
                        Text("Check the event participant list for current enrollment.").font(.caption).foregroundStyle(.secondary)
                        ForEach(invitations) { invitation in
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                let expired = invitation.expirationDate <= context.date
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(invitedName).font(.headline)
                                    Text("JOIN \(invitation.code)").font(.body.monospaced()).textSelection(.enabled)
                                    Text(expired ? "This invitation expired." : "Expires \(invitation.expirationDate.formatted(date: .abbreviated, time: .shortened))")
                                        .font(.caption).foregroundStyle(.secondary)
                                    ShareLink(item: "JOIN \(invitation.code)") {
                                        Label("Share this invitation", systemImage: "square.and.arrow.up")
                                    }
                                    .disabled(expired)
                                    .accessibilityLabel("Share invitation for \(invitedName)")
                                    if expired {
                                        Button("Start a new invitation request") { showNewRequestWarning = true }
                                    }
                                }
                            }
                        }
                    }
                }
                if let error {
                    Section {
                        ErrorNotice(message: error)
                        if submittedContacts != nil {
                            Text("Retry uses the same reviewed details and request. Check participant status if the outcome is uncertain.")
                                .font(.caption)
                            Button("Start a new invitation request") { showNewRequestWarning = true }
                        }
                    }
                }
            }
            .disabled(saving)
            .navigationTitle("Invite people")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(saving) }
            }
            .interactiveDismissDisabled(saving)
            .confirmationDialog("The previous request may already have created an invitation. Check participant status before starting another.", isPresented: $showNewRequestWarning, titleVisibility: .visible) {
                Button("Start new request") {
                    submittedContacts = nil
                    idempotencyKey = UUID().uuidString
                    invitations = []
                    error = nil
                }
                Button("Keep existing request", role: .cancel) { }
            }
            .sheet(isPresented: $showPicker) {
                NativeContactPicker { selected in
                    drafts = [selected]
                    // CNContactPicker dismisses its own presentation. Dismissing
                    // again here can close the enclosing review sheet as well.
                } onCancel: { }
            }
            .onChange(of: session.identityGeneration) { _, _ in dismiss() }
        }
    }

    private func save() async {
        guard !saving else { return }
        error = nil
        saving = true
        defer { saving = false }
        let generation = session.identityGeneration
        do {
            let selected = try submittedContacts ?? reviewedInvitationContacts(drafts)
            submittedContacts = selected
            let created = try await client.createInvitations(eventID: eventID, contacts: selected, idempotencyKey: idempotencyKey)
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            guard created.count == 1 else {
                throw RallyClientError.unavailable("The invitation response could not be matched to this person. Check their status before trying again.")
            }
            invitedName = selected[0].displayName
            invitations = created
        } catch {
            guard !Task.isCancelled, session.identityGeneration == generation else { return }
            self.error = error.localizedDescription
        }
    }
}

/// Only selected, reviewed properties cross the API; no address-book access.
func reviewedInvitationContacts(_ drafts: [ContactDraft]) throws -> [SelectedContact] {
    guard drafts.count == 1 else { throw RallyClientError.validation("Select one person for this invitation.") }
    let name = drafts[0].displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, name.count <= 120 else { throw RallyClientError.validation("Give the selected person a name with 1–120 characters.") }
    return [SelectedContact(displayName: name, phoneE164: try ContactNormalization.normalize(drafts[0].phone))]
}
