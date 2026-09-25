import EnveMemoryKit
import Observation
import SwiftUI

/// Appearance choice, stored in the App Group so the share sheet matches the app.
@Observable
final class ThemeManager {
    var mode: HearthMode {
        didSet { settings.themeMode = mode.rawValue }
    }
    var oledEnabled: Bool {
        didSet { settings.oledEnabled = oledEnabled }
    }

    private let settings: SharedSettings

    init(settings: SharedSettings = SharedSettings()) {
        self.settings = settings
        mode = settings.themeMode.flatMap(HearthMode.init(rawValue:)) ?? .system
        oledEnabled = settings.oledEnabled
    }

    func palette(systemDark: Bool) -> HearthPalette {
        .resolve(mode, systemDark: systemDark, oled: oledEnabled)
    }

    var preferredScheme: ColorScheme? {
        switch mode {
        case .system: nil
        case .ink: .dark
        case .paper: .light
        }
    }
}
