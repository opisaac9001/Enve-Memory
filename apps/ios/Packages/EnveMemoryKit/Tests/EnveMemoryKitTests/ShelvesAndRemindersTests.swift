import Foundation
import Testing
@testable import EnveMemoryKit

@Suite struct ShelfDecodingTests {
    func decode<T: Decodable>(_ type: T.Type, _ fixture: String) throws -> T {
        try JSONCoding.makeDecoder().decode(T.self, from: Fixture.data(fixture))
    }

    @Test func pinnedShelfCarriesPinTagsAndReminder() throws {
        let items = try decode([Item].self, "shelf-pinned")
        #expect(items.allSatisfy { $0.isPinned })
        let note = try #require(items.first { $0.title == "12 V rail sag" })
        #expect(note.tags == ["power"])
        #expect(note.intent == nil)
        let link = try #require(items.first { $0.title == "ESP32 UART timing deep dive" })
        #expect(link.intent == .read)
        #expect(link.remindAt != nil)
        #expect(link.metadata.intentAuto == false)
    }

    @Test func guessedIntentIsFlagged() throws {
        let video = try #require(try decode([Item].self, "shelf-watch").first)
        #expect(video.intent == .watch)
        #expect(video.metadata.intentAuto == true)
    }

    @Test func remindersComeSoonestFirst() throws {
        let reminders = try decode([Item].self, "reminders")
        let dates = reminders.compactMap(\.remindAt)
        #expect(dates.count == reminders.count)
        #expect(dates == dates.sorted())
    }

    @Test func emptyShelf() throws {
        #expect(try decode([Item].self, "shelf-unopened").isEmpty)
    }

    @Test func aiSuggestions() throws {
        let detail = try decode(ItemDetail.self, "item-detail-ai")
        let ai = try #require(detail.item.metadata.ai)
        #expect(ai.isReady)
        #expect(ai.isPending)
        #expect(ai.tags == ["photo-eye", "safety"])
        #expect(ai.project?.name == "Garage")
        #expect(ai.summary?.isEmpty == false)
    }

    @Test func searchPreview() throws {
        let hit = try #require(try decode([SearchHit].self, "search-preview").first)
        #expect(hit.preview == "Photo eye alignment: both LEDs solid means aligned.")
    }

    @Test func captureWithIntentReminderAndPin() throws {
        let result = try decode(CaptureResult.self, "capture-shelves")
        #expect(result.item.intent == .read)
        #expect(result.item.isPinned)
        #expect(result.item.remindAt == JSONCoding.parseTimestamp("2026-10-02T16:00:00.000Z"))
    }

    @Test func olderPayloadsWithoutTheNewFieldsStillDecode() throws {
        let items = try decode([Item].self, "items")
        #expect(items.allSatisfy { $0.tags.isEmpty && $0.intent == nil && !$0.isPinned && $0.remindAt == nil })
        #expect(try decode([SearchHit].self, "search").allSatisfy { $0.preview == nil })
    }
}

@Suite struct ShelfRequestTests {
    let client = APIClient(baseURL: URL(string: "http://h:1")!, token: nil)

    func query(_ endpoint: Endpoint) -> String? { client.urlRequest(for: endpoint).url?.query(percentEncoded: true) }

    @Test func shelfQueries() {
        #expect(query(.items(ItemFilter(limit: 200, shelf: .pinned))) == "limit=200&pinned=true")
        #expect(query(.items(ItemFilter(shelf: .intent(.buy)))) == "intent=buy")
        #expect(query(.items(ItemFilter(shelf: .unopened(days: 30)))) == "unopened=30")
        #expect(query(.items(ItemFilter(shelf: .reminders))) == "reminders=true")
        #expect(Set(Shelf.all.map(\.id)).count == 7)
    }

    @Test func remindersEndpoint() {
        #expect(client.urlRequest(for: .reminders()).url?.path() == "/api/v1/reminders")
        #expect(query(.reminders(dueOnly: true, limit: 5)) == "due=true&limit=5")
    }

    @Test func organizingWrites() throws {
        func json(_ e: Endpoint) throws -> String { String(decoding: try #require(e.body), as: UTF8.self) }
        let pin = try Endpoint.pin("i1", false)
        #expect(pin.method == "POST" && pin.path == "/items/i1/pin")
        #expect(try json(pin) == #"{"pinned":false}"#)

        let at = try #require(JSONCoding.parseTimestamp("2026-10-02T16:00:00.000Z"))
        let remind = try Endpoint.setReminder("i1", at: at)
        #expect(remind.method == "PUT" && remind.path == "/items/i1/reminder")
        #expect(try json(remind) == #"{"at":"2026-10-02T16:00:00.000Z"}"#)
        #expect(try json(.setReminder("i1", at: nil)) == "{}")

        #expect(try json(.setIntent("i1", .watch)) == #"{"intent":"watch"}"#)
        #expect(try json(.setIntent("i1", nil)) == "{}")
        #expect(Endpoint.acceptSuggestions("i1").path == "/items/i1/accept")
        #expect(Endpoint.opened("i1").path == "/items/i1/opened")
        #expect([pin, remind, .acceptSuggestions("i1"), .opened("i1")].allSatisfy { $0.idempotencyKey != nil })
    }

    @Test func captureCarriesIntentReminderAndPin() throws {
        let at = try #require(JSONCoding.parseTimestamp("2026-10-02T16:00:00Z"))
        let endpoint = try Endpoint.capture(CaptureRequest(url: "https://e.com", intent: .buy, remind: at, pinned: true))
        let body = String(decoding: try #require(endpoint.body), as: UTF8.self)
        #expect(body == #"{"intent":"buy","pinned":true,"remind":"2026-10-02T16:00:00.000Z","url":"https:\/\/e.com"}"#)
    }
}

@Suite struct ReminderPresetTests {
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return c
    }

    func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    // 2026-09-24 is a Thursday.
    @Test func tonightIsEightPMOrTomorrowEvening() {
        #expect(ReminderPreset.tonight.date(after: date(2026, 9, 24, 15), calendar: calendar) == date(2026, 9, 24, 20))
        #expect(ReminderPreset.tonight.date(after: date(2026, 9, 24, 21), calendar: calendar) == date(2026, 9, 25, 20))
    }

    @Test func tomorrowMorning() {
        #expect(ReminderPreset.tomorrow.date(after: date(2026, 9, 24, 23, 30), calendar: calendar) == date(2026, 9, 25, 9))
    }

    @Test func weekendIsSaturdayTenAM() {
        #expect(ReminderPreset.weekend.date(after: date(2026, 9, 24, 12), calendar: calendar) == date(2026, 9, 26, 10))
        #expect(ReminderPreset.weekend.date(after: date(2026, 9, 26, 8), calendar: calendar) == date(2026, 9, 26, 10))
        #expect(ReminderPreset.weekend.date(after: date(2026, 9, 26, 11), calendar: calendar) == date(2026, 10, 3, 10))
    }

    @Test func nextWeekIsMondayMorning() {
        #expect(ReminderPreset.nextWeek.date(after: date(2026, 9, 24, 12), calendar: calendar) == date(2026, 9, 28, 9))
        #expect(ReminderPreset.nextWeek.date(after: date(2026, 9, 28, 8), calendar: calendar) == date(2026, 10, 5, 9))
    }

    @Test func crossesDaylightSavingCleanly() {
        // US clocks fall back on 2026-11-01.
        #expect(ReminderPreset.tomorrow.date(after: date(2026, 10, 31, 22), calendar: calendar) == date(2026, 11, 1, 9))
    }
}

@Suite struct ReminderPlanTests {
    let now = JSONCoding.parseTimestamp("2026-09-25T12:00:00Z")!

    func item(_ id: String, remind: String?, title: String = "Item", archived: Bool = false) throws -> Item {
        var object: [String: Any] = [
            "id": id, "type": "bookmark", "title": title, "body": "", "url": "https://example.com/\(id)",
            "project": ["id": "p", "name": "Garage"], "source": "cli", "metadata": [:],
            "createdAt": "2026-09-20T00:00:00Z", "updatedAt": "2026-09-20T00:00:00Z",
        ]
        object["remindAt"] = remind ?? NSNull()
        object["archivedAt"] = archived ? "2026-09-21T00:00:00Z" : NSNull()
        return try JSONCoding.makeDecoder().decode(Item.self, from: JSONSerialization.data(withJSONObject: object))
    }

    func scheduled(_ id: String, _ at: String, title: String = "Item") -> ScheduledReminder {
        ScheduledReminder(identifier: ReminderPlan.identifier(for: id), fireDate: JSONCoding.parseTimestamp(at), title: title)
    }

    @Test func schedulesFutureRemindersOnly() throws {
        let items = [
            try item("future", remind: "2026-09-26T09:00:00Z"),
            try item("past", remind: "2026-09-24T09:00:00Z"),
            try item("none", remind: nil),
            try item("archived", remind: "2026-09-27T09:00:00Z", archived: true),
        ]
        let plan = ReminderPlan.diff(items: items, scheduled: [], now: now)
        #expect(plan.add.map(\.itemID) == ["future"])
        #expect(plan.remove.isEmpty)
        let request = plan.add[0]
        #expect(request.identifier == "enve-memory.reminder.future")
        #expect(request.url.absoluteString == "enve-memory://item/future")
        #expect(request.body == "Bookmark · Garage · example.com")
    }

    @Test func unchangedRemindersAreLeftAlone() throws {
        let plan = ReminderPlan.diff(items: [try item("a", remind: "2026-09-26T09:00:00Z")],
                                     scheduled: [scheduled("a", "2026-09-26T09:00:00Z")], now: now)
        #expect(plan.add.isEmpty && plan.remove.isEmpty)
    }

    @Test func movedOrRenamedRemindersAreReplaced() throws {
        let plan = ReminderPlan.diff(
            items: [try item("moved", remind: "2026-09-27T09:00:00Z"), try item("renamed", remind: "2026-09-26T09:00:00Z", title: "New")],
            scheduled: [scheduled("moved", "2026-09-26T09:00:00Z"), scheduled("renamed", "2026-09-26T09:00:00Z", title: "Old")],
            now: now)
        #expect(Set(plan.add.map(\.itemID)) == ["moved", "renamed"])
        #expect(plan.remove.isEmpty)
    }

    @Test func clearedRemindersAreCancelledButOtherNotificationsAreNot() throws {
        let plan = ReminderPlan.diff(
            items: [try item("kept", remind: "2026-09-26T09:00:00Z")],
            scheduled: [scheduled("kept", "2026-09-26T09:00:00Z"), scheduled("cleared", "2026-09-26T09:00:00Z"),
                        ScheduledReminder(identifier: "someone-else", fireDate: nil, title: "x")],
            now: now)
        #expect(plan.add.isEmpty)
        #expect(plan.remove == ["enve-memory.reminder.cleared"])
    }

    @Test func provisionalRemindersStayWhileTheirEntryWaits() throws {
        let waiting = UUID()
        let sent = UUID()
        let provisional = [
            ReminderPlan.pendingRequest(entryID: waiting, title: "Queued", fireDate: now.addingTimeInterval(3600)),
            ReminderPlan.pendingRequest(entryID: sent, title: "Flushed", fireDate: now.addingTimeInterval(3600)),
        ].map { ScheduledReminder(identifier: $0.identifier, fireDate: $0.fireDate, title: $0.title) }
        let plan = ReminderPlan.diff(items: [], scheduled: provisional, now: now, waiting: [waiting])
        #expect(plan.add.isEmpty)
        #expect(plan.remove == ["enve-memory.reminder.pending.\(sent.uuidString)"])
        #expect(provisional[0].identifier.hasPrefix(ReminderPlan.identifierPrefix))
    }

    @Test func keepsOnlyTheSoonestWithinTheSystemLimit() throws {
        let items = try (0..<80).map { i in
            try item("i\(i)", remind: JSONCoding.formatTimestamp(now.addingTimeInterval(Double(80 - i) * 3600)))
        }
        let plan = ReminderPlan.diff(items: items, scheduled: [], now: now)
        #expect(plan.add.count == ReminderPlan.maxScheduled)
        #expect(plan.add.first?.itemID == "i79")
        #expect(plan.add.map(\.fireDate) == plan.add.map(\.fireDate).sorted())
    }
}

@Suite struct ItemLinkTests {
    @Test func roundTrips() {
        let url = ItemLink.url(for: "01a0d757-1c59-7760-a804-470ea39bd4ef")
        #expect(url.absoluteString == "enve-memory://item/01a0d757-1c59-7760-a804-470ea39bd4ef")
        #expect(ItemLink.itemID(from: url) == "01a0d757-1c59-7760-a804-470ea39bd4ef")
    }

    @Test func rejectsOtherLinks() {
        #expect(ItemLink.itemID(from: URL(string: "enve-memory://pair?url=x&token=em_x")!) == nil)
        #expect(ItemLink.itemID(from: URL(string: "enve-memory://item/")!) == nil)
        #expect(ItemLink.itemID(from: URL(string: "https://item/abc")!) == nil)
        #expect(ItemLink.itemID(from: URL(string: "enve-memory://item/a/b")!) == nil)
    }
}
