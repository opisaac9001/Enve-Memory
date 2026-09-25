import SwiftUI

extension EnvironmentValues {
    @Entry var hearth: HearthPalette = .ink
    /// Height the floating Mantel dock covers; scroll content pads by it.
    @Entry var bottomBarInset: CGFloat = 0
}
