import EnveMemoryKit
import Foundation
import UserNotifications

/// Local notifications for reminders, shared by the app and the share extension (which schedules for the app).
enum LocalReminders {
    /// The extension never asks; it schedules only when the user already allowed notifications in the app.
    nonisolated static func isAllowed() async -> Bool {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: true
        default: false
        }
    }

    nonisolated static func add(_ reminder: ReminderRequest) async throws {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = reminder.body
        content.sound = .default
        content.threadIdentifier = "reminders"
        content.userInfo = ["url": reminder.url.absoluteString]
        let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: reminder.fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: reminder.identifier, content: content, trigger: trigger))
    }

    /// After a write that set a reminder: under the item's id when the server answered, provisionally when it was queued.
    nonisolated static func schedule(after response: Data?, queued entry: OutboxEntry?, title: String, at date: Date) async {
        guard date > .now, await isAllowed() else { return }
        if let response, let result = try? JSONCoding.makeDecoder().decode(CaptureResult.self, from: response) {
            try? await add(ReminderPlan.request(for: result.item, at: date))
        } else if let entry {
            try? await add(ReminderPlan.pendingRequest(entryID: entry.id, title: title, fireDate: date))
        }
    }
}
