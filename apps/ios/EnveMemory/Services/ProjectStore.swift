import EnveMemoryKit
import Foundation
import Observation

/// The project list, mirrored into the App Group so the share sheet can offer it offline.
@Observable
final class ProjectStore {
    private(set) var projects: [Project] = []
    private let settings = SharedSettings()

    var refs: [ProjectRef] {
        projects.isEmpty ? settings.cachedProjects : projects.map(\.ref)
    }

    /// Drops the in-memory list after re-pairing; `refs` falls back to the (cleared) shared cache until the next load.
    func reset() {
        projects = []
    }

    func load(_ client: APIClient?) async throws {
        guard let client else { return }
        projects = try await client.projects()
        settings.cachedProjects = projects.map(\.ref)
    }

    func name(for id: String?) -> String? {
        guard let id else { return nil }
        return refs.first { $0.id == id }?.name
    }
}
