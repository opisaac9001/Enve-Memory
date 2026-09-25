import EnveMemoryKit
import Foundation
import Observation

/// The paired server: credentials, reachability, and a revision screens watch to reload after writes.
@Observable
final class Connection {
    enum Status: Equatable {
        case unknown
        case checking
        case online(ServerStatus, ClientInfo)
        case offline(String)
        case unauthorized
    }

    private(set) var pairing: Pairing?
    private(set) var status: Status = .unknown
    private(set) var revision = 0

    private let store: CredentialStore
    let session: URLSession

    init(store: CredentialStore = KeychainCredentialStore()) {
        self.store = store
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
        pairing = try? store.load()
    }

    var client: APIClient? {
        pairing.map { APIClient(pairing: $0, session: session) }
    }

    var isOnline: Bool {
        if case .online = status { true } else { false }
    }

    func refresh() async {
        guard let client else { return }
        if case .unknown = status { status = .checking }
        do {
            async let server = client.status()
            async let me = client.whoami()
            status = .online(try await server, try await me)
        } catch let error as APIError where error.isUnauthorized {
            status = .unauthorized
        } catch is CancellationError {
            return
        } catch {
            status = .offline(error.localizedDescription)
        }
    }

    /// Checks the server and token before anything is stored.
    func verify(baseURL: URL, token: String) async throws -> Pairing {
        let client = APIClient(baseURL: baseURL, token: token, session: session)
        let server = try await client.status()
        guard server.name == "enve-memory" else { throw APIError.unexpectedResponse(status: 200) }
        let me = try await client.whoami()
        return Pairing(baseURL: baseURL, token: token, clientName: me.name, serverVersion: server.version)
    }

    func adopt(_ pairing: Pairing) throws {
        try store.save(pairing)
        forgetServerCaches()
        self.pairing = pairing
        status = .unknown
        revision += 1
    }

    func unpair() throws {
        try store.delete()
        forgetServerCaches()
        pairing = nil
        status = .unknown
    }

    /// Lets any failed call update the status line without waiting for the next check.
    func note(_ error: Error) {
        guard let error = error as? APIError else { return }
        if error.isUnauthorized {
            status = .unauthorized
        } else if case .unreachable = error {
            status = .offline(error.localizedDescription)
        }
    }

    /// Project ids belong to one library; after re-pairing, the share sheet mustn't offer the old ones.
    private func forgetServerCaches() {
        let settings = SharedSettings()
        settings.cachedProjects = []
        settings.lastProjectID = nil
    }

    func didWrite() {
        revision += 1
    }
}
