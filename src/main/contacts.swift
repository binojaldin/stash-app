import Foundation
import Contacts

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: contacts_helper <phone_or_email>\n", stderr)
    exit(1)
}

let identifier = CommandLine.arguments[1]
let store = CNContactStore()

let semaphore = DispatchSemaphore(value: 0)
var resultName = ""

store.requestAccess(for: .contacts) { granted, _ in
    guard granted else {
        semaphore.signal()
        return
    }

    let keysToFetch = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]

    // Try phone number lookup
    if identifier.contains("@") {
        // Email lookup
        let predicate = CNContact.predicateForContacts(matchingEmailAddress: identifier)
        if let contacts = try? store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch),
           let contact = contacts.first {
            let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
            if !name.isEmpty {
                resultName = name
            }
        }
    } else {
        // Phone number lookup
        let digits = identifier.filter { $0.isNumber || $0 == "+" }
        let phoneNumber = CNPhoneNumber(stringValue: digits)
        let predicate = CNContact.predicateForContacts(matching: phoneNumber)
        if let contacts = try? store.unifiedContacts(matching: predicate, keysToFetch: keysToFetch),
           let contact = contacts.first {
            let name = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
            if !name.isEmpty {
                resultName = name
            }
        }
    }

    semaphore.signal()
}

semaphore.wait()
print(resultName)
