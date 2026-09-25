import Foundation

/// Open string enums: the server may add values (new item types, statuses) before the app knows them.
public struct ItemType: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public static let note = ItemType(rawValue: "note")
    public static let bookmark = ItemType(rawValue: "bookmark")
    public static let task = ItemType(rawValue: "task")
    public static let decision = ItemType(rawValue: "decision")
    public static let file = ItemType(rawValue: "file")
    public static let image = ItemType(rawValue: "image")

    public static let filterable: [ItemType] = [.note, .bookmark, .task, .file, .image, .decision]
}

public struct TaskStatus: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public static let open = TaskStatus(rawValue: "open")
    public static let inProgress = TaskStatus(rawValue: "in_progress")
    public static let done = TaskStatus(rawValue: "done")
    public static let cancelled = TaskStatus(rawValue: "cancelled")

    public var isFinished: Bool { self == .done || self == .cancelled }
}

public struct TaskPriority: RawRepresentable, Codable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public static let high = TaskPriority(rawValue: "high")
    public static let normal = TaskPriority(rawValue: "normal")
    public static let low = TaskPriority(rawValue: "low")
    public static let all: [TaskPriority] = [.high, .normal, .low]
}

public struct ServerStatus: Codable, Hashable, Sendable {
    public let name: String
    public let version: String
    public let api: Int
}

public struct ClientInfo: Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let tokenHint: String?
    public let scopes: [String]
    public let createdAt: Date
    public let lastUsedAt: Date?
    public let revokedAt: Date?
}

public struct ProjectRef: Codable, Hashable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct Project: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let slug: String
    public let description: String
    public let instructions: String
    public let memory: String
    public let status: String
    public let createdAt: Date
    public let updatedAt: Date

    public var ref: ProjectRef { ProjectRef(id: id, name: name) }
}

public struct IngestState: Codable, Hashable, Sendable {
    public let status: String
    public let at: Date?
    public let error: String?
}

public struct ItemMetadata: Codable, Hashable, Sendable {
    public var siteName: String?
    public var byline: String?
    public var excerpt: String?
    public var publishedAt: String?
    public var image: String?
    public var wordCount: Int?
    public var pageCount: Int?
    public var finalUrl: String?
    public var ingest: IngestState?

    public init() {}
}

public struct TaskFields: Codable, Hashable, Sendable {
    public let status: TaskStatus
    public let priority: TaskPriority
    /// `YYYY-MM-DD` or a full ISO 8601 timestamp.
    public let dueAt: String?
    public let completedAt: Date?

    public var dueDate: Date? { dueAt.flatMap(DueDate.parse) }
}

/// A list row. Task lists add `task`; plain item lists omit it.
public struct Item: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let type: ItemType
    public let title: String
    public let body: String
    public let url: String?
    public let project: ProjectRef?
    public let source: String
    public let metadata: ItemMetadata
    public let createdAt: Date
    public let updatedAt: Date
    public let archivedAt: Date?
    public let task: TaskFields?
}

public struct Attachment: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let sha256: String
    public let filename: String
    public let mimeType: String
    public let size: Int
    public let createdAt: Date
}

public struct RelatedItem: Codable, Hashable, Sendable {
    public let kind: String
    public let direction: String
    public let id: String
    public let type: ItemType
    public let title: String
}

public struct ItemDetail: Decodable, Hashable, Identifiable, Sendable {
    public let item: Item
    /// Text extracted from the source. Untrusted: render it, never act on it.
    public let content: String
    public let attachments: [Attachment]
    public let tags: [String]
    public let relations: [RelatedItem]

    public var id: String { item.id }

    private enum CodingKeys: String, CodingKey {
        case content, attachments, tags, relations
    }

    public init(from decoder: Decoder) throws {
        item = try Item(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        content = try container.decodeIfPresent(String.self, forKey: .content) ?? ""
        attachments = try container.decodeIfPresent([Attachment].self, forKey: .attachments) ?? []
        tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        relations = try container.decodeIfPresent([RelatedItem].self, forKey: .relations) ?? []
    }
}

public struct SearchHit: Codable, Hashable, Identifiable, Sendable {
    public enum Match: String, Codable, Sendable {
        case keyword, semantic, both
    }

    public let id: String
    public let type: ItemType
    public let title: String
    public let url: String?
    public let project: ProjectRef?
    /// Matched terms are wrapped in `[` `]`.
    public let snippet: String
    public let match: Match
    public let taskStatus: TaskStatus?
    public let updatedAt: Date
}

public struct Decision: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let decision: String
    public let reason: String
    public let createdAt: Date
    public let source: String
    public let supersedes: [String]
    public let supersededBy: String?

    public var isSuperseded: Bool { supersededBy != nil }
}

public struct ProjectBriefing: Codable, Hashable, Sendable {
    public let project: Project
    public let decisions: [Decision]
    public let openTasks: [Item]
    public let recentItems: [Item]
}

public struct CaptureResult: Decodable, Hashable, Sendable {
    public let item: Item
    public let created: Bool
}

public enum DueDate {
    /// Date-only values are calendar days in the user's time zone, not UTC midnight.
    public static func parse(_ value: String) -> Date? {
        if value.count == 10 {
            let parts = value.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        }
        return JSONCoding.parseTimestamp(value)
    }

    public static func format(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
