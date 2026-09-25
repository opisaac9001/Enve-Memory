import SwiftUI

enum HearthMode: String, CaseIterable, Identifiable, Sendable {
    case system, ink, paper
    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: "System"
        case .ink: "Ink"
        case .paper: "Paper"
        }
    }
}

/// Semantic colors. Screens use only these tokens, so a mode change repaints everything.
struct HearthPalette: Equatable {
    var background: Color
    var surface: Color
    var surfaceSunken: Color
    var textPrimary: Color
    var textSecondary: Color
    var textTertiary: Color
    var accent: Color
    var accentMuted: Color
    var onAccent: Color
    var hairline: Color
    var scrim: Color
    var danger: Color
    var success: Color
    var isDark: Bool

    static let ember = Color(hex: 0xF5921A)
}

extension HearthPalette {
    static let ink = HearthPalette(
        background: Color(hex: 0x0C0A09),
        surface: Color(hex: 0x191512),
        surfaceSunken: .black,
        textPrimary: Color(hex: 0xF0E9DC),
        textSecondary: Color(hex: 0xA99F92),
        textTertiary: Color(hex: 0x6E665C),
        accent: ember,
        accentMuted: ember.opacity(0.14),
        onAccent: Color(hex: 0x1A120A),
        hairline: .white.opacity(0.08),
        scrim: .black,
        danger: Color(hex: 0xD06A5C),
        success: Color(hex: 0x7DB38A),
        isDark: true)

    static let paper = HearthPalette(
        background: Color(hex: 0xF7F2E9),
        surface: .white,
        surfaceSunken: Color(hex: 0xEFE8DB),
        textPrimary: Color(hex: 0x231F1B),
        textSecondary: Color(hex: 0x7A7064),
        textTertiary: Color(hex: 0xA89D8F),
        accent: ember,
        accentMuted: ember.opacity(0.12),
        onAccent: Color(hex: 0x1A120A),
        hairline: .black.opacity(0.08),
        scrim: Color(hex: 0x231F1B),
        danger: Color(hex: 0xA8453A),
        success: Color(hex: 0x3F7F50),
        isDark: false)

    static let oled = HearthPalette(
        background: .black,
        surface: Color(hex: 0x0C0C0D),
        surfaceSunken: .black,
        textPrimary: Color(hex: 0xF0E9DC),
        textSecondary: Color(hex: 0xA99F92),
        textTertiary: Color(hex: 0x6E665C),
        accent: ember,
        accentMuted: ember.opacity(0.16),
        onAccent: Color(hex: 0x1A120A),
        hairline: .white.opacity(0.11),
        scrim: .black,
        danger: Color(hex: 0xD06A5C),
        success: Color(hex: 0x7DB38A),
        isDark: true)

    static func resolve(_ mode: HearthMode, systemDark: Bool, oled: Bool) -> HearthPalette {
        switch mode {
        case .system: systemDark ? (oled ? .oled : .ink) : .paper
        case .ink: oled ? .oled : .ink
        case .paper: .paper
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}
