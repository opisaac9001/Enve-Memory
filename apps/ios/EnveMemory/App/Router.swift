import EnveMemoryKit
import Observation
import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case home, search, projects, tasks, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Home"
        case .search: "Search"
        case .projects: "Projects"
        case .tasks: "Tasks"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .search: "magnifyingglass"
        case .projects: "folder"
        case .tasks: "checklist"
        case .settings: "gearshape"
        }
    }

    var selectedSymbol: String {
        switch self {
        case .home: "house.fill"
        case .search: "magnifyingglass"
        case .projects: "folder.fill"
        case .tasks: "checklist"
        case .settings: "gearshape.fill"
        }
    }
}

enum Route: Hashable {
    case item(String)
    case project(String)
}

enum CaptureKind: String, CaseIterable, Identifiable {
    case note, link, task
    var id: String { rawValue }

    var title: String {
        switch self {
        case .note: "Note"
        case .link: "Link"
        case .task: "Task"
        }
    }

    var symbol: String {
        switch self {
        case .note: "note.text"
        case .link: "link"
        case .task: "checkmark.circle"
        }
    }
}

/// Tabs, per-tab navigation, sheets, toasts and incoming pairing links.
@Observable
final class Router {
    var selectedTab: AppTab = .home
    var paths: [AppTab: NavigationPath] = [:]
    var capture: CaptureKind?
    var showPairing = false
    var pendingPairLink: PairingLink?
    var toast: String?
    let search = SearchModel()

    func path(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(get: { self.paths[tab] ?? NavigationPath() }, set: { self.paths[tab] = $0 })
    }

    func open(_ route: Route) {
        paths[selectedTab, default: NavigationPath()].append(route)
    }

    func show(_ message: String) {
        toast = message
    }

    /// Reports how a write went; returns true when it's safe to dismiss the form.
    @discardableResult
    func report(_ outcome: OutboxService.Outcome, sent: String) -> Bool {
        switch outcome {
        case .sent:
            show(sent)
            return true
        case .queued:
            show("Saved — will sync when you're back on your network")
            return true
        case .failed(let error):
            show(error.localizedDescription)
            return false
        }
    }
}
