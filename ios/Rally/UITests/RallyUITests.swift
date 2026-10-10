import XCTest

@MainActor
final class RallyUITests: XCTestCase {
    func testDemoSeparatesConfirmedAndProposedAssignments() {
        let app = XCUIApplication()
        app.launch()
        enterDemo(app)
        app.buttons["event-event_charity_5k"].tap()
        XCTAssertTrue(app.staticTexts["Confirmed: Maya"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Proposed: Jordan"].exists)
        XCTAssertTrue(app.staticTexts["Demo · local data"].exists)
        capture(app, name: "Demo pending assignment")
        let accept = app.buttons["Simulate Jordan accepting"]
        reveal(accept, in: app)
        accept.tap()
        app.swipeDown()
        app.swipeDown()
        app.swipeDown()
        XCTAssertTrue(app.staticTexts["Confirmed: Jordan"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Proposed: Jordan"].exists)
        capture(app, name: "Demo simulated acceptance")
    }

    func testCreateEventAppearsInDemoList() {
        let app = XCUIApplication()
        app.launch()
        enterDemo(app)
        app.buttons["Create an event"].tap()
        let title = app.textFields["eventTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Team picnic")
        app.buttons["saveEvent"].tap()
        XCTAssertTrue(app.staticTexts["Team picnic"].waitForExistence(timeout: 5))
    }

    func testReviewedFictionalContactStaysInvited() {
        let app = XCUIApplication()
        app.launch()
        enterDemo(app)
        app.buttons["event-event_charity_5k"].tap()
        let invite = app.buttons["Invite people"]
        reveal(invite, in: app)
        invite.tap()
        app.buttons["useFictionalContact"].tap()
        let create = app.buttons["createInvitations"]
        reveal(create, in: app)
        create.tap()
        XCTAssertTrue(app.staticTexts["Invitations created"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Casey"].exists)
        XCTAssertTrue(app.staticTexts["These demo codes cannot be redeemed."].exists)
        capture(app, name: "Demo invitation handoff")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Casey"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Waiting for them to text Rally"].firstMatch.exists)
    }

    func testLargeTextWelcomeAndPhoneLinkUnavailable() {
        let app = XCUIApplication()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        capture(app, name: "Welcome large type")
        enterDemo(app)
        let connect = app.buttons["Connect iMessage"]
        reveal(connect, in: app)
        connect.tap()
        let unavailable = app.staticTexts["Phone linking is not available in this build."]
        reveal(unavailable, in: app)
        XCTAssertTrue(unavailable.exists)
    }

    func testNativePickerCancellationDoesNotSelectContacts() {
        let app = XCUIApplication()
        app.launch()
        enterDemo(app)
        app.buttons["event-event_charity_5k"].tap()
        let invite = app.buttons["Invite people"]
        reveal(invite, in: app)
        invite.tap()
        app.buttons["chooseContacts"].tap()
        XCTAssertTrue(app.navigationBars["Contacts"].waitForExistence(timeout: 5))
        capture(app, name: "Native contact picker")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["No one selected yet."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["createInvitations"].isEnabled)
        app.buttons["chooseContacts"].tap()
        XCTAssertTrue(app.navigationBars["Contacts"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["No one selected yet."].waitForExistence(timeout: 5))
    }

    private func enterDemo(_ app: XCUIApplication) {
        let button = app.buttons["exploreDemo"]
        reveal(button, in: app)
        button.tap()
        XCTAssertTrue(app.navigationBars["Rally"].waitForExistence(timeout: 5))
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<10 {
            if element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }

    private func capture(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
