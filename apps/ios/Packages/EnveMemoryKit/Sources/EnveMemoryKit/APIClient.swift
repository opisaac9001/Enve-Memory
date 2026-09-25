import Foundation

public struct APIClient: Sendable {
    public let baseURL: URL
    public let token: String?
    public let session: URLSession
    public var timeout: TimeInterval

    public init(baseURL: URL, token: String?, session: URLSession = .shared, timeout: TimeInterval = 20) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
        self.timeout = timeout
    }

    public init(pairing: Pairing, session: URLSession = .shared) {
        self.init(baseURL: pairing.baseURL, token: pairing.token, session: session)
    }

    public func urlRequest(for endpoint: Endpoint) -> URLRequest {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let basePath = components.percentEncodedPath.hasSuffix("/") ? String(components.percentEncodedPath.dropLast()) : components.percentEncodedPath
        components.percentEncodedPath = basePath + "/api/v1" + endpoint.path
        components.percentEncodedQuery = endpoint.query.isEmpty ? nil : endpoint.query
            .map { "\(Endpoint.percentEncoded($0.name))=\(Endpoint.percentEncoded($0.value))" }
            .joined(separator: "&")

        var request = URLRequest(url: components.url!, timeoutInterval: timeout)
        request.httpMethod = endpoint.method
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in endpoint.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Sends the call and returns the body of a 2xx response; everything else becomes an `APIError`.
    public func data(for endpoint: Endpoint, uploadingFile fileURL: URL? = nil) async throws -> Data {
        let request = urlRequest(for: endpoint)
        let (data, response): (Data, URLResponse)
        do {
            if let fileURL {
                (data, response) = try await session.upload(for: request, fromFile: fileURL)
            } else {
                (data, response) = try await session.data(for: request)
            }
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw APIError.unreachable(error.code)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.unexpectedResponse(status: 0) }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) {
                throw APIError.server(status: http.statusCode, code: APIErrorCode(rawValue: envelope.error.code), message: envelope.error.message)
            }
            throw APIError.unexpectedResponse(status: http.statusCode)
        }
        return data
    }

    public func send<T: Decodable>(_ endpoint: Endpoint, as type: T.Type = T.self, uploadingFile fileURL: URL? = nil) async throws -> T {
        let data = try await data(for: endpoint, uploadingFile: fileURL)
        do {
            return try JSONCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }
}

extension APIClient {
    public func status() async throws -> ServerStatus { try await send(.status) }
    public func whoami() async throws -> ClientInfo { try await send(.whoami) }
    public func search(_ text: String, filter: ItemFilter = .init()) async throws -> [SearchHit] { try await send(.search(text, filter: filter)) }
    public func items(_ filter: ItemFilter = .init()) async throws -> [Item] { try await send(.items(filter)) }
    public func item(_ id: String) async throws -> ItemDetail { try await send(.item(id)) }
    public func projects() async throws -> [Project] { try await send(.projects) }
    public func briefing(_ projectRef: String) async throws -> ProjectBriefing { try await send(.briefing(projectRef)) }
    public func tasks(project: String? = nil, status: TaskListStatus = .active) async throws -> [Item] { try await send(.tasks(project: project, status: status)) }
    public func capture(_ request: CaptureRequest) async throws -> CaptureResult { try await send(.capture(request)) }
    public func createItem(_ request: NewItemRequest) async throws -> Item { try await send(.createItem(request)) }
    public func completeTask(_ id: String) async throws -> Item { try await send(.completeTask(id)) }

    public func upload(_ file: FileUpload, from fileURL: URL) async throws -> CaptureResult {
        try await send(.upload(file), uploadingFile: fileURL)
    }

    /// Downloads an item's primary file into `directory/<attachment id>/<filename>`, reusing an earlier download.
    public func download(_ attachment: Attachment, itemID: String, into directory: URL) async throws -> URL {
        let folder = directory.appending(path: attachment.id, directoryHint: .isDirectory)
        let destination = folder.appending(path: Self.safeFilename(attachment.filename))
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        let request = urlRequest(for: .itemFile(itemID))
        let (tempURL, response): (URL, URLResponse)
        do {
            (tempURL, response) = try await session.download(for: request)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw APIError.unreachable(error.code)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let data = try? Data(contentsOf: tempURL), let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) {
                throw APIError.server(status: status, code: APIErrorCode(rawValue: envelope.error.code), message: envelope.error.message)
            }
            throw APIError.unexpectedResponse(status: status)
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: tempURL, to: destination)
        return destination
    }

    /// Server-supplied names never become paths outside the download folder.
    static func safeFilename(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "file" : cleaned
    }
}
