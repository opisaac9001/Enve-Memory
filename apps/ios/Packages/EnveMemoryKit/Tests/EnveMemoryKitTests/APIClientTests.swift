import Foundation
import Testing
@testable import EnveMemoryKit

@Suite struct RequestBuildingTests {
    let client = APIClient(baseURL: URL(string: "http://192.168.1.20:49231")!, token: "em_secret")

    @Test func addsVersionPrefixAuthAndAccept() {
        let request = client.urlRequest(for: .whoami)
        #expect(request.url?.absoluteString == "http://192.168.1.20:49231/api/v1/whoami")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer em_secret")
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/json")
    }

    @Test func statusNeedsNoToken() {
        let anonymous = APIClient(baseURL: URL(string: "http://h")!, token: nil)
        #expect(anonymous.urlRequest(for: .status).value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func keepsABasePathFromAProxy() {
        let proxied = APIClient(baseURL: URL(string: "https://home.example/memory/")!, token: nil)
        #expect(proxied.urlRequest(for: .projects).url?.absoluteString == "https://home.example/memory/api/v1/projects")
    }

    @Test func encodesSearchQueriesStrictlyAndDropsEmptyFilters() {
        let request = client.urlRequest(for: .search("C++ & ESP32 = fun", filter: ItemFilter(project: "p1", type: .note, tag: nil, limit: 20)))
        #expect(request.url?.query(percentEncoded: true) == "q=C%2B%2B%20%26%20ESP32%20%3D%20fun&project=p1&type=note&limit=20")
    }

    @Test func encodesPathSegments() {
        #expect(client.urlRequest(for: .briefing("Home Lab")).url?.absoluteString == "http://192.168.1.20:49231/api/v1/projects/Home%20Lab")
    }

    @Test func taskListDefaultsToActive() {
        #expect(client.urlRequest(for: .tasks()).url?.query() == "status=active")
    }

    @Test func captureBodyOmitsMissingFields() throws {
        let endpoint = try Endpoint.capture(CaptureRequest(url: "https://example.com", title: "Example", tags: ["a", "b"]))
        let request = client.urlRequest(for: endpoint)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let body = try #require(request.httpBody)
        #expect(String(decoding: body, as: UTF8.self) == #"{"tags":["a","b"],"title":"Example","url":"https:\/\/example.com"}"#)
    }

    @Test func newTaskCarriesDueAndPriority() throws {
        let endpoint = try Endpoint.createItem(NewItemRequest(type: .task, title: "Build rig", project: "p1", due: "2026-09-30", priority: .high))
        let json = try JSONSerialization.jsonObject(with: #require(endpoint.body)) as? [String: String]
        #expect(json == ["type": "task", "title": "Build rig", "project": "p1", "due": "2026-09-30", "priority": "high"])
    }

    @Test func fileUploadPercentEncodesMetadataHeaders() {
        let endpoint = Endpoint.upload(FileUpload(filename: "Relevé été.pdf", mimeType: "application/pdf", title: "Q3, final",
                                                  note: nil, project: "Home Lab", tags: ["tax", "2026"]))
        let request = client.urlRequest(for: endpoint)
        #expect(request.url?.path() == "/api/v1/files")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/pdf")
        #expect(request.value(forHTTPHeaderField: "X-Filename") == "Relev%C3%A9%20%C3%A9t%C3%A9.pdf")
        #expect(request.value(forHTTPHeaderField: "X-Title") == "Q3%2C%20final")
        #expect(request.value(forHTTPHeaderField: "X-Project") == "Home%20Lab")
        #expect(request.value(forHTTPHeaderField: "X-Tags") == "tax%2C2026")
        #expect(request.value(forHTTPHeaderField: "X-Note") == nil)
    }

    @Test func downloadNamesCannotEscapeTheFolder() {
        #expect(APIClient.safeFilename("../../etc/passwd") == ".._.._etc_passwd")
        #expect(APIClient.safeFilename("..") == "file")
        #expect(APIClient.safeFilename("report.pdf") == "report.pdf")
    }
}

@Suite struct ErrorMappingTests {
    @Test func mapsTheErrorEnvelope() async throws {
        let server = StubServer { _ in (404, try Fixture.data("error-not-found")) }
        await #expect(throws: APIError.server(status: 404, code: .notFound, message: #"No item with id "nope"."#)) {
            try await server.client().item("nope")
        }
    }

    @Test func unauthorizedIsRecognizedAndRetryable() async throws {
        let server = StubServer { _ in (401, try Fixture.data("error-unauthorized")) }
        let error = await #expect(throws: APIError.self) { try await server.client().whoami() }
        #expect(error?.isUnauthorized == true)
        #expect(error?.isRetryable == true)
    }

    @Test func validationErrorsAreNotRetryable() async throws {
        let server = StubServer { _ in (400, Data(#"{"error":{"code":"invalid","message":"Title is required."}}"#.utf8)) }
        let error = await #expect(throws: APIError.self) { try await server.client().createItem(NewItemRequest(type: .task)) }
        #expect(error == .server(status: 400, code: .invalid, message: "Title is required."))
        #expect(error?.isRetryable == false)
        #expect(error?.localizedDescription == "Title is required.")
    }

    @Test func forbiddenHostExplainsLanMode() async throws {
        let server = StubServer { _ in (403, Data(#"{"error":{"code":"forbidden_host","message":"Requests must be addressed to localhost."}}"#.utf8)) }
        let error = await #expect(throws: APIError.self) { try await server.client().whoami() }
        #expect(error?.localizedDescription.contains("--lan") == true)
    }

    @Test func nonEnvelopeErrorsKeepTheStatus() async throws {
        let server = StubServer { _ in (502, Data("<html>Bad gateway</html>".utf8)) }
        let error = await #expect(throws: APIError.self) { try await server.client().projects() }
        #expect(error == .unexpectedResponse(status: 502))
        #expect(error?.isRetryable == true)
    }

    @Test func connectionFailuresAreUnreachable() async throws {
        let client = APIClient(baseURL: URL(string: "http://nobody-\(UUID().uuidString).test")!, token: "em_x", session: StubServer.session)
        let error = await #expect(throws: APIError.self) { try await client.status() }
        #expect(error == .unreachable(.cannotConnectToHost))
        #expect(error?.isRetryable == true)
    }

    @Test func unexpectedJSONIsADecodingError() async throws {
        let server = StubServer { _ in (200, Data(#"{"hello":1}"#.utf8)) }
        let error = await #expect(throws: APIError.self) { try await server.client().status() }
        guard case .decoding = error else { Issue.record("expected decoding, got \(String(describing: error))"); return }
    }

    @Test func sendsTheTokenAndDecodesTheResponse() async throws {
        let server = StubServer { _ in (200, try Fixture.data("whoami")) }
        let me = try await server.client(token: "em_abc").whoami()
        #expect(me.name == "Fixture Capture")
        #expect(server.requests.first?.request.value(forHTTPHeaderField: "Authorization") == "Bearer em_abc")
    }
}
