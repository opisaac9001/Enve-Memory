import EnveMemoryKit
import SwiftUI

extension ItemType {
    var symbol: String {
        switch self {
        case .note: "note.text"
        case .bookmark: "link"
        case .task: "checkmark.circle"
        case .decision: "signpost.right"
        case .file: "doc"
        case .image: "photo"
        default: "square.dashed"
        }
    }

    var label: String {
        switch self {
        case .note: "Note"
        case .bookmark: "Link"
        case .task: "Task"
        case .decision: "Decision"
        case .file: "File"
        case .image: "Image"
        default: rawValue.capitalized
        }
    }

    var pluralLabel: String {
        switch self {
        case .note: "Notes"
        case .bookmark: "Links"
        case .task: "Tasks"
        case .decision: "Decisions"
        case .file: "Files"
        case .image: "Images"
        default: rawValue.capitalized
        }
    }
}

extension Item {
    var displayTitle: String {
        if !title.isEmpty { return title }
        if let url, let host = URL(string: url)?.host() { return host }
        return body.isEmpty ? "Untitled" : String(body.prefix(80))
    }

    /// One line of plain text under the title; nil when the title already is the body.
    var preview: String? {
        guard !title.isEmpty || url != nil else { return nil }
        let text = (metadata.excerpt ?? body)
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces).trimmingPrefix(/[>#\-*+]+\s*/) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return text.isEmpty || text == title ? nil : text
    }
}

/// Icon tile shared by item, hit and outbox rows.
struct TypeGlyph: View {
    let symbol: String
    var tint: Color?

    @Environment(\.hearth) private var hearth

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(tint ?? hearth.accent)
            .frame(width: 34, height: 34)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hearth.accentMuted))
            .accessibilityHidden(true)
    }
}

struct ItemRow: View {
    let item: Item
    var showsProject = true

    @Environment(\.hearth) private var hearth

    var body: some View {
        HStack(alignment: .top, spacing: HearthSpacing.md) {
            TypeGlyph(symbol: item.task?.status == .done ? "checkmark.circle.fill" : item.type.symbol)
            VStack(alignment: .leading, spacing: HearthSpacing.xs) {
                Text(item.displayTitle)
                    .font(HearthFont.cardTitle)
                    .foregroundStyle(hearth.textPrimary)
                    .lineLimit(2)
                if let preview = item.preview {
                    Text(preview)
                        .font(HearthFont.footnote)
                        .foregroundStyle(hearth.textSecondary)
                        .lineLimit(2)
                }
                Text(meta)
                    .font(HearthFont.caption)
                    .foregroundStyle(hearth.textTertiary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, HearthSpacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var meta: String {
        var parts = [item.type.label]
        if showsProject, let project = item.project { parts.append(project.name) }
        if let site = item.metadata.siteName ?? item.url.flatMap({ URL(string: $0)?.host() }) { parts.append(site) }
        parts.append(item.updatedAt.formatted(.relative(presentation: .named)))
        return parts.joined(separator: " · ")
    }
}

/// A list of rows on one card, separated by hairlines.
struct RowStack<Data: RandomAccessCollection, Row: View>: View where Data.Element: Identifiable {
    let data: Data
    @ViewBuilder var row: (Data.Element) -> Row

    var body: some View {
        HearthCard(padding: HearthSpacing.md) {
            VStack(spacing: 0) {
                ForEach(Array(data.enumerated()), id: \.element.id) { index, element in
                    if index > 0 { HearthDivider().padding(.leading, 46) }
                    row(element)
                }
            }
        }
    }
}

struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String

    @Environment(\.hearth) private var hearth

    var body: some View {
        VStack(spacing: HearthSpacing.sm) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(hearth.accent)
            Text(title)
                .font(HearthFont.cardTitle)
            Text(message)
                .font(HearthFont.footnote)
                .foregroundStyle(hearth.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HearthSpacing.xxxl)
        .accessibilityElement(children: .combine)
    }
}

struct ErrorBanner: View {
    let message: String
    var retry: (() -> Void)?

    @Environment(\.hearth) private var hearth

    var body: some View {
        HearthCard(padding: HearthSpacing.md) {
            HStack(alignment: .top, spacing: HearthSpacing.md) {
                Image(systemName: "wifi.exclamationmark")
                    .foregroundStyle(hearth.danger)
                Text(message)
                    .font(HearthFont.footnote)
                    .foregroundStyle(hearth.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let retry {
                    Button("Retry", action: retry)
                        .font(HearthFont.subheadline)
                }
            }
        }
    }
}

/// Search snippets mark matched terms with `[` `]`.
enum Snippet {
    static func attributed(_ snippet: String, highlight: Color) -> AttributedString {
        let flat = snippet
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
        var result = AttributedString()
        var buffer = ""
        var inMatch = false
        func emit() {
            guard !buffer.isEmpty else { return }
            var part = AttributedString(buffer)
            if inMatch {
                part.foregroundColor = highlight
                part.inlinePresentationIntent = .stronglyEmphasized
            }
            result += part
            buffer = ""
        }
        for character in flat {
            if character == "[", !inMatch {
                emit()
                inMatch = true
            } else if character == "]", inMatch {
                emit()
                inMatch = false
            } else {
                buffer.append(character)
            }
        }
        emit()
        return result
    }
}
