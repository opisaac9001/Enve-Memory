import Foundation

/// The quick choices on "Remind me", resolved on the phone in its own time zone. Same hours as the server's
/// plain-word parser (evenings 20:00, mornings 9:00, weekends Saturday 10:00).
public enum ReminderPreset: String, CaseIterable, Identifiable, Sendable {
    case tonight, tomorrow, weekend, nextWeek

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .tonight: "Tonight"
        case .tomorrow: "Tomorrow"
        case .weekend: "This weekend"
        case .nextWeek: "Next week"
        }
    }

    public func date(after now: Date = .now, calendar: Calendar = .current) -> Date {
        let hour = calendar.component(.hour, from: now)
        let weekday = calendar.component(.weekday, from: now) - 1
        switch self {
        case .tonight:
            return Self.at(now, days: hour < 20 ? 0 : 1, hour: 20, calendar)
        case .tomorrow:
            return Self.at(now, days: 1, hour: 9, calendar)
        case .weekend:
            let untilSaturday = (6 - weekday + 7) % 7
            return Self.at(now, days: untilSaturday == 0 ? (hour < 10 ? 0 : 7) : untilSaturday, hour: 10, calendar)
        case .nextWeek:
            let untilMonday = (1 - weekday + 7) % 7
            return Self.at(now, days: untilMonday == 0 ? 7 : untilMonday, hour: 9, calendar)
        }
    }

    private static func at(_ base: Date, days: Int, hour: Int, _ calendar: Calendar) -> Date {
        let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: base))!
        return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day)!
    }
}

/// `enve-memory://item/<id>`: what a reminder notification opens.
public enum ItemLink {
    public static func url(for itemID: String) -> URL {
        URL(string: "\(PairingLink.scheme)://item/\(Endpoint.percentEncoded(itemID))")!
    }

    public static func itemID(from url: URL) -> String? {
        guard url.scheme?.lowercased() == PairingLink.scheme, url.host()?.lowercased() == "item" else { return nil }
        let id = url.path(percentEncoded: false).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return id.isEmpty || id.contains("/") ? nil : id
    }
}

/// A local notification this app has already scheduled, as the notification center reports it.
public struct ScheduledReminder: Hashable, Sendable {
    public let identifier: String
    public let fireDate: Date?
    public let title: String

    public init(identifier: String, fireDate: Date?, title: String) {
        self.identifier = identifier
        self.fireDate = fireDate
        self.title = title
    }
}

public struct ReminderRequest: Hashable, Sendable {
    public let identifier: String
    public let itemID: String
    public let title: String
    public let body: String
    public let fireDate: Date
    public let url: URL
}

/// Mirrors the server's reminders into local notifications, so the phone reminds even when it can't reach the server.
/// Pure: given what the server says and what's already scheduled, decide what to add and what to remove.
public enum ReminderPlan {
    public static let identifierPrefix = "enve-memory.reminder."
    /// iOS keeps at most 64 pending notifications per app.
    public static let maxScheduled = 60

    public static func identifier(for itemID: String) -> String { identifierPrefix + itemID }

    public static func request(for item: Item, at fireDate: Date) -> ReminderRequest {
        let body = [item.type.rawValue.capitalized, item.project?.name, item.url.flatMap { URL(string: $0)?.host() }]
            .compactMap(\.self).joined(separator: " · ")
        return ReminderRequest(identifier: identifier(for: item.id), itemID: item.id, title: item.displayTitle, body: body,
                               fireDate: fireDate, url: ItemLink.url(for: item.id))
    }

    public static func requests(for items: [Item], now: Date) -> [ReminderRequest] {
        items
            .compactMap { item -> ReminderRequest? in
                guard let fireDate = item.remindAt, fireDate > now, item.archivedAt == nil else { return nil }
                return request(for: item, at: fireDate)
            }
            .sorted { $0.fireDate < $1.fireDate }
            .prefix(maxScheduled)
            .map(\.self)
    }

    /// Adding with an existing identifier replaces that notification, so a moved reminder is only an add.
    public static func diff(items: [Item], scheduled: [ScheduledReminder], now: Date) -> (add: [ReminderRequest], remove: [String]) {
        let wanted = requests(for: items, now: now)
        let ours = scheduled.filter { $0.identifier.hasPrefix(identifierPrefix) }
        let current = Dictionary(ours.map { ($0.identifier, $0) }, uniquingKeysWith: { first, _ in first })
        let add = wanted.filter { request in
            guard let existing = current[request.identifier], let fireDate = existing.fireDate else { return true }
            return abs(fireDate.timeIntervalSince(request.fireDate)) >= 1 || existing.title != request.title
        }
        let wantedIDs = Set(wanted.map(\.identifier))
        let remove = ours.map(\.identifier).filter { !wantedIDs.contains($0) }.sorted()
        return (add, remove)
    }
}

extension Item {
    public var displayTitle: String {
        if !title.isEmpty { return title }
        if let url, let host = URL(string: url)?.host() { return host }
        return body.isEmpty ? "Untitled" : String(body.prefix(80))
    }
}
