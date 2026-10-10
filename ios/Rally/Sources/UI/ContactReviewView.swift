import SwiftUI

struct ContactReviewView: View {
    let client: any RallyClient
    let eventID: String
    @Environment(\.dismiss) private var dismiss
    @State private var drafts: [ContactDraft] = []
    @State private var showPicker = false
    @State private var saving = false
    @State private var error: String?
    @State private var invitations: [CreatedInvitation] = []
    @State private var invitedName = ""
    @State private var idempotencyKey = UUID().uuidString

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
                                TextField("Phone with + country code", text: $draft.phone)
                                    .keyboardType(.phonePad)
                                    .textContentType(.telephoneNumber)
                                    .accessibilityLabel("Selected phone number, including country code")
                            }.padding(.vertical, 4)
                        }
                        .onDelete { drafts.remove(atOffsets: $0) }
                        Button { showPicker = true } label: { Label("Choose from Contacts", systemImage: "person.crop.circle.badge.plus") }
                            .disabled(!drafts.isEmpty)
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
                    Section("Waiting for them to text Rally") {
                        ForEach(invitations) { invitation in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(invitedName).font(.headline)
                                Text("JOIN \(invitation.code)").font(.body.monospaced()).textSelection(.enabled)
                                Text("Expires \(invitation.expirationDate.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if let error { Section { ErrorNotice(message: error) } }
            }
            .disabled(saving)
            .navigationTitle("Invite people")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(saving) }
            }
            .interactiveDismissDisabled(saving)
            .sheet(isPresented: $showPicker) {
                NativeContactPicker { selected in
                    drafts = [selected]
                    // CNContactPicker dismisses its own presentation. Dismissing
                    // again here can close the enclosing review sheet as well.
                } onCancel: { }
            }
        }
    }

    private func save() async {
        error = nil
        saving = true
        defer { saving = false }
        do {
            var seen: Set<String> = []
            let selected = try drafts.compactMap { draft -> SelectedContact? in
                let phone = try ContactNormalization.normalize(draft.phone)
                let name = draft.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { throw RallyClientError.validation("Give each selected person a name.") }
                guard seen.insert(phone).inserted else { return nil }
                return SelectedContact(displayName: name, phoneE164: phone)
            }
            guard selected.count == 1 else { throw RallyClientError.validation("Select one person for this invitation.") }
            let created = try await client.createInvitations(eventID: eventID, contacts: selected, idempotencyKey: idempotencyKey)
            guard created.count == 1 else {
                throw RallyClientError.unavailable("The invitation response could not be matched to this person. Check their status before trying again.")
            }
            invitedName = selected[0].displayName
            invitations = created
        } catch { self.error = error.localizedDescription }
    }
}
