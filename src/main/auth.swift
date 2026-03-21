import Foundation
import LocalAuthentication
import CommonCrypto

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    fputs("Usage: auth_helper <command> [args...]\n", stderr)
    fputs("Commands: can-touch-id, touch-id, hash <password> <salt>, verify <password> <salt> <hash>\n", stderr)
    exit(1)
}

// PBKDF2-HMAC-SHA256, 310_000 iterations (OWASP 2023 recommendation)
func pbkdf2(password: String, salt: Data, iterations: Int = 310_000, keyLength: Int = 32) -> Data {
    var derivedKey = Data(count: keyLength)
    let passwordData = password.data(using: .utf8)!
    _ = derivedKey.withUnsafeMutableBytes { derivedKeyBytes in
        salt.withUnsafeBytes { saltBytes in
            passwordData.withUnsafeBytes { passwordBytes in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    passwordBytes.baseAddress!.assumingMemoryBound(to: Int8.self),
                    passwordData.count,
                    saltBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    UInt32(iterations),
                    derivedKeyBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    keyLength
                )
            }
        }
    }
    return derivedKey
}

func generateSalt(length: Int = 32) -> Data {
    var salt = Data(count: length)
    salt.withUnsafeMutableBytes { bytes in
        _ = SecRandomCopyBytes(kSecRandomDefault, length, bytes.baseAddress!.assumingMemoryBound(to: UInt8.self))
    }
    return salt
}

switch command {
case "can-touch-id":
    let context = LAContext()
    var error: NSError?
    if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
        print("yes")
    } else {
        print("no")
    }

case "touch-id":
    let reason = args.count > 1 ? args[1] : "Unlock Stash to access your messages"
    let context = LAContext()
    context.localizedFallbackTitle = "Use Password"
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
        print("failed")
        exit(0)
    }
    let semaphore = DispatchSemaphore(value: 0)
    var result = "failed"
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, evalError in
        if success {
            result = "success"
        } else if let err = evalError as? LAError, err.code == .userFallback {
            result = "fallback"
        } else {
            result = "failed"
        }
        semaphore.signal()
    }
    semaphore.wait()
    print(result)

case "hash":
    // hash <password> → prints salt:hash as hex
    guard args.count >= 2 else { fputs("Usage: auth_helper hash <password>\n", stderr); exit(1) }
    let password = args[1]
    let salt = generateSalt()
    let hash = pbkdf2(password: password, salt: salt)
    print("\(salt.map { String(format: "%02x", $0) }.joined()):\(hash.map { String(format: "%02x", $0) }.joined())")

case "verify":
    // verify <password> <salt_hex> <hash_hex> → prints "yes" or "no"
    guard args.count >= 4 else { fputs("Usage: auth_helper verify <password> <salt_hex> <hash_hex>\n", stderr); exit(1) }
    let password = args[1]
    let saltHex = args[2]
    let expectedHashHex = args[3]

    // Parse hex salt
    var saltBytes = [UInt8]()
    var idx = saltHex.startIndex
    while idx < saltHex.endIndex {
        let next = saltHex.index(idx, offsetBy: 2, limitedBy: saltHex.endIndex) ?? saltHex.endIndex
        if let byte = UInt8(saltHex[idx..<next], radix: 16) { saltBytes.append(byte) }
        idx = next
    }
    let salt = Data(saltBytes)

    let computed = pbkdf2(password: password, salt: salt)
    let computedHex = computed.map { String(format: "%02x", $0) }.joined()

    if computedHex == expectedHashHex {
        print("yes")
    } else {
        print("no")
    }

default:
    fputs("Unknown command: \(command)\n", stderr)
    exit(1)
}
