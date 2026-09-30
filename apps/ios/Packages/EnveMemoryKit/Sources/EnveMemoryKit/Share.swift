import Foundation
import UniformTypeIdentifiers

public struct SharedFile: Hashable, Sendable {
    public let url: URL
    public let filename: String
    public let mimeType: String
}

public enum SharedContent: Hashable, Sendable {
    case link(URL, title: String?)
    case text(String)
    case files([SharedFile])
}

/// What the user typed on the share sheet.
public struct ShareForm: Hashable, Sendable {
    public var title: String
    public var note: String
    public var projectID: String?
    public var tags: String
    /// Links and files; a text note has no intent.
    public var intent: Intent?
    public var remind: Date?

    public init(title: String = "", note: String = "", projectID: String? = nil, tags: String = "", intent: Intent? = nil, remind: Date? = nil) {
        self.title = title
        self.note = note
        self.projectID = projectID
        self.tags = tags
        self.intent = intent
        self.remind = remind
    }
}

/// One call to make for a share, ready to send directly or park in the outbox.
public struct PendingCapture: Hashable, Sendable {
    public let endpoint: Endpoint
    public let kind: OutboxEntry.Kind
    public let title: String
    public let file: URL?
}

public enum Tags {
    /// "esp32, #hardware" → ["esp32", "hardware"]. The server normalizes further.
    public static func parse(_ text: String) -> [String] {
        text.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).trimmingPrefix("#") }
            .map(String.init)
            .filter { !$0.isEmpty }
    }
}

public enum SharePayload {
    public static func captures(for content: SharedContent, form: ShareForm) throws -> [PendingCapture] {
        let title = form.title.trimmed
        let note = form.note.trimmed
        let tags = Tags.parse(form.tags)
        switch content {
        case .link(let url, let pageTitle):
            let request = CaptureRequest(url: url.absoluteString, title: title ?? pageTitle, note: note, project: form.projectID, tags: tags.nilIfEmpty,
                                         intent: form.intent, remind: form.remind)
            return [PendingCapture(endpoint: try .capture(request), kind: .link, title: title ?? pageTitle ?? url.host() ?? url.absoluteString, file: nil)]
        case .text(let text):
            let request = CaptureRequest(title: title, selection: text, note: note, project: form.projectID, tags: tags.nilIfEmpty, remind: form.remind)
            return [PendingCapture(endpoint: try .capture(request), kind: .note, title: title ?? String(text.prefix(60)), file: nil)]
        case .files(let files):
            return files.map { file in
                let upload = FileUpload(filename: file.filename, mimeType: file.mimeType, title: files.count == 1 ? title : nil,
                                        note: note, project: form.projectID, tags: tags, intent: form.intent, remind: form.remind)
                return PendingCapture(endpoint: .upload(upload), kind: .file, title: upload.title ?? file.filename, file: file.url)
            }
        }
    }
}

/// Turns share-sheet item providers into `SharedContent`. Files are copied into `stagingDirectory`
/// right away, because the provider's temporary files vanish when its callback returns.
@MainActor
public struct ShareItemLoader {
    public let stagingDirectory: URL

    public init(stagingDirectory: URL = AppGroup.stagingDirectory) {
        self.stagingDirectory = stagingDirectory
    }

    public enum LoadError: Error, LocalizedError {
        case nothingToSave
        public var errorDescription: String? { "There's nothing here Petty Memory can save." }
    }

    enum Kind: Equatable {
        case file(UTType?)
        case url
        case text
    }

    static func classify(_ typeIdentifiers: [String]) -> Kind? {
        let types = typeIdentifiers.compactMap { UTType($0) }
        let isFile = { (t: UTType) in
            t.conforms(to: .image) || t.conforms(to: .pdf) || t.conforms(to: .audiovisualContent)
                || (t.conforms(to: .data) && !t.conforms(to: .text) && !t.conforms(to: .url))
        }
        if types.contains(where: { $0.conforms(to: .fileURL) }) {
            return .file(types.first { !$0.conforms(to: .url) })
        }
        if let type = types.first(where: isFile) { return .file(type) }
        if types.contains(where: { $0.conforms(to: .url) }) { return .url }
        if types.contains(where: { $0.conforms(to: .text) }) { return .text }
        return nil
    }

    public func load(_ providers: [NSItemProvider], contentText: String?) async throws -> SharedContent {
        var files: [SharedFile] = []
        var link: URL?
        var texts: [String] = []
        for provider in providers {
            switch Self.classify(provider.registeredTypeIdentifiers) {
            case .file(let type): files.append(try await loadFile(provider, type: type))
            case .url: if link == nil { link = try await loadURL(provider) }
            case .text: if let text = try await loadText(provider) { texts.append(text) }
            case nil: continue
            }
        }
        let context = contentText?.trimmed
        if !files.isEmpty { return .files(files) }
        if let link {
            let title = context ?? texts.first?.trimmed
            return .link(link, title: title == link.absoluteString ? nil : title)
        }
        let text = texts.joined(separator: "\n\n").trimmed ?? context
        guard let text else { throw LoadError.nothingToSave }
        if let url = URL.web(text) { return .link(url, title: nil) }
        return .text(text)
    }

    // `loadObject` decodes the URL; `loadItem` hands back an archived plist on iOS.
    private func loadURL(_ provider: NSItemProvider) async throws -> URL? {
        try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { @Sendable url, error in
                if let error { return continuation.resume(throwing: error) }
                continuation.resume(returning: url)
            }
        }
    }

    private func loadText(_ provider: NSItemProvider) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { @Sendable item, error in
                if let error { return continuation.resume(throwing: error) }
                switch item {
                case let string as String: continuation.resume(returning: string)
                case let attributed as NSAttributedString: continuation.resume(returning: attributed.string)
                case let data as Data: continuation.resume(returning: String(data: data, encoding: .utf8))
                default: continuation.resume(returning: nil)
                }
            }
        }
    }

    private func loadFile(_ provider: NSItemProvider, type: UTType?) async throws -> SharedFile {
        let staging = stagingDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        let suggestedName = provider.suggestedName
        let copied: URL = try await withCheckedThrowingContinuation { continuation in
            let copy: @Sendable (URL) -> Void = { source in
                let scoped = source.startAccessingSecurityScopedResource()
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                let name = Self.filename(suggested: suggestedName, source: source, type: type)
                let destination = staging.appending(path: name)
                do {
                    try FileManager.default.copyItem(at: source, to: destination)
                    continuation.resume(returning: destination)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            // The file URL keeps the original name; a file representation may be a renamed temp copy.
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                _ = provider.loadObject(ofClass: URL.self) { @Sendable url, error in
                    guard let url else { return continuation.resume(throwing: error ?? LoadError.nothingToSave) }
                    copy(url)
                }
            } else if let type {
                provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { @Sendable url, error in
                    guard let url else { return continuation.resume(throwing: error ?? LoadError.nothingToSave) }
                    copy(url)
                }
            } else {
                continuation.resume(throwing: LoadError.nothingToSave)
            }
        }
        let ext = copied.pathExtension
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? type?.preferredMIMEType ?? "application/octet-stream"
        return SharedFile(url: copied, filename: copied.lastPathComponent, mimeType: mime)
    }

    nonisolated static func filename(suggested: String?, source: URL, type: UTType?) -> String {
        let sourceName = source.lastPathComponent
        guard let suggested = suggested?.replacingOccurrences(of: "/", with: "_"), !suggested.isEmpty else { return sourceName }
        if !(suggested as NSString).pathExtension.isEmpty { return suggested }
        let ext = source.pathExtension.isEmpty ? type?.preferredFilenameExtension : source.pathExtension
        return ext.map { "\(suggested).\($0)" } ?? suggested
    }
}

extension URL {
    /// An http(s) URL with a host, or nil. Used to tell a pasted link from ordinary text.
    public static func web(_ text: String) -> URL? {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.contains(where: \.isWhitespace), let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", url.host() != nil
        else { return nil }
        return url
    }
}

extension String {
    var trimmed: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

extension Array {
    var nilIfEmpty: Self? { isEmpty ? nil : self }
}
