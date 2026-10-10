import Foundation

/// Validates the public app configuration before the Auth0 SDK can read its plist.
struct LiveConfiguration: Sendable {
    let deploymentURL: String
    let auth0Domain: String
    let auth0ClientID: String

    init?(deploymentURL: String, auth0Domain: String, auth0ClientID: String) {
        let deploymentURL = deploymentURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let domain = auth0Domain.trimmingCharacters(in: .whitespacesAndNewlines)
        let clientID = auth0ClientID.trimmingCharacters(in: .whitespacesAndNewlines)
        let values = [deploymentURL, domain, clientID]
        guard values.allSatisfy({ !$0.isEmpty && !$0.contains("$(") && !$0.contains("YOUR_") }),
              let deployment = URLComponents(string: deploymentURL),
              deployment.scheme == "https",
              let host = deployment.host, !host.isEmpty,
              deployment.user == nil, deployment.password == nil,
              deployment.query == nil, deployment.fragment == nil,
              deployment.path.isEmpty || deployment.path == "/",
              domain.range(of: #"^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$"#,
                           options: .regularExpression) != nil,
              !clientID.contains(where: \.isWhitespace)
        else { return nil }
        self.deploymentURL = deploymentURL
        self.auth0Domain = domain
        self.auth0ClientID = clientID
    }

    static func load(bundle: Bundle = .main) -> LiveConfiguration? {
        guard let deploymentURL = bundle.object(forInfoDictionaryKey: "RallyConvexDeploymentURL") as? String,
              let authURL = bundle.url(forResource: "Auth0", withExtension: "plist"),
              let data = try? Data(contentsOf: authURL),
              let auth = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String],
              let domain = auth["Domain"], let clientID = auth["ClientId"]
        else { return nil }
        return LiveConfiguration(deploymentURL: deploymentURL, auth0Domain: domain, auth0ClientID: clientID)
    }
}

enum LiveConnectionState: Equatable, Sendable {
    case inactive
    case connecting
    case connected

    var isStale: Bool { self != .connected }

    var statusText: String {
        switch self {
        case .inactive: "Live connection inactive"
        case .connecting: "Reconnecting · displayed data may be stale"
        case .connected: "Connected to backend"
        }
    }
}
