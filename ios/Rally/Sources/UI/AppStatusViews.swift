import SwiftUI

extension TaskProgress {
    var summary: String {
        var parts = ["\(confirmed) confirmed", "\(needsCoverage) need coverage", "\(completed) completed"]
        if canceled > 0 { parts.append("\(canceled) canceled") }
        return total == 0 ? "No tasks yet" : parts.joined(separator: " · ")
    }
}

extension EventMessagingStatus {
    var statusTitle: String {
        guard membershipState == .enrolled, messagingState != .unknown else { return "Messaging status unavailable" }
        if !consentRecorded { return "Join this event to enable messages" }
        switch messagingState {
        case .stopped: return "Messages stopped"
        case .paused: return "Messages paused"
        case .active:
            if canReceiveMessages && notificationsEnabled { return "Event messages enabled" }
            return notificationsEnabled ? "Messaging status unavailable" : "Event notifications disabled"
        case .unknown: return "Messaging status unavailable"
        }
    }
}

extension RallyRoute {
    /// Apple's documented sms:<phone> form opens composition, without message
    /// text or an automatic send. Reject every value outside strict E.164.
    func messagesURL(at now: Date = Date()) -> URL? {
        guard case .available(let destination, let expiresAt) = self,
              expiresAt.isFinite, expiresAt > now.timeIntervalSince1970 * 1_000,
              destination.range(of: #"\A\+[1-9][0-9]{7,14}\z"#, options: .regularExpression) != nil else { return nil }
        return URL(string: "sms:\(destination)")
    }
}

extension OutboundState {
    var deliveryTitle: String {
        switch self {
        case .queued: "Queued"
        case .sending: "Sending"
        case .sent: "Sent to messaging service"
        case .delivered: "Delivered"
        case .failed: "Delivery failed"
        case .unknown: "Delivery outcome unknown"
        }
    }
}

struct RallyRouteView: View {
    let route: RallyRoute
    let mode: ClientMode
    var isStale = false
    @Environment(\.openURL) private var openURL
    @State private var cannotOpen = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            routeContent(at: context.date)
        }
    }

    private func routeContent(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if route.messagesURL(at: now) != nil {
                Button("Open Messages to Rally", systemImage: "message") {
                    guard let currentURL = route.messagesURL(), !isStale else { return }
                    openURL(currentURL) { accepted in cannotOpen = !accepted }
                }
                .disabled(mode == .demo || isStale)
                .accessibilityIdentifier("openRallyMessages")
                if mode == .demo {
                    Text("Fictional route. Opening Messages is disabled in demo.")
                        .font(.caption).foregroundStyle(.secondary)
                } else if isStale {
                    Text("Reconnect to refresh your Rally contact.").font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Opens your verified Rally contact. You choose what to send.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if cannotOpen { ErrorNotice(message: "Messages could not be opened on this device.") }
            } else {
                Text("Rally contact unavailable")
                    .font(.subheadline).accessibilityIdentifier("rallyRouteUnavailable")
                Text("Use your existing provisioned Rally conversation. A shortcut appears when its destination is verified.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct EventActivityView: View {
    let entries: [ActivityEntry]

    var body: some View {
        if entries.isEmpty {
            Text("No activity recorded yet.").foregroundStyle(.secondary)
        } else {
            ForEach(entries, id: \.id) { entry in
                VStack(alignment: .leading, spacing: 5) {
                    Text(entry.title).font(.subheadline)
                    if let state = entry.deliveryState {
                        Label(state.deliveryTitle, systemImage: state == .delivered ? "checkmark.message" : "message")
                            .font(.caption)
                    }
                    Text(Date(timeIntervalSince1970: entry.at / 1_000), format: .dateTime.month().day().hour().minute())
                        .font(.caption).foregroundStyle(.secondary)
                }.accessibilityElement(children: .combine)
            }
            if entries.contains(where: { $0.deliveryState != nil }) {
                Text("Sent means accepted by the messaging service. Delivered requires a receipt. Only messages addressed to you appear here.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
