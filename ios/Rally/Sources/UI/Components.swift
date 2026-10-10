import SwiftUI

enum RallyStyle {
    static let accent = Color(red: 0.72, green: 0.25, blue: 0.13)
}

struct DemoNotice: View {
    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text("Demo · local data").font(.subheadline.bold())
                Text("Local data. No messages are sent.").font(.caption)
            }
        } icon: {
            Image(systemName: "testtube.2")
        }
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}

struct StatusBadge: View {
    let status: DisplayStatus
    var body: some View {
        Label(status.title, systemImage: status.systemImage)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct ErrorNotice: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.subheadline)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
    }
}

func eventDate(_ milliseconds: Double, timezone: String) -> String {
    let formatter = DateFormatter()
    formatter.timeZone = TimeZone(identifier: timezone) ?? .gmt
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
}

func displayTime(_ milliseconds: Double, timezone: String) -> String {
    let formatter = DateFormatter()
    formatter.timeZone = TimeZone(identifier: timezone) ?? .gmt
    formatter.timeStyle = .short
    return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
}
