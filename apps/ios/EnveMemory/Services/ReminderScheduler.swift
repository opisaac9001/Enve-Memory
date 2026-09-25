import EnveMemoryKit
import Foundation
import Observation
import UserNotifications

/// Keeps local notifications in step with the server's reminders, so the phone reminds even when it's offline.
@Observable
final class ReminderScheduler {
    private(set) var authorization: UNAuthorizationStatus = .notDetermined

    var canAsk: Bool { authorization == .notDetermined }
    var isAllowed: Bool { authorization == .authorized || authorization == .provisional || authorization == .ephemeral }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Called when the user sets a reminder, never at launch.
    func requestAuthorizationIfNeeded() async {
        await refreshAuthorization()
        guard canAsk else { return }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refreshAuthorization()
    }

    func sync(_ client: APIClient?) async {
        guard let client else { return }
        try? await Self.sync(using: client)
    }

    /// Shows a just-set reminder right away; the next sync reconciles it with the server.
    func schedule(_ item: Item, at date: Date) async {
        try? await Self.add(ReminderPlan.request(for: item, at: date))
    }

    func cancel(itemID: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [ReminderPlan.identifier(for: itemID)])
    }

    nonisolated static func sync(using client: APIClient) async throws {
        let items = try await client.reminders(limit: 200)
        let center = UNUserNotificationCenter.current()
        let scheduled = await center.pendingNotificationRequests().map { request in
            ScheduledReminder(identifier: request.identifier,
                              fireDate: (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate(),
                              title: request.content.title)
        }
        let plan = ReminderPlan.diff(items: items, scheduled: scheduled, now: .now)
        center.removePendingNotificationRequests(withIdentifiers: plan.remove)
        for request in plan.add {
            try await add(request)
        }
    }

    nonisolated private static func add(_ reminder: ReminderRequest) async throws {
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
}

/// Opens the item when a reminder is tapped, and shows reminders that arrive while the app is open.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    private let router: Router

    init(router: Router) {
        self.router = router
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let link = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: link) else { return }
        await MainActor.run { router.handle(url) }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
