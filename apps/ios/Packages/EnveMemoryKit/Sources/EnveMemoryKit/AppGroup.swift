import Foundation

/// Storage shared by the app and the share extension.
public enum AppGroup {
    public static let identifier = "group.com.enve.memory"

    /// The group container, or this process's Application Support when the entitlement is missing (unsigned builds).
    public static var containerURL: URL {
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier) {
            return url
        }
        return URL.applicationSupportDirectory.appending(path: "EnveMemory", directoryHint: .isDirectory)
    }

    public static var outboxDirectory: URL { containerURL.appending(path: "Outbox", directoryHint: .isDirectory) }
    public static var stagingDirectory: URL { containerURL.appending(path: "Staging", directoryHint: .isDirectory) }

    public static var defaults: UserDefaults { UserDefaults(suiteName: identifier) ?? .standard }
}

/// Small shared settings and caches. Nothing secret lives here; the token stays in the Keychain.
public struct SharedSettings: @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = AppGroup.defaults) { self.defaults = defaults }

    public var cachedProjects: [ProjectRef] {
        get {
            guard let data = defaults.data(forKey: Keys.projects) else { return [] }
            return (try? JSONDecoder().decode([ProjectRef].self, from: data)) ?? []
        }
        nonmutating set { defaults.set(try? JSONEncoder().encode(newValue), forKey: Keys.projects) }
    }

    public var lastProjectID: String? {
        get { defaults.string(forKey: Keys.lastProject) }
        nonmutating set { defaults.set(newValue, forKey: Keys.lastProject) }
    }

    public var themeMode: String? {
        get { defaults.string(forKey: Keys.theme) }
        nonmutating set { defaults.set(newValue, forKey: Keys.theme) }
    }

    public var oledEnabled: Bool {
        get { defaults.bool(forKey: Keys.oled) }
        nonmutating set { defaults.set(newValue, forKey: Keys.oled) }
    }

    private enum Keys {
        static let projects = "cachedProjects"
        static let lastProject = "lastProjectID"
        static let theme = "hearth.mode"
        static let oled = "hearth.oled"
    }
}
