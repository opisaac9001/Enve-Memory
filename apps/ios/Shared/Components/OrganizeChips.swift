import EnveMemoryKit
import SwiftUI

extension Intent {
    var label: String {
        switch self {
        case .read: "Read"
        case .watch: "Watch"
        case .buy: "Buy"
        case .revisit: "Revisit"
        default: rawValue.capitalized
        }
    }

    var symbol: String {
        switch self {
        case .read: "book"
        case .watch: "play.rectangle"
        case .buy: "cart"
        case .revisit: "arrow.uturn.backward"
        default: "tag"
        }
    }
}

/// Read / Watch / Buy / Revisit. Tapping the selected chip clears it.
struct IntentChips: View {
    @Binding var intent: Intent?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: HearthSpacing.sm) {
                ForEach(Intent.all, id: \.self) { option in
                    FilterChip(title: option.label, systemImage: option.symbol, isSelected: intent == option) {
                        intent = intent == option ? nil : option
                    }
                }
            }
        }
        .scrollClipDisabled()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Intent")
    }
}

/// Quick reminder choices for a capture. The date is resolved when the chip is tapped.
struct ReminderChips: View {
    @Binding var preset: ReminderPreset?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: HearthSpacing.sm) {
                ForEach(ReminderPreset.allCases) { option in
                    FilterChip(title: option.title, systemImage: option == preset ? "bell.fill" : "bell", isSelected: preset == option) {
                        preset = preset == option ? nil : option
                    }
                }
            }
        }
        .scrollClipDisabled()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Remind me")
    }
}
