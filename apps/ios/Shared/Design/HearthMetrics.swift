import SwiftUI

/// 4pt rhythm shared with the other Hearth apps.
nonisolated enum HearthSpacing {
    static let hair: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let xxxl: CGFloat = 32
}

nonisolated enum HearthRadius {
    static let inner: CGFloat = 14
    static let button: CGFloat = 16
    static let card: CGFloat = 20
    static let bar: CGFloat = 30
}

/// Serif display voice for screen and item titles; the system face for every control.
/// Built on text styles so Dynamic Type changes apply live.
nonisolated enum HearthFont {
    static let screenTitle = Font.system(.largeTitle, design: .serif, weight: .bold)
    static let itemTitle = Font.system(.title, design: .serif, weight: .bold)
    static let sectionTitle = Font.system(.title3, design: .serif, weight: .semibold)
    static let cardTitle = Font.system(.headline, design: .serif, weight: .semibold)

    static let heading1 = Font.system(.title2, design: .serif, weight: .bold)
    static let heading2 = Font.system(.title3, design: .serif, weight: .semibold)
    static let heading3 = Font.system(.headline, design: .serif, weight: .semibold)

    static let body = Font.body
    static let headline = Font.headline
    static let callout = Font.callout
    static let subheadline = Font.subheadline.weight(.medium)
    static let footnote = Font.footnote
    static let caption = Font.caption
    static let overline = Font.caption2.weight(.semibold)
    static let monospace = Font.system(.callout, design: .monospaced)
}
