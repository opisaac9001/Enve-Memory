import Foundation

public struct OutboxEntry: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case note, link, task, file
    }

    public let id: UUID
    public let createdAt: Date
    public let kind: Kind
    public let title: String
    public let endpoint: Endpoint
    /// Sent as `Idempotency-Key` on every attempt, so the server applies the write once however often it's retried.
    public let idempotencyKey: String
    /// File name of the upload body inside the outbox directory.
    public let attachment: String?
    public var attempts: Int
    public var nextAttemptAt: Date
    public var lastError: String?
    /// The server rejected it; only an explicit retry sends it again.
    public var needsAttention: Bool
}

public struct FlushReport: Hashable, Sendable {
    public var sent = 0
    public var failed = 0
    public var remaining = 0
}

/// Captures that couldn't reach the server. One JSON file per entry (plus its upload body) in the
/// App Group container, so the share extension can enqueue while the app owns flushing.
public actor Outbox {
    public nonisolated let directory: URL
    private let now: @Sendable () -> Date
    private var isFlushing = false

    public init(directory: URL = AppGroup.outboxDirectory, now: @escaping @Sendable () -> Date = { .now }) {
        self.directory = directory
        self.now = now
    }

    /// Moves `attachment` (if any) into the outbox, so the caller's copy may be temporary. Keeps the endpoint's
    /// idempotency key when it has one: a direct attempt whose response was lost must retry under the same key.
    @discardableResult
    public func enqueue(_ endpoint: Endpoint, kind: OutboxEntry.Kind, title: String, attachment: URL? = nil) throws -> OutboxEntry {
        var endpoint = endpoint
        let key = endpoint.idempotencyKey ?? Endpoint.newKey()
        endpoint.headers[Endpoint.idempotencyHeader] = key
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let id = UUID()
        var attachmentName: String?
        if let attachment {
            let name = "\(id.uuidString).upload"
            try FileManager.default.moveItem(at: attachment, to: directory.appending(path: name))
            attachmentName = name
        }
        // Strictly increasing (at the millisecond precision we persist) so a multi-file share keeps its order.
        let createdAt = max(now(), (entries().last?.createdAt ?? .distantPast).addingTimeInterval(0.001))
        let entry = OutboxEntry(id: id, createdAt: createdAt, kind: kind, title: title, endpoint: endpoint, idempotencyKey: key, attachment: attachmentName,
                                attempts: 0, nextAttemptAt: now(), lastError: nil, needsAttention: false)
        try write(entry)
        return entry
    }

    public func entries() -> [OutboxEntry] {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let decoder = JSONCoding.makeDecoder()
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(OutboxEntry.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt < $1.createdAt }
    }

    /// Sends due entries oldest first. Concurrent calls collapse into the one already running.
    public func flush(using client: APIClient, ignoringBackoff: Bool = false) async -> FlushReport {
        guard !isFlushing else { return FlushReport(remaining: entries().count) }
        isFlushing = true
        defer { isFlushing = false }

        var report = FlushReport()
        for var entry in entries() where !entry.needsAttention && (ignoringBackoff || entry.nextAttemptAt <= now()) {
            guard exists(entry.id) else { continue }
            let upload = entry.attachment.map { directory.appending(path: $0) }
            if let upload, !FileManager.default.fileExists(atPath: upload.path) {
                entry.needsAttention = true
                entry.lastError = "The file to upload is missing."
                try? write(entry)
                report.failed += 1
                continue
            }
            do {
                _ = try await client.data(for: entry.endpoint, uploadingFile: upload)
                remove(entry.id)
                report.sent += 1
            } catch is CancellationError {
                break
            } catch {
                guard exists(entry.id) else { continue }
                let apiError = error as? APIError
                entry.attempts += 1
                entry.lastError = error.localizedDescription
                if apiError?.isRetryable ?? false {
                    entry.nextAttemptAt = now().addingTimeInterval(Self.backoff(afterAttempts: entry.attempts))
                } else {
                    entry.needsAttention = true
                    report.failed += 1
                }
                try? write(entry)
                if case .unreachable = apiError { break }
            }
        }
        report.remaining = entries().count
        return report
    }

    public func retry(_ id: UUID) {
        guard var entry = entries().first(where: { $0.id == id }) else { return }
        entry.needsAttention = false
        entry.nextAttemptAt = now()
        try? write(entry)
    }

    public func remove(_ id: UUID) {
        let fm = FileManager.default
        try? fm.removeItem(at: entryURL(id))
        try? fm.removeItem(at: directory.appending(path: "\(id.uuidString).upload"))
    }

    /// 30 s, 1 min, 2 min … capped at an hour.
    public static func backoff(afterAttempts attempts: Int) -> TimeInterval {
        min(30 * pow(2, Double(max(attempts, 1) - 1)), 3600)
    }

    private func exists(_ id: UUID) -> Bool {
        FileManager.default.fileExists(atPath: entryURL(id).path)
    }

    private func entryURL(_ id: UUID) -> URL {
        directory.appending(path: "\(id.uuidString).json")
    }

    private func write(_ entry: OutboxEntry) throws {
        try JSONCoding.makeEncoder().encode(entry).write(to: entryURL(entry.id), options: .atomic)
    }
}
