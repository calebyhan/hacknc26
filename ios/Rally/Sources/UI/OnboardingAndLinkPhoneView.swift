import SwiftUI

struct OnboardingAndLinkPhoneView: View {
    let mode: ClientMode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if mode == .demo { Section { DemoNotice() } }
                Section {
                    Image(systemName: "message.badge.waveform.fill")
                        .font(.largeTitle).foregroundStyle(RallyStyle.accent)
                        .accessibilityHidden(true)
                    Text("Your plans live in iMessage").font(.title2.bold())
                    Text("Connect your own phone so Rally can recognize your replies.")
                        .foregroundStyle(.secondary)
                }
                Section("How connecting works") {
                    Label("Get a short-lived code for your signed-in account.", systemImage: "1.circle")
                    Label("Text JOIN followed by that code to the Rally contact assigned to you.", systemImage: "2.circle")
                    Label("Rally verifies the message from your phone before linking it.", systemImage: "3.circle")
                }
                Section {
                    Label("Phone linking is not available in this build.", systemImage: "clock")
                        .font(.headline)
                    Text("A verified code and your assigned Rally contact will appear here when linking is available. No phone has been linked.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Connect iMessage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
