import EnveMemoryKit
import QuickLook
import SwiftUI

struct ItemDetailView: View {
    let itemID: String

    @Environment(Connection.self) private var connection
    @Environment(OutboxService.self) private var outbox
    @Environment(Router.self) private var router
    @Environment(\.hearth) private var hearth

    @State private var detail: ItemDetail?
    @State private var note = MarkdownDocument("")
    @State private var content = MarkdownDocument("")
    @State private var error: String?
    @State private var preview: URL?
    @State private var downloading: String?
    @State private var completing = false

    var body: some View {
        HearthScreen {
            if let error { ErrorBanner(message: error) { Task { await load() } } }
            if let detail {
                ItemDetailContent(detail: detail, note: note, content: content, downloading: downloading, completing: completing,
                                  open: open, complete: complete)
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity).padding(.top, HearthSpacing.xxxl)
            }
        }
        .toolbar(.visible, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let item = detail?.item {
                ToolbarItem(placement: .primaryAction) { PinButton(item: item) }
            }
            if let url = detail?.item.url.flatMap(URL.init(string:)) {
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: url)
                }
            }
        }
        .quickLookPreview($preview)
        .refreshable { await load() }
        .task(id: connection.revision) { await load() }
    }

    private func load() async {
        guard let client = connection.client else { return }
        do {
            let loaded = try await client.item(itemID)
            detail = loaded
            note = MarkdownDocument(loaded.item.body)
            content = MarkdownDocument(loaded.content)
            error = nil
        } catch is CancellationError {
            return
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func open(_ attachment: Attachment) {
        guard let client = connection.client, downloading == nil else { return }
        downloading = attachment.id
        Task {
            defer { downloading = nil }
            do {
                let folder = URL.cachesDirectory.appending(path: "Attachments", directoryHint: .isDirectory)
                preview = try await client.download(attachment, itemID: itemID, into: folder)
                if let item = detail?.item { ItemActions(outbox: outbox, router: router).markOpened(item) }
            } catch {
                router.show(error.localizedDescription)
            }
        }
    }

    private func complete() {
        guard let item = detail?.item else { return }
        completing = true
        Task {
            if await !TaskCompleter(outbox: outbox, router: router).complete(item) { completing = false }
        }
    }
}

private struct ItemDetailContent: View {
    let detail: ItemDetail
    let note: MarkdownDocument
    let content: MarkdownDocument
    let downloading: String?
    let completing: Bool
    let open: (Attachment) -> Void
    let complete: () -> Void

    @Environment(Router.self) private var router
    @Environment(OutboxService.self) private var outbox
    @Environment(\.openURL) private var openURL
    @Environment(\.hearth) private var hearth

    private var item: Item { detail.item }

    var body: some View {
        header
        if let task = item.task { taskCard(task) }
        if item.task == nil, item.type != .decision { OrganizeCard(item: item) }
        if let ai = item.metadata.ai, ai.isReady, ai.summary?.isEmpty == false || ai.isPending {
            SuggestionsCard(ai: ai, itemID: item.id)
        }
        if !note.isEmpty {
            Overline(item.type == .bookmark || item.type == .file ? "Your note" : "Note")
            HearthCard(padding: HearthSpacing.xl) { MarkdownView(document: note) }
        }
        if !detail.tags.isEmpty {
            FlowLayout {
                ForEach(detail.tags, id: \.self) { TagChip(tag: $0) }
            }
        }
        if !detail.attachments.isEmpty { attachments }
        archive
        if !detail.relations.isEmpty { relations }
        footer
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Overline([item.type.label, item.project?.name].compactMap(\.self).joined(separator: " · "))
            Text(item.displayTitle)
                .font(HearthFont.itemTitle)
                .foregroundStyle(hearth.textPrimary)
                .textSelection(.enabled)
                .accessibilityAddTraits(.isHeader)
            if let source = sourceLine {
                Text(source)
                    .font(HearthFont.footnote)
                    .foregroundStyle(hearth.textSecondary)
            }
            if let url = item.url.flatMap(URL.init(string:)) {
                Button {
                    openURL(url)
                    ItemActions(outbox: outbox, router: router).markOpened(item)
                } label: {
                    Label("Open original", systemImage: "safari")
                }
                .buttonStyle(.hearthSecondary)
                .padding(.top, HearthSpacing.xs)
                .accessibilityHint(url.absoluteString)
            }
        }
    }

    private var sourceLine: String? {
        let meta = item.metadata
        let site = meta.siteName ?? item.url.flatMap { URL(string: $0)?.host() }
        let published = meta.publishedAt.flatMap(JSONCoding.parseTimestamp)?.formatted(date: .abbreviated, time: .omitted)
        let parts = [site, meta.byline, published].compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func taskCard(_ task: TaskFields) -> some View {
        HearthCard(padding: HearthSpacing.md) {
            HStack(spacing: HearthSpacing.md) {
                VStack(alignment: .leading, spacing: HearthSpacing.xs) {
                    Text(task.status.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(HearthFont.headline)
                    Text([task.priority == .normal ? nil : "\(task.priority.rawValue.capitalized) priority",
                          task.dueDate.map { "Due \(DueFormat.label($0))" }].compactMap(\.self).joined(separator: " · "))
                        .font(HearthFont.footnote)
                        .foregroundStyle(hearth.textSecondary)
                }
                Spacer()
                if !task.status.isFinished {
                    Button(completing ? "Done" : "Complete", action: complete)
                        .buttonStyle(.hearthPrimary)
                        .fixedSize()
                        .disabled(completing)
                }
            }
        }
    }

    private var attachments: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Overline("Attachments")
            RowStack(data: detail.attachments) { attachment in
                Button { open(attachment) } label: {
                    HStack(spacing: HearthSpacing.md) {
                        TypeGlyph(symbol: attachment.mimeType.hasPrefix("image/") ? "photo" : attachment.mimeType == "application/pdf" ? "doc.richtext" : "doc")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(attachment.filename).font(HearthFont.subheadline).lineLimit(1)
                            Text("\(attachment.size.formatted(.byteCount(style: .file))) · \(attachment.mimeType)")
                                .font(HearthFont.caption)
                                .foregroundStyle(hearth.textTertiary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if downloading == attachment.id {
                            ProgressView()
                        } else {
                            Image(systemName: "eye").foregroundStyle(hearth.accent)
                        }
                    }
                    .padding(.vertical, HearthSpacing.xs)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Downloads and previews the file")
            }
        }
    }

    @ViewBuilder
    private var archive: some View {
        let ingest = item.metadata.ingest
        if !content.isEmpty {
            HStack {
                Overline("Archived copy")
                Spacer()
                if let words = item.metadata.wordCount {
                    Text("\(words.formatted()) words").font(HearthFont.caption).foregroundStyle(hearth.textTertiary)
                }
            }
            // A quiet surface for long reading: no glow, generous measure.
            MarkdownView(document: content)
                .padding(HearthSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: HearthRadius.card, style: .continuous).fill(hearth.surface))
                .overlay(RoundedRectangle(cornerRadius: HearthRadius.card, style: .continuous).strokeBorder(hearth.hairline))
                .textSelection(.enabled)
        } else if ingest?.status == "pending" {
            Label("Archiving a copy on your computer…", systemImage: "hourglass")
                .font(HearthFont.footnote)
                .foregroundStyle(hearth.textSecondary)
        } else if ingest?.status == "failed" {
            Label("Couldn't archive this page\(ingest?.error.map { ": \($0)" } ?? ".")", systemImage: "exclamationmark.triangle")
                .font(HearthFont.footnote)
                .foregroundStyle(hearth.textSecondary)
        }
    }

    private var relations: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Overline("Related")
            RowStack(data: detail.relations.map(RelationRow.init)) { row in
                Button { router.open(.item(row.relation.id)) } label: {
                    HStack(spacing: HearthSpacing.md) {
                        TypeGlyph(symbol: row.relation.type.symbol)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.relation.title).font(HearthFont.subheadline)
                            Text(row.relation.kind.replacingOccurrences(of: "_", with: " "))
                                .font(HearthFont.caption).foregroundStyle(hearth.textTertiary)
                        }
                        Spacer()
                    }
                    .padding(.vertical, HearthSpacing.xs)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Saved \(item.createdAt.formatted(date: .abbreviated, time: .shortened)) by \(item.source)")
            if item.updatedAt != item.createdAt {
                Text("Updated \(item.updatedAt.formatted(.relative(presentation: .named)))")
            }
        }
        .font(HearthFont.caption)
        .foregroundStyle(hearth.textTertiary)
        .padding(.top, HearthSpacing.sm)
    }
}

private struct RelationRow: Identifiable {
    let relation: RelatedItem
    var id: String { "\(relation.kind)-\(relation.direction)-\(relation.id)" }
}
