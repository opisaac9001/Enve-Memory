import Foundation

public struct APIErrorCode: RawRepresentable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let unauthorized = APIErrorCode(rawValue: "unauthorized")
    public static let insufficientScope = APIErrorCode(rawValue: "insufficient_scope")
    public static let forbiddenHost = APIErrorCode(rawValue: "forbidden_host")
    public static let forbiddenOrigin = APIErrorCode(rawValue: "forbidden_origin")
    public static let notFound = APIErrorCode(rawValue: "not_found")
    public static let invalid = APIErrorCode(rawValue: "invalid")
    public static let invalidJSON = APIErrorCode(rawValue: "invalid_json")
    public static let conflict = APIErrorCode(rawValue: "conflict")
    public static let tooLarge = APIErrorCode(rawValue: "too_large")
    public static let `internal` = APIErrorCode(rawValue: "internal")
}

public enum APIError: Error, Hashable, Sendable {
    /// No HTTP response: server down, wrong network, timeout.
    case unreachable(URLError.Code)
    /// The server answered with `{error:{code,message}}`.
    case server(status: Int, code: APIErrorCode, message: String)
    /// A non-2xx response without the API's error envelope (a proxy, or not an Enve Memory server).
    case unexpectedResponse(status: Int)
    case decoding(String)

    /// Worth retrying later without the user changing anything.
    public var isRetryable: Bool {
        switch self {
        case .unreachable: true
        case .server(let status, let code, _): status >= 500 || status == 408 || status == 429 || code == .unauthorized
        case .unexpectedResponse(let status): status >= 500 || status == 408 || status == 429
        case .decoding: false
        }
    }

    public var code: APIErrorCode? {
        if case .server(_, let code, _) = self { code } else { nil }
    }

    public var isUnauthorized: Bool { code == .unauthorized }
}

extension APIError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .unreachable(.timedOut):
            "Your Enve Memory server didn't answer in time."
        case .unreachable:
            "Can't reach your Enve Memory server. Make sure it's running and you're on the same network or Tailscale."
        case .server(_, .forbiddenHost, _):
            "The server only accepts local connections. Start it with `enve-memory serve --lan`."
        case .server(_, .unauthorized, _):
            "This phone's pairing is no longer valid. Pair again from your computer."
        case .server(_, _, let message):
            message
        case .unexpectedResponse(let status):
            "The server answered with HTTP \(status). Is this an Enve Memory server?"
        case .decoding:
            "The server sent a response this version of the app doesn't understand."
        }
    }
}

struct ErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
    }
    let error: Body
}
