import SwiftUI

struct OnboardingAndLinkPhoneView: View {
    let client: any RallyClient
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: PhoneLinkModel

    init(client: any RallyClient) {
        self.client = client
        _model = StateObject(wrappedValue: PhoneLinkModel(client: client))
    }

    var body: some View {
        NavigationStack {
            List {
                if client.mode == .demo { Section { DemoNotice() } }
                Section {
                    Image(systemName: "message.badge.waveform.fill")
                        .font(.largeTitle).foregroundStyle(RallyStyle.accent)
                        .accessibilityHidden(true)
                    Text("Connect your own phone").font(.title2.bold())
                    Text("Rally verifies a JOIN message from your phone before enabling event creation. Joining each event is a separate step.")
                        .foregroundStyle(.secondary)
                }
                if model.state == .linked {
                    Section {
                        Label(client.mode == .demo ? "Demo phone proof simulated" : "Phone verified", systemImage: "checkmark.circle")
                            .font(.headline)
                        Text("You can create events. This does not opt you into event messages.")
                    }
                } else {
                    Section(client.mode == .demo ? "Fictional test phone" : "Your phone") {
                        TextField("Phone with country code, e.g. +15555550100", text: $model.phone)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .accessibilityLabel("Phone number with country code")
                            .accessibilityIdentifier("linkPhoneNumber")
                            .disabled(model.isBusy || model.challenge != nil)
                        Text("Include + and the country code. Requesting a code sends no message.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if model.challenge == nil {
                            Button("Get verification code") { Task { await model.requestCode() } }
                                .disabled(model.isBusy)
                                .accessibilityIdentifier("requestPhoneCode")
                        }
                    }
                    if let challenge = model.challenge {
                        Section("Verify in your existing Rally conversation") {
                            Text("JOIN \(challenge.code)")
                                .font(.title2.monospaced().bold())
                                .textSelection(.enabled)
                                .accessibilityIdentifier("phoneJoinCode")
                            Text("Expires \(challenge.expirationDate.formatted(date: .omitted, time: .shortened))")
                                .font(.subheadline)
                            Text("Send this from the phone above in the Rally conversation provisioned for you. Your assigned Rally contact is not available in this app yet.")
                                .foregroundStyle(.secondary)
                            ShareLink("Share JOIN instruction", item: "JOIN \(challenge.code)")
                                .disabled(model.state == .expired)
                            Button("Check phone verification") { Task { await completeLink() } }
                                .disabled(model.isBusy || model.state == .expired)
                                .accessibilityIdentifier("checkPhoneProof")
                            Button(model.state == .expired ? "Request a new code" : "Request another code") {
                                Task { await model.requestCode(renew: true) }
                            }.disabled(model.isBusy)
                            if client.mode == .demo {
                                Button("Simulate my phone sending JOIN") { Task { await completeLink(simulate: true) } }
                                    .disabled(model.isBusy || model.state == .expired)
                                    .accessibilityIdentifier("simulatePhoneJoin")
                                Text("Simulation only. This code cannot link a real phone and no message is sent.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if model.isBusy { Section { ProgressView("Checking account…") } }
                    if let message = model.message { Section { ErrorNotice(message: message) } }
                }
                if client.mode == .live {
                    Section {
                        Text("Existing phone links cannot be restored in this build. After signing in again, verify with a new code. Your event messaging consent is checked separately.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Connect iMessage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in model.refreshExpiry() }
            .onChange(of: model.authenticationRequired) { _, required in
                if required { session.authenticationExpired() }
            }
        }
    }

    private func completeLink(simulate: Bool = false) async {
        let generation = session.identityGeneration
        if simulate { await model.simulateDemoProof() }
        else { await model.checkProof() }
        if let userID = model.verifiedUserID {
            session.phoneLinkCompleted(canonicalUserID: userID, expectedGeneration: generation)
        }
    }
}
