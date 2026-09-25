import SwiftUI

/// The Hearth floating pill tab bar.
struct MantelDock: View {
    @Binding var selection: AppTab

    @Environment(\.hearth) private var hearth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: HearthSpacing.xs) {
            ForEach(AppTab.allCases) { tab in
                item(tab)
            }
        }
        .padding(HearthSpacing.xs + 2)
        .background {
            ZStack {
                Capsule(style: .continuous).fill(.ultraThinMaterial)
                Capsule(style: .continuous).fill(hearth.surface.opacity(0.72))
            }
        }
        .overlay(Capsule(style: .continuous).strokeBorder(hearth.hairline))
        .clipShape(Capsule(style: .continuous))
        .shadow(color: hearth.scrim.opacity(hearth.isDark ? 0.4 : 0.16), radius: 22, x: 0, y: 12)
        .padding(.horizontal, HearthSpacing.lg)
        .frame(maxWidth: 560)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("MantelDock")
    }

    private func item(_ tab: AppTab) -> some View {
        let isSelected = selection == tab
        return Button {
            if reduceMotion {
                selection = tab
            } else {
                withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { selection = tab }
            }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: isSelected ? tab.selectedSymbol : tab.symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(height: 22)
                Text(tab.title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isSelected ? hearth.onAccent : hearth.textTertiary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, HearthSpacing.sm)
            .background(Capsule(style: .continuous).fill(isSelected ? hearth.accent : .clear))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityIdentifier("Dock_\(tab.rawValue)")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
