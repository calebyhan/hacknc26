import SwiftUI

struct OnboardingAndLinkPhoneView: View {
    let client: any RallyClient
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: PhoneLinkModel
    @State private var route: RallyRoute = .unavailable
    @State private var routeError: String?
    @State private var retry = 0

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
                if model.state == .linked || session.phoneVerifiedForSession {
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
                            Text("Send this from the phone above in the Rally conversation provisioned for you. A contact shortcut becomes available after phone verification when Rally has a verified destination.")
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
                Section("Your Rally conversation") {
                    RallyRouteView(route: route, mode: client.mode,
                                   isStale: client.mode == .live && session.connection.isStale)
                    if let routeError {
                        ErrorNotice(message: routeError)
                        Button("Retry contact status") { retry += 1 }
                    }
                }
            }
            .navigationTitle("Connect iMessage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: "\(retry):\(session.identityGeneration)") { await subscribeRoute() }
            .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in model.refreshExpiry() }
            .onChange(of: model.authenticationRequired) { _, required in
                if required { session.authenticationExpired() }
            }
        }
    }

    private func subscribeRoute() async {
        route = .unavailable
        routeError = nil
        let generation = session.identityGeneration
        let query = retry
        do {
            for try await received in client.rallyRoute() {
                guard !Task.isCancelled, generation == session.identityGeneration, query == retry else { return }
                route = received
            }
            guard !Task.isCancelled, generation == session.identityGeneration, query == retry else { return }
            route = .unavailable
            routeError = "Contact updates ended. Retry to load your current Rally contact."
        } catch {
            guard !Task.isCancelled, generation == session.identityGeneration, query == retry else { return }
            route = .unavailable
            routeError = error.localizedDescription
            if error as? RallyClientError == .authenticationRequired { session.authenticationExpired() }
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
