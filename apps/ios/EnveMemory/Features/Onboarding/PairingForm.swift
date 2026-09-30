import EnveMemoryKit
import SwiftUI
import VisionKit

/// Pair by QR code, pasted link, or address + token. Nothing is stored until the server answers.
struct PairingForm: View {
    let isReplacing: Bool
    let onPaired: () -> Void

    @Environment(Connection.self) private var connection
    @Environment(Router.self) private var router
    @Environment(\.hearth) private var hearth

    @State private var linkText = ""
    @State private var addressText = ""
    @State private var tokenText = ""
    @State private var showManual = false
    @State private var showScanner = false
    @State private var phase = Phase.idle

    enum Phase: Equatable {
        case idle
        case testing
        case verified(Pairing)
        case failed(String)
    }

    var body: some View {
        HearthScreen(title: isReplacing ? "Pair again" : "Connect your library", overline: "Petty Memory") {
            intro
            if scannerAvailable { scanCard }
            linkCard
            manualCard
            result
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView { payload in
                showScanner = false
                linkText = payload
                Task { await testLink() }
            }
            .ignoresSafeArea()
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: HearthSpacing.sm) {
            Text("Your memory lives on your computer. This phone connects to it over your network or Tailscale.")
                .font(HearthFont.body)
                .foregroundStyle(hearth.textSecondary)
            Text("On the computer, run:")
                .font(HearthFont.footnote)
                .foregroundStyle(hearth.textSecondary)
            Text("petty-memory serve --lan\npetty-memory clients pair \"iPhone\"")
                .font(HearthFont.monospace)
                .textSelection(.enabled)
                .padding(HearthSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: HearthRadius.inner, style: .continuous).fill(hearth.surfaceSunken))
        }
    }

    private var scannerAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    private var scanCard: some View {
        Button {
            showScanner = true
        } label: {
            Label("Scan the pairing QR code", systemImage: "qrcode.viewfinder")
        }
        .buttonStyle(.hearthPrimary)
    }

    private var linkCard: some View {
        HearthCard {
            VStack(alignment: .leading, spacing: HearthSpacing.md) {
                Overline("Pairing link")
                TextField("enve-memory://pair?…", text: $linkText, axis: .vertical)
                    .lineLimit(1...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .hearthField()
                    .accessibilityIdentifier("PairingLinkField")
                HStack(spacing: HearthSpacing.sm) {
                    PasteButton(payloadType: String.self) { strings in
                        linkText = strings.first ?? ""
                        Task { await testLink() }
                    }
                    .labelStyle(.titleAndIcon)
                    .buttonBorderShape(.capsule)
                    .tint(hearth.accent)
                    Spacer()
                    Button("Test link") { Task { await testLink() } }
                        .buttonStyle(.hearthQuiet)
                        .disabled(linkText.trimmingCharacters(in: .whitespaces).isEmpty || phase == .testing)
                }
            }
        }
    }

    private var manualCard: some View {
        HearthCard {
            VStack(alignment: .leading, spacing: HearthSpacing.md) {
                Button {
                    withAnimation { showManual.toggle() }
                } label: {
                    HStack {
                        Overline("Enter address and token")
                        Spacer()
                        Image(systemName: showManual ? "chevron.up" : "chevron.down")
                            .foregroundStyle(hearth.textTertiary)
                    }
                }
                .buttonStyle(.plain)
                if showManual {
                    TextField("http://192.168.1.20:49231", text: $addressText)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .hearthField()
                        .accessibilityLabel("Server address")
                    SecureField("em_…", text: $tokenText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .hearthField()
                        .accessibilityLabel("Token")
                    Button("Test connection") { Task { await testManual() } }
                        .buttonStyle(.hearthSecondary)
                        .disabled(addressText.isEmpty || tokenText.isEmpty || phase == .testing)
                }
            }
        }
    }

    @ViewBuilder
    private var result: some View {
        switch phase {
        case .idle:
            EmptyView()
        case .testing:
            HStack(spacing: HearthSpacing.sm) {
                ProgressView()
                Text("Testing connection…").font(HearthFont.footnote).foregroundStyle(hearth.textSecondary)
            }
        case .failed(let message):
            ErrorBanner(message: message)
        case .verified(let pairing):
            HearthCard {
                VStack(alignment: .leading, spacing: HearthSpacing.md) {
                    Label("Server answered", systemImage: "checkmark.seal.fill")
                        .font(HearthFont.headline)
                        .foregroundStyle(hearth.success)
                    LabeledContent("Server", value: pairing.baseURL.absoluteString)
                    LabeledContent("Version", value: pairing.serverVersion ?? "—")
                    LabeledContent("This device", value: pairing.clientName)
                    Button(isReplacing ? "Replace pairing" : "Connect") { adopt(pairing) }
                        .buttonStyle(.hearthPrimary)
                        .accessibilityIdentifier("ConnectButton")
                }
                .font(HearthFont.callout)
            }
        }
    }

    private func testLink() async {
        do {
            let link = try PairingLink(parsing: linkText)
            await verify(baseURL: link.baseURL, token: link.token)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func testManual() async {
        guard let url = PairingLink.serverURL(addressText) else {
            phase = .failed(PairingLink.ParseError.invalidURL.localizedDescription)
            return
        }
        let token = tokenText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard PairingLink.isToken(token) else {
            phase = .failed(PairingLink.ParseError.invalidToken.localizedDescription)
            return
        }
        await verify(baseURL: url, token: token)
    }

    private func verify(baseURL: URL, token: String) async {
        phase = .testing
        do {
            phase = .verified(try await connection.verify(baseURL: baseURL, token: token))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func adopt(_ pairing: Pairing) {
        do {
            try connection.adopt(pairing)
            router.show("Connected as \(pairing.clientName)")
            onPaired()
            Task { await connection.refresh() }
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}
