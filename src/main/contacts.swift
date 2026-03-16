import Foundation
import Contacts

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    fputs("Usage: contacts_helper <phone_or_email> [phone_or_email ...]\n", stderr)
    exit(1)
}

let store = CNContactStore()
let semaphore = DispatchSemaphore(value: 0)
var results = [String](repeating: "", count: args.count)

store.requestAccess(for: .contacts) { granted, _ in
    guard granted else { semaphore.signal(); return }

    let keysToFetch = [
        CNContactGivenNameKey, CNContactFamilyNameKey,
        CNContactPhoneNumbersKey, CNContactEmailAddressesKey
    ] as [CNKeyDescriptor]

    for (i, identifier) in args.enumerated() {
        var contact: CNContact? = nil
        if identifier.contains("@") {
            let predicate = CNContact.predicateForContacts(matchingEmailAddress: identifier)
            contact = (try? store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch))?.first
        } else {
            let digits = identifier.filter { $0.isNumber || $0 == "+" }
            if !digits.isEmpty {
                let phoneNumber = CNPhoneNumber(stringValue: digits)
                let predicate = CNContact.predicateForContacts(matching: phoneNumber)
                contact = (try? store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch))?.first
            }
        }
        if let contact = contact {
            let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { results[i] = name }
        }
    }
    semaphore.signal()
}

semaphore.wait()
for result in results { print(result) }
