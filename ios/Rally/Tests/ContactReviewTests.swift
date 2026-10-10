import XCTest
@testable import Rally

final class ContactReviewTests: XCTestCase {
    func testReviewedContactTrimsNameAndNormalizesOnlySelectedPhone() throws {
        let contacts = try reviewedInvitationContacts([ContactDraft(displayName: "  Casey  ", phone: "+1 (555) 010-0005")])
        XCTAssertEqual(contacts, [SelectedContact(displayName: "Casey", phoneE164: "+15550100005")])
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(contacts)) as? [[String: String]])
        XCTAssertEqual(json, [["displayName": "Casey", "phoneE164": "+15550100005"]])
    }

    func testEmptyOrMultipleSelectionsAndInvalidReviewAreRejectedBeforeSubmission() {
        XCTAssertThrowsError(try reviewedInvitationContacts([]))
        let contact = ContactDraft(displayName: "Casey", phone: "+15550100005")
        XCTAssertThrowsError(try reviewedInvitationContacts([contact, contact]))
        XCTAssertThrowsError(try reviewedInvitationContacts([ContactDraft(displayName: "  ", phone: contact.phone)]))
        XCTAssertThrowsError(try reviewedInvitationContacts([ContactDraft(displayName: "Casey", phone: "5550100005")]))
    }
}
