import Foundation
import Testing
import UniformTypeIdentifiers
@testable import EnveMemoryKit

@MainActor
@Suite struct ShareItemLoaderTests {
    let staging = FileManager.default.temporaryDirectory.appending(path: "staging-\(UUID().uuidString)")
    var loader: ShareItemLoader { ShareItemLoader(stagingDirectory: staging) }

    func tempFile(_ name: String, _ contents: Data) throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name)
        try contents.write(to: url)
        return url
    }

    @Test func webPageBecomesALinkTitledByTheShareText() async throws {
        let provider = NSItemProvider(object: URL(string: "https://example.com/article")! as NSURL)
        let content = try await loader.load([provider], contentText: "A Great Article")
        #expect(content == .link(URL(string: "https://example.com/article")!, title: "A Great Article"))
    }

    @Test func linkTitleIgnoresTextThatIsJustTheURL() async throws {
        let url = URL(string: "https://example.com")!
        let content = try await loader.load([NSItemProvider(object: url as NSURL)], contentText: "https://example.com")
        #expect(content == .link(url, title: nil))
    }

    @Test func plainTextBecomesText() async throws {
        let provider = NSItemProvider(object: "Remember the torsion spring" as NSString)
        #expect(try await loader.load([provider], contentText: nil) == .text("Remember the torsion spring"))
    }

    @Test func textThatIsAURLBecomesALink() async throws {
        let provider = NSItemProvider(object: " https://example.com/x \n" as NSString)
        #expect(try await loader.load([provider], contentText: nil) == .link(URL(string: "https://example.com/x")!, title: nil))
    }

    @Test func fileIsStagedWithItsNameAndMimeType() async throws {
        let source = try tempFile("notes.md", Data("# Hi".utf8))
        let provider = try #require(NSItemProvider(contentsOf: source))
        let content = try await loader.load([provider], contentText: nil)
        guard case .files(let files) = content, let file = files.first else { Issue.record("expected files, got \(content)"); return }
        #expect(file.filename == "notes.md")
        #expect(file.mimeType == "text/markdown")
        #expect(file.url.path().hasPrefix(staging.path()))
        #expect(try Data(contentsOf: file.url) == Data("# Hi".utf8))
    }

    @Test func imageDataWithSuggestedNameGetsAnExtension() async throws {
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: UTType.png.identifier, visibility: .all) { completion in
            completion(png, nil)
            return nil
        }
        provider.suggestedName = "Garage photo"
        let content = try await loader.load([provider], contentText: nil)
        guard case .files(let files) = content, let file = files.first else { Issue.record("expected files, got \(content)"); return }
        #expect(file.filename == "Garage photo.png")
        #expect(file.mimeType == "image/png")
    }

    @Test func filesWinOverAccompanyingText() async throws {
        let pdf = try tempFile("manual.pdf", Data("%PDF-1.4".utf8))
        let providers = [try #require(NSItemProvider(contentsOf: pdf)), NSItemProvider(object: "caption" as NSString)]
        guard case .files(let files) = try await loader.load(providers, contentText: nil) else { Issue.record("expected files"); return }
        #expect(files.map(\.mimeType) == ["application/pdf"])
    }

    @Test func nothingUsableThrows() async {
        await #expect(throws: ShareItemLoader.LoadError.self) { try await loader.load([], contentText: "  ") }
    }

    @Test func classifiesProviderTypes() {
        #expect(ShareItemLoader.classify(["public.url"]) == .url)
        #expect(ShareItemLoader.classify(["public.utf8-plain-text"]) == .text)
        #expect(ShareItemLoader.classify(["public.heic", "public.jpeg"]) == .file(.heic))
        #expect(ShareItemLoader.classify(["net.daringfireball.markdown", "public.file-url", "public.url"]) == .file(UTType("net.daringfireball.markdown")))
        #expect(ShareItemLoader.classify(["com.adobe.pdf"]) == .file(.pdf))
        #expect(ShareItemLoader.classify(["public.zip-archive"]) == .file(.zip))
        #expect(ShareItemLoader.classify([]) == nil)
    }
}

@Suite struct SharePayloadTests {
    @Test func linkPostsToCaptureWithFormFields() throws {
        let form = ShareForm(title: "", note: " Worth a read ", projectID: "p1", tags: "esp32, #hardware,")
        let captures = try SharePayload.captures(for: .link(URL(string: "https://example.com/a")!, title: "Page Title"), form: form)
        #expect(captures.count == 1)
        let capture = captures[0]
        #expect(capture.endpoint.path == "/capture")
        #expect(capture.kind == .link)
        #expect(capture.title == "Page Title")
        let body = try JSONCoding.makeDecoder().decode(CaptureRequest.self, from: #require(capture.endpoint.body))
        #expect(body == CaptureRequest(url: "https://example.com/a", title: "Page Title", note: "Worth a read", project: "p1", tags: ["esp32", "hardware"]))
    }

    @Test func userTitleOverridesPageTitle() throws {
        let captures = try SharePayload.captures(for: .link(URL(string: "https://example.com")!, title: "Page"), form: ShareForm(title: "Mine"))
        let body = try JSONCoding.makeDecoder().decode(CaptureRequest.self, from: #require(captures[0].endpoint.body))
        #expect(body.title == "Mine")
        #expect(body.tags == nil)
        #expect(body.note == nil)
    }

    @Test func textIsSentAsASelection() throws {
        let captures = try SharePayload.captures(for: .text("quoted words"), form: ShareForm(note: "why I kept this"))
        let body = try JSONCoding.makeDecoder().decode(CaptureRequest.self, from: #require(captures[0].endpoint.body))
        #expect(body == CaptureRequest(selection: "quoted words", note: "why I kept this"))
        #expect(captures[0].kind == .note)
    }

    @Test func eachFileIsItsOwnUpload() throws {
        let files = [
            SharedFile(url: URL(filePath: "/tmp/a.pdf"), filename: "a.pdf", mimeType: "application/pdf"),
            SharedFile(url: URL(filePath: "/tmp/b.jpg"), filename: "b.jpg", mimeType: "image/jpeg"),
        ]
        let captures = try SharePayload.captures(for: .files(files), form: ShareForm(title: "Ignored for many", note: "n", projectID: "p1", tags: "scan"))
        #expect(captures.map(\.endpoint.path) == ["/files", "/files"])
        #expect(captures.map(\.file) == files.map(\.url))
        #expect(captures[0].endpoint.headers["X-Title"] == nil)
        #expect(captures[1].endpoint.headers["Content-Type"] == "image/jpeg")
        #expect(captures[1].endpoint.headers["X-Tags"] == "scan")
        #expect(captures[1].endpoint.headers["X-Project"] == "p1")
    }

    @Test func singleFileKeepsTheTitle() throws {
        let file = SharedFile(url: URL(filePath: "/tmp/a.pdf"), filename: "a.pdf", mimeType: "application/pdf")
        let captures = try SharePayload.captures(for: .files([file]), form: ShareForm(title: "Opener manual"))
        #expect(captures[0].endpoint.headers["X-Title"] == "Opener%20manual")
        #expect(captures[0].title == "Opener manual")
    }

    @Test func tagParsing() {
        #expect(Tags.parse(" a, #b ,, c d ") == ["a", "b", "c d"])
        #expect(Tags.parse("") == [])
    }
}
