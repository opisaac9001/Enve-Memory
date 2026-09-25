import EnveMemoryKit
import Foundation
import Observation

@Observable
final class ShareModel {
    enum Phase: Equatable {
        case loading
        case ready
        case saving
        case finished(String)
        case failed(String)
    }

    private(set) var phase = Phase.loading
    private(set) var content: SharedContent?
    var form = ShareForm()
    let projects: [ProjectRef]

    private let finish: () -> Void
    private let cancel: () -> Void
    private let settings = SharedSettings()

    init(finish: @escaping () -> Void, cancel: @escaping () -> Void) {
        self.finish = finish
        self.cancel = cancel
        projects = settings.cachedProjects
        form.projectID = settings.lastProjectID.flatMap { id in projects.contains { $0.id == id } ? id : nil }
    }

    var isLink: Bool {
        if case .link = content { true } else { false }
    }

    var takesTitle: Bool {
        switch content {
        case .link, .text: true
        case .files(let files): files.count == 1
        case nil: false
        }
    }

    func load(_ providers: [NSItemProvider], contentText: String?) async {
        do {
            let loaded = try await ShareItemLoader().load(providers, contentText: contentText)
            content = loaded
            if case .link(_, let title) = loaded { form.title = title ?? "" }
            phase = .ready
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Tries the server directly; anything it can't take right now goes to the outbox for the app to flush.
    func save() async {
        guard let content else { return }
        phase = .saving
        settings.lastProjectID = form.projectID
        do {
            let captures = try SharePayload.captures(for: content, form: form)
            let pairing = try? KeychainCredentialStore().load()
            let client = pairing.map { APIClient(baseURL: $0.baseURL, token: $0.token, timeout: 12) }
            var queued = 0
            for capture in captures {
                if let client, queued == 0 {
                    do {
                        _ = try await client.data(for: capture.endpoint, uploadingFile: capture.file)
                        if let file = capture.file { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
                        continue
                    } catch let error as APIError where !error.isRetryable {
                        throw error
                    } catch {
                        // Unreachable: this and the rest wait in the outbox.
                    }
                }
                try await Outbox().enqueue(capture.endpoint, kind: capture.kind, title: capture.title, attachment: capture.file)
                queued += 1
            }
            if pairing == nil {
                phase = .finished("Saved — open Enve Memory to pair, then it will sync")
            } else {
                phase = .finished(queued > 0 ? "Saved — will sync when you're back on your network" : "Saved to Enve Memory")
            }
            try? await Task.sleep(for: .seconds(queued > 0 || pairing == nil ? 1.6 : 0.8))
            finish()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func dismiss() {
        try? FileManager.default.removeItem(at: AppGroup.stagingDirectory)
        cancel()
    }
}
