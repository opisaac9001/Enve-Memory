import BackgroundTasks
import EnveMemoryKit
import SwiftUI

@main
struct EnveMemoryApp: App {
    @State private var theme = ThemeManager()
    @State private var router = Router()
    @State private var connection: Connection
    @State private var outbox: OutboxService
    @State private var projects = ProjectStore()
    @Environment(\.scenePhase) private var scenePhase

    static let refreshTaskID = "com.enve.memory.outbox"

    init() {
        let connection = Connection()
        _connection = State(initialValue: connection)
        _outbox = State(initialValue: OutboxService(connection: connection))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(theme)
                .environment(router)
                .environment(connection)
                .environment(outbox)
                .environment(projects)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task {
                    await connection.refresh()
                    await outbox.flush(ignoringBackoff: true)
                }
            case .background:
                if outbox.pendingCount > 0 { Self.scheduleRefresh() }
            default:
                break
            }
        }
        .backgroundTask(.appRefresh(Self.refreshTaskID)) {
            await Self.flushInBackground()
        }
    }

    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = .now.addingTimeInterval(15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Runs outside any scene, so it builds its own client from the Keychain.
    nonisolated static func flushInBackground() async {
        guard let pairing = try? KeychainCredentialStore().load() else { return }
        let outbox = Outbox()
        _ = await outbox.flush(using: APIClient(pairing: pairing))
        if await !outbox.entries().isEmpty { await scheduleRefresh() }
    }
}
