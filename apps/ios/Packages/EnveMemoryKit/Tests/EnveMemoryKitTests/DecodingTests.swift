import Foundation
import Testing
@testable import EnveMemoryKit

/// Every fixture is a real response captured from `enve-memory serve` 0.1.0.
@Suite struct DecodingTests {
    func decode<T: Decodable>(_ type: T.Type, _ fixture: String) throws -> T {
        try JSONCoding.makeDecoder().decode(T.self, from: Fixture.data(fixture))
    }

    @Test func status() throws {
        let status = try decode(ServerStatus.self, "status")
        #expect(status == ServerStatus(name: "enve-memory", version: "0.1.0", api: 1))
    }

    @Test func whoami() throws {
        let me = try decode(ClientInfo.self, "whoami")
        #expect(me.scopes == ["read", "write"])
        #expect(me.revokedAt == nil)
        #expect(me.lastUsedAt != nil)
    }

    @Test func items() throws {
        let items = try decode([Item].self, "items")
        #expect(items.count > 5)
        let link = try #require(items.first { $0.type == .bookmark && $0.url == "https://example.com/esp32-uart" })
        #expect(link.project?.name == "Garage")
        #expect(link.source == "api:Fixture Capture")
        #expect(link.task == nil)
        #expect(Set(items.map(\.type)).isSuperset(of: [.note, .bookmark, .task, .file, .decision]))
    }

    @Test func pageCursorKeepsTheServersTimestampVerbatim() throws {
        let items = try decode([Item].self, "items")
        let json = try JSONSerialization.jsonObject(with: Fixture.data("items")) as! [[String: Any]]
        for (item, raw) in zip(items, json) {
            #expect(item.pageCursor == "\(raw["updatedAt"] as! String),\(raw["id"] as! String)")
        }
    }

    @Test func fractionalTimestamps() throws {
        let item = try #require(try decode([Item].self, "items").first)
        let components = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: item.createdAt)
        #expect(components.year == 2026)
        #expect(components.nanosecond.map { $0 > 0 } == true)
    }

    @Test func fileDetailWithArchivedContent() throws {
        let detail = try decode(ItemDetail.self, "item-detail-file")
        #expect(detail.item.type == .file)
        #expect(detail.content.hasPrefix("# Security+ 2.0 wire protocol notes"))
        #expect(detail.attachments.first?.filename == "secplus-notes.md")
        #expect(detail.attachments.first?.mimeType == "text/markdown")
        #expect(detail.tags == ["protocol"])
        #expect(detail.item.task == nil)
    }

    @Test func captureResultEmbedsAnItemDetail() throws {
        let result = try decode(CaptureResult.self, "capture-note")
        #expect(result.created)
        #expect(result.item.type == .note)
        #expect(result.item.title == "Spring tension")
        let link = try decode(CaptureResult.self, "capture-link")
        #expect(link.item.body == "> The RX timeout is measured in symbol times.")
    }

    @Test func keywordSearch() throws {
        let hits = try decode([SearchHit].self, "search")
        let task = try #require(hits.first { $0.type == .task })
        #expect(task.snippet == "Build the [bench] simulator")
        #expect(task.match == .keyword)
        #expect(task.taskStatus == .open)
    }

    @Test func hybridSearchMatchKinds() throws {
        let hits = try decode([SearchHit].self, "search-semantic")
        #expect(Set(hits.map(\.match)) == [.both, .semantic])
        #expect(hits.contains { $0.type == .decision && $0.taskStatus == nil })
    }

    @Test func projects() throws {
        let projects = try decode([Project].self, "projects")
        #expect(projects.map(\.name).sorted() == ["Garage", "Home Lab"])
        #expect(projects.first { $0.name == "Garage" }?.memory.contains("## Open questions") == true)
    }

    @Test func briefing() throws {
        let briefing = try decode(ProjectBriefing.self, "briefing")
        #expect(briefing.project.slug == "garage")
        #expect(briefing.project.instructions == "Must work offline. No cloud services.")
        #expect(briefing.decisions.count == 3)
        let superseded = briefing.decisions.filter(\.isSuperseded)
        #expect(superseded.map(\.decision) == ["Use ESPHome for the firmware"])
        #expect(briefing.decisions.first { $0.supersedes == [superseded[0].id] } != nil)
        #expect(briefing.openTasks.allSatisfy { $0.task?.status == .open })
        #expect(!briefing.recentItems.isEmpty)
    }

    @Test func tasksWithDateOnlyDueDates() throws {
        let tasks = try decode([Item].self, "tasks")
        let nas = try #require(tasks.first { $0.title.hasPrefix("Replace NAS") })
        #expect(nas.task?.priority == .high)
        #expect(nas.task?.dueAt == "2026-09-26")
        let due = try #require(nas.task?.dueDate)
        let day = Calendar.current.dateComponents([.year, .month, .day], from: due)
        #expect(day == DateComponents(year: 2026, month: 9, day: 26))
        #expect(tasks.contains { $0.project == nil })
    }

    @Test func unknownEnumValuesSurvive() throws {
        let json = #"{"id":"x","type":"conversation","title":"t","body":"","url":null,"project":null,"source":"cli","metadata":{"ingest":{"status":"pending"},"somethingNew":[1,2]},"createdAt":"2026-09-25T05:31:38Z","updatedAt":"2026-09-25T05:31:38.156Z","archivedAt":null,"task":{"status":"blocked","priority":"urgent","dueAt":null,"completedAt":null}}"#
        let item = try JSONCoding.makeDecoder().decode(Item.self, from: Data(json.utf8))
        #expect(item.type.rawValue == "conversation")
        #expect(item.task?.status.rawValue == "blocked")
        #expect(item.metadata.ingest?.status == "pending")
    }
}
