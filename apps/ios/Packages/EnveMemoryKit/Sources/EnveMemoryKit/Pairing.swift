import Foundation

/// What the phone keeps after pairing. Stored whole in the Keychain.
public struct Pairing: Codable, Hashable, Sendable {
    public var baseURL: URL
    public var token: String
    public var clientName: String
    public var serverVersion: String?
    public var pairedAt: Date

    public init(baseURL: URL, token: String, clientName: String, serverVersion: String? = nil, pairedAt: Date = .now) {
        self.baseURL = baseURL
        self.token = token
        self.clientName = clientName
        self.serverVersion = serverVersion
        self.pairedAt = pairedAt
    }
}

/// `enve-memory://pair?url=<base>&token=em_…&name=<device>`, as printed by `petty-memory clients pair`.
public struct PairingLink: Hashable, Sendable {
    public let baseURL: URL
    public let token: String
    public let name: String?

    public init(baseURL: URL, token: String, name: String?) {
        self.baseURL = baseURL
        self.token = token
        self.name = name
    }

    public enum ParseError: Error, Hashable, Sendable, LocalizedError {
        case notAPairingLink
        case missingURL
        case invalidURL
        case missingToken
        case invalidToken

        public var errorDescription: String? {
            switch self {
            case .notAPairingLink: "That isn't a Petty Memory pairing link. It should start with enve-memory://pair."
            case .missingURL: "The pairing link has no server address."
            case .invalidURL: "The server address in the pairing link must be an http:// or https:// URL."
            case .missingToken: "The pairing link has no token."
            case .invalidToken: "The token must start with em_. Create a new link with `petty-memory clients pair`."
            }
        }
    }

    public static let scheme = "enve-memory"

    public init(parsing raw: String) throws(ParseError) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: text),
              components.scheme?.lowercased() == Self.scheme,
              components.host?.lowercased() == "pair"
        else { throw .notAPairingLink }

        let params = Self.formValues(components.percentEncodedQuery ?? "")
        guard let rawURL = params["url"], !rawURL.isEmpty else { throw .missingURL }
        guard let baseURL = Self.serverURL(rawURL) else { throw .invalidURL }
        guard let token = params["token"], !token.isEmpty else { throw .missingToken }
        guard Self.isToken(token) else { throw .invalidToken }
        let name = params["name"].flatMap { $0.isEmpty ? nil : $0 }
        self.init(baseURL: baseURL, token: token, name: name)
    }

    public init(url: URL) throws(ParseError) {
        try self.init(parsing: url.absoluteString)
    }

    /// Normalizes a user-typed or linked server address: http(s) only, host required, no trailing slash.
    public static func serverURL(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard let components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty,
              components.query == nil, components.fragment == nil
        else { return nil }
        return components.url
    }

    public static func isToken(_ value: String) -> Bool {
        value.hasPrefix("em_") && value.count > 3 && !value.contains(where: \.isWhitespace)
    }

    /// `application/x-www-form-urlencoded` decoding, which the CLI's `URLSearchParams` produces (`+` is a space).
    static func formValues(_ query: String) -> [String: String] {
        var values: [String: String] = [:]
        for pair in query.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let decode = { (s: Substring) in String(s).replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? String(s) }
            guard let key = parts.first.map(decode), values[key] == nil else { continue }
            values[key] = parts.count > 1 ? decode(parts[1]) : ""
        }
        return values
    }
}
