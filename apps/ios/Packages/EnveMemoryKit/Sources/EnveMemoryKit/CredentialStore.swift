import Foundation
import Security

public protocol CredentialStore: Sendable {
    func load() throws -> Pairing?
    func save(_ pairing: Pairing) throws
    func delete() throws
}

public struct KeychainError: Error, Hashable, Sendable, LocalizedError {
    public let status: OSStatus
    public var errorDescription: String? { "Keychain error \(status)." }
}

/// The pairing lives in one generic-password item in a shared access group so the share extension can read it.
public struct KeychainCredentialStore: CredentialStore {
    public let service: String
    public let account: String
    public let accessGroup: String?

    public init(service: String = "com.enve.memory", account: String = "pairing", accessGroup: String? = AppGroup.identifier) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }

    public func load() throws -> Pairing? {
        var query = baseQuery(accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        var status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecMissingEntitlement, accessGroup != nil {
            query[kSecAttrAccessGroup as String] = nil
            status = SecItemCopyMatching(query as CFDictionary, &result)
        }
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw KeychainError(status: status) }
        return try JSONCoding.makeDecoder().decode(Pairing.self, from: data)
    }

    public func save(_ pairing: Pairing) throws {
        let data = try JSONCoding.makeEncoder().encode(pairing)
        try? delete()
        var status = add(data, accessGroup: accessGroup)
        // Unsigned simulator builds carry no keychain-access-groups entitlement; keep the app usable there.
        if status == errSecMissingEntitlement, accessGroup != nil {
            status = add(data, accessGroup: nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func delete() throws {
        var status = SecItemDelete(baseQuery(accessGroup: accessGroup) as CFDictionary)
        if status == errSecMissingEntitlement {
            status = SecItemDelete(baseQuery(accessGroup: nil) as CFDictionary)
        }
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }

    private func add(_ data: Data, accessGroup: String?) -> OSStatus {
        var attributes = baseQuery(accessGroup: accessGroup)
        attributes[kSecValueData as String] = data
        // Background refresh flushes the outbox while the phone is locked.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary, nil)
    }

    private func baseQuery(accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        return query
    }
}

public final class InMemoryCredentialStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var pairing: Pairing?

    public init(_ pairing: Pairing? = nil) { self.pairing = pairing }

    public func load() throws -> Pairing? { lock.withLock { pairing } }
    public func save(_ pairing: Pairing) throws { lock.withLock { self.pairing = pairing } }
    public func delete() throws { lock.withLock { pairing = nil } }
}
