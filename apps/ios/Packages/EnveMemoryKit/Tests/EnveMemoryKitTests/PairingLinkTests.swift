import Foundation
import Testing
@testable import EnveMemoryKit

@Suite struct PairingLinkTests {
    @Test func parsesTheLinkTheCLIPrints() throws {
        let link = try PairingLink(parsing: "enve-memory://pair?url=http%3A%2F%2F10.0.0.115%3A49871&token=em_AqPwcHzUCLMsVREUYXV_TLv5ovSQ4IqfteAsSuMQYxE&name=iPhone+Sim")
        #expect(link.baseURL == URL(string: "http://10.0.0.115:49871"))
        #expect(link.token == "em_AqPwcHzUCLMsVREUYXV_TLv5ovSQ4IqfteAsSuMQYxE")
        #expect(link.name == "iPhone Sim")
    }

    @Test func acceptsPercentEncodedSpacesUnicodeAndSurroundingWhitespace() throws {
        let link = try PairingLink(parsing: "  enve-memory://pair?name=Sam%E2%80%99s%20iPhone&token=em_abc&url=https%3A%2F%2Fmac.tail1234.ts.net%2F \n")
        #expect(link.name == "Sam’s iPhone")
        #expect(link.baseURL == URL(string: "https://mac.tail1234.ts.net"))
    }

    @Test func nameIsOptional() throws {
        let link = try PairingLink(parsing: "enve-memory://pair?url=http%3A%2F%2F127.0.0.1%3A49231&token=em_x")
        #expect(link.name == nil)
    }

    @Test func keepsATokenContainingPlusAsSent() throws {
        let link = try PairingLink(parsing: "enve-memory://pair?url=http%3A%2F%2F127.0.0.1&token=em_a%2Bb")
        #expect(link.token == "em_a+b")
    }

    @Test(arguments: [
        ("https://example.com/pair?url=x&token=em_x", PairingLink.ParseError.notAPairingLink),
        ("enve-memory://open?url=http%3A%2F%2Fa&token=em_x", .notAPairingLink),
        ("not a link", .notAPairingLink),
        ("enve-memory://pair?token=em_x", .missingURL),
        ("enve-memory://pair?url=&token=em_x", .missingURL),
        ("enve-memory://pair?url=ftp%3A%2F%2Fhost&token=em_x", .invalidURL),
        ("enve-memory://pair?url=http%3A%2F%2F&token=em_x", .invalidURL),
        ("enve-memory://pair?url=192.168.1.20%3A49231&token=em_x", .invalidURL),
        ("enve-memory://pair?url=http%3A%2F%2Fa", .missingToken),
        ("enve-memory://pair?url=http%3A%2F%2Fa&token=", .missingToken),
        ("enve-memory://pair?url=http%3A%2F%2Fa&token=abc", .invalidToken),
        ("enve-memory://pair?url=http%3A%2F%2Fa&token=em_", .invalidToken),
    ])
    func rejects(_ raw: String, _ expected: PairingLink.ParseError) {
        #expect(throws: expected) { try PairingLink(parsing: raw) }
    }

    @Test func normalizesManuallyTypedServerURLs() {
        #expect(PairingLink.serverURL(" http://192.168.1.20:49231/ ") == URL(string: "http://192.168.1.20:49231"))
        #expect(PairingLink.serverURL("HTTP://Mac.local:49231") != nil)
        #expect(PairingLink.serverURL("192.168.1.20:49231") == nil)
        #expect(PairingLink.serverURL("http://host/?x=1") == nil)
    }
}
