import EnveMemoryKit
import SwiftUI

struct SettingsView: View {
    @Environment(Connection.self) private var connection
    @Environment(OutboxService.self) private var outbox
    @Environment(Router.self) private var router
    @Environment(ThemeManager.self) private var theme
    @Environment(\.hearth) private var hearth

    @State private var confirmUnpair = false
    @State private var checking = false

    var body: some View {
        HearthScreen(title: "Settings") {
            server
            outboxSection
            appearance
            about
        }
        .task { await outbox.reload() }
        .confirmationDialog("Unpair this phone?", isPresented: $confirmUnpair, titleVisibility: .visible) {
            Button("Unpair", role: .destructive) { unpair() }
        } message: {
            Text("The token is removed from this phone. It stays valid on your computer until you revoke it with `enve-memory clients revoke`.")
        }
    }

    private var server: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Overline("Server")
            HearthCard {
                VStack(alignment: .leading, spacing: HearthSpacing.md) {
                    HStack(spacing: HearthSpacing.sm) {
                        Circle().fill(statusColor).frame(width: 10, height: 10)
                        Text(statusText)
                            .font(HearthFont.headline)
                            .accessibilityIdentifier("ConnectionStatus")
                        Spacer()
                        if checking {
                            ProgressView()
                        } else {
                            Button("Check") { check() }.font(HearthFont.subheadline)
                        }
                    }
                    if case .offline(let message) = connection.status {
                        Text(message).font(HearthFont.footnote).foregroundStyle(hearth.textSecondary)
                    }
                    if let pairing = connection.pairing {
                        detail("Address", pairing.baseURL.absoluteString)
                        detail("This device", pairing.clientName)
                        if case .online(let server, let me) = connection.status {
                            detail("Server version", server.version)
                            detail("Permissions", me.scopes.joined(separator: ", "))
                        }
                    }
                    HStack(spacing: HearthSpacing.sm) {
                        Button("Pair again") { router.showPairing = true }
                            .buttonStyle(.hearthSecondary)
                        Button("Unpair") { confirmUnpair = true }
                            .buttonStyle(.hearthDestructive)
                    }
                }
            }
        }
    }

    private func detail(_ label: String, _ value: String) -> some View {
        LabeledContent {
            Text(value).foregroundStyle(hearth.textPrimary).textSelection(.enabled).multilineTextAlignment(.trailing)
        } label: {
            Text(label).foregroundStyle(hearth.textSecondary)
        }
        .font(HearthFont.callout)
    }

    private var statusText: String {
        switch connection.status {
        case .online: "Connected"
        case .offline: "Can't reach the server"
        case .unauthorized: "Pairing revoked — pair again"
        case .unknown, .checking: "Checking…"
        }
    }

    private var statusColor: Color {
        switch connection.status {
        case .online: hearth.success
        case .offline, .unauthorized: hearth.danger
        case .unknown, .checking: hearth.textTertiary
        }
    }

    private var outboxSection: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            HStack {
                Overline("Outbox")
                Spacer()
                if !outbox.entries.isEmpty {
                    Button(outbox.isFlushing ? "Syncing…" : "Sync now") { Task { await outbox.flush(ignoringBackoff: true) } }
                        .font(HearthFont.subheadline)
                        .disabled(outbox.isFlushing)
                }
            }
            if outbox.entries.isEmpty {
                HearthCard(padding: HearthSpacing.md) {
                    Label("Everything is synced.", systemImage: "checkmark.circle")
                        .font(HearthFont.callout)
                        .foregroundStyle(hearth.textSecondary)
                        .accessibilityIdentifier("OutboxEmpty")
                }
            } else {
                RowStack(data: outbox.entries) { entry in
                    OutboxRow(entry: entry,
                              retry: { Task { await outbox.retry(entry) } },
                              remove: { Task { await outbox.remove(entry) } })
                }
            }
        }
    }

    private var appearance: some View {
        @Bindable var theme = theme
        return VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Overline("Appearance")
            HearthCard {
                VStack(alignment: .leading, spacing: HearthSpacing.md) {
                    Picker("Mode", selection: $theme.mode) {
                        ForEach(HearthMode.allCases) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Toggle("True black (OLED)", isOn: $theme.oledEnabled)
                        .font(HearthFont.callout)
                        .disabled(theme.mode == .paper)
                }
            }
        }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Overline("About")
            HearthCard {
                VStack(alignment: .leading, spacing: HearthSpacing.sm) {
                    Text("Enve Memory \(Bundle.main.shortVersion)")
                        .font(HearthFont.cardTitle)
                    Text("Your library stays on your computer. This phone keeps only its pairing token, in the Keychain, and an outbox of captures waiting to sync.")
                        .font(HearthFont.footnote)
                        .foregroundStyle(hearth.textSecondary)
                    Text("Free software under AGPL-3.0.")
                        .font(HearthFont.footnote)
                        .foregroundStyle(hearth.textTertiary)
                }
            }
        }
    }

    private func check() {
        checking = true
        Task {
            await connection.refresh()
            await outbox.flush(ignoringBackoff: true)
            checking = false
        }
    }

    private func unpair() {
        do {
            try connection.unpair()
        } catch {
            router.show(error.localizedDescription)
        }
    }
}

private struct OutboxRow: View {
    let entry: OutboxEntry
    let retry: () -> Void
    let remove: () -> Void

    @Environment(\.hearth) private var hearth

    var body: some View {
        HStack(alignment: .top, spacing: HearthSpacing.md) {
            TypeGlyph(symbol: symbol, tint: entry.needsAttention ? hearth.danger : nil)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title.isEmpty ? entry.kind.rawValue.capitalized : entry.title)
                    .font(HearthFont.subheadline)
                    .lineLimit(2)
                Text(status)
                    .font(HearthFont.caption)
                    .foregroundStyle(entry.needsAttention ? hearth.danger : hearth.textTertiary)
                if let error = entry.lastError {
                    Text(error)
                        .font(HearthFont.caption)
                        .foregroundStyle(hearth.textSecondary)
                        .lineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Menu {
                Button("Retry now", systemImage: "arrow.clockwise", action: retry)
                Button("Discard", systemImage: "trash", role: .destructive, action: remove)
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(hearth.textSecondary)
                    .frame(width: 34, height: 34)
            }
            .accessibilityLabel("Actions for \(entry.title)")
        }
        .padding(.vertical, HearthSpacing.xs)
        .accessibilityElement(children: .contain)
    }

    private var symbol: String {
        switch entry.kind {
        case .note: "note.text"
        case .link: "link"
        case .task: "checkmark.circle"
        case .file: "doc"
        }
    }

    private var status: String {
        let queued = "Queued \(entry.createdAt.formatted(.relative(presentation: .named)))"
        if entry.needsAttention { return "\(queued) · the server refused it" }
        if entry.attempts == 0 { return queued }
        return "\(queued) · \(entry.attempts) \(entry.attempts == 1 ? "try" : "tries"), next \(entry.nextAttemptAt.formatted(.relative(presentation: .named)))"
    }
}

extension Bundle {
    var shortVersion: String {
        (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "—"
    }
}
