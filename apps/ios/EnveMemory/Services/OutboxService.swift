import EnveMemoryKit
import Foundation
import Observation

/// Sends writes, parking them in the shared outbox when the server can't be reached.
@Observable
final class OutboxService {
    enum Outcome {
        case sent(Data)
        case queued(OutboxEntry)
        case failed(Error)
    }

    private(set) var entries: [OutboxEntry] = []
    private(set) var isFlushing = false

    private let outbox: Outbox
    private let connection: Connection

    init(connection: Connection, outbox: Outbox = Outbox()) {
        self.connection = connection
        self.outbox = outbox
    }

    var pendingCount: Int { entries.count }

    func reload() async {
        entries = await outbox.entries()
    }

    /// `refresh: false` for signals (like "opened") that shouldn't make screens reload.
    func submit(_ endpoint: Endpoint, kind: OutboxEntry.Kind, title: String, file: URL? = nil, refresh: Bool = true) async -> Outcome {
        if let client = connection.client {
            do {
                let data = try await client.data(for: endpoint, uploadingFile: file)
                if refresh { connection.didWrite() }
                return .sent(data)
            } catch let error as APIError where error.isRetryable {
                connection.note(error)
            } catch {
                return .failed(error)
            }
        }
        do {
            let entry = try await outbox.enqueue(endpoint, kind: kind, title: title, attachment: file)
            await reload()
            return .queued(entry)
        } catch {
            return .failed(error)
        }
    }

    @discardableResult
    func flush(ignoringBackoff: Bool) async -> FlushReport? {
        await reload()
        guard let client = connection.client, !entries.isEmpty else { return nil }
        isFlushing = true
        let report = await outbox.flush(using: client, ignoringBackoff: ignoringBackoff)
        isFlushing = false
        await reload()
        if report.sent > 0 {
            connection.didWrite()
            if !connection.isOnline { await connection.refresh() }
        }
        return report
    }

    func retry(_ entry: OutboxEntry) async {
        await outbox.retry(entry.id)
        await flush(ignoringBackoff: true)
    }

    func remove(_ entry: OutboxEntry) async {
        await outbox.remove(entry.id)
        await reload()
    }
}
