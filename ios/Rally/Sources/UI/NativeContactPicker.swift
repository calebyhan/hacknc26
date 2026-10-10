import SwiftUI
import ContactsUI

struct ContactDraft: Identifiable {
    let id = UUID()
    var displayName: String
    var phone: String
}

/// A property picker: choosing a specific number avoids silently picking the first
/// phone on a contact. No CNContactStore fetch or full Contacts permission is used.
struct NativeContactPicker: UIViewControllerRepresentable {
    let onSelect: (ContactDraft) -> Void
    let onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> CNContactPickerViewController {
        let picker = CNContactPickerViewController()
        picker.delegate = context.coordinator
        picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
        picker.predicateForEnablingContact = NSPredicate(format: "phoneNumbers.@count > 0")
        picker.predicateForSelectionOfContact = NSPredicate(value: false)
        picker.predicateForSelectionOfProperty = NSPredicate(format: "key == 'phoneNumbers'")
        return picker
    }

    func updateUIViewController(_ controller: CNContactPickerViewController, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, @preconcurrency CNContactPickerDelegate {
        let parent: NativeContactPicker
        init(parent: NativeContactPicker) { self.parent = parent }

        func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
            guard contactProperty.key == CNContactPhoneNumbersKey,
                  let number = contactProperty.value as? CNPhoneNumber else { return }
            let contact = contactProperty.contact
            let name = CNContactFormatter.string(from: contact, style: .fullName) ?? "Selected contact"
            parent.onSelect(ContactDraft(displayName: name, phone: number.stringValue))
        }

        func contactPickerDidCancel(_ picker: CNContactPickerViewController) { parent.onCancel() }
    }
}
