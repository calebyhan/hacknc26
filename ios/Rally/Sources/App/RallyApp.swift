import SwiftUI

@main
struct RallyApp: App {
    @StateObject private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            AuthGate()
                .environmentObject(session)
                .tint(RallyStyle.accent)
        }
    }
}

struct AuthGate: View {
    @EnvironmentObject private var session: AppSession

    var body: some View {
        if let client = session.client {
            EventListView(client: client)
        } else {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        Image(systemName: "person.3.sequence.fill")
                            .font(.system(size: 54))
                            .foregroundStyle(RallyStyle.accent)
                            .accessibilityHidden(true)
                            .padding(.top, 48)
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Good plans.\nPeople together.")
                                .font(.largeTitle.bold())
                            Text("Set things up here. Keep things moving in iMessage.")
                                .font(.title3)
                                .foregroundStyle(.secondary)
                        }
                        VStack(alignment: .leading, spacing: 20) {
                            IntroRow(icon: "calendar", title: "Make a plan", detail: "Create an event and choose who to invite.")
                            IntroRow(icon: "hand.raised", title: "Everyone gets a say", detail: "An invitation is a request. People join and accept for themselves.")
                            IntroRow(icon: "checkmark.circle", title: "See what’s confirmed", detail: "Check assignments and see who Rally is waiting for.")
                        }
                        VStack(spacing: 12) {
                            Button {
                                Task { await session.signIn() }
                            } label: {
                                HStack {
                                    if session.isSigningIn { ProgressView() }
                                    Text("Sign in").frame(maxWidth: .infinity)
                                }.padding(.vertical, 8)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!session.liveConfigured || session.isSigningIn)
                            if !session.liveConfigured {
                                Text("Live sign-in isn’t configured for this build.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Button("Explore demo") { session.enterDemo() }
                                .buttonStyle(.bordered)
                                .accessibilityIdentifier("exploreDemo")
                            Text("Demo uses fictional people and local data. No messages are sent.")
                                .font(.footnote).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                            if let error = session.error { ErrorNotice(message: error) }
                        }
                    }.padding(24)
                }
                .navigationTitle("Rally")
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }
}

private struct IntroRow: View {
    let icon: String
    let title: String
    let detail: String
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon).font(.title2).frame(width: 30).foregroundStyle(RallyStyle.accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).foregroundStyle(.secondary)
            }
        }.accessibilityElement(children: .combine)
    }
}
