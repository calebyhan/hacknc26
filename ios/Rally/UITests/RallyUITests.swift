import XCTest

@MainActor
final class RallyUITests: XCTestCase {
    private func localApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["--rally-local-tests"]
        return app
    }

    func testDemoSeparatesConfirmedAndProposedAssignments() {
        let app = localApp()
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
        for _ in 0..<10 {
            if app.staticTexts["Confirmed: Jordan"].isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(app.staticTexts["Confirmed: Jordan"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Proposed: Jordan"].exists)
        capture(app, name: "Demo simulated acceptance")
    }

    func testCreateDraftTimedTaskThenConfirmAndRequestOrganizerCode() {
        let app = localApp()
        app.launch()
        enterDemo(app)
        completeDemoPhoneProof(app)
        app.buttons["Done"].tap()
        let createEvent = app.buttons["Create an event"]
        reveal(createEvent, in: app)
        createEvent.tap()
        let title = app.textFields["eventTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Team picnic")
        app.buttons["saveEvent"].tap()
        XCTAssertTrue(app.staticTexts["Team picnic"].waitForExistence(timeout: 5))
        app.staticTexts["Team picnic"].tap()
        XCTAssertTrue(app.staticTexts["Draft"].waitForExistence(timeout: 5))
        let addTask = app.buttons["Add a task"]
        reveal(addTask, in: app)
        addTask.tap()
        let taskTitle = app.textFields["taskTitle"]
        XCTAssertTrue(taskTitle.waitForExistence(timeout: 5))
        taskTitle.tap()
        taskTitle.typeText("Bring snacks")
        let people = app.steppers["taskCapacity"]
        reveal(people, in: app)
        people.buttons["taskCapacity-Increment"].tap()
        people.buttons["taskCapacity-Increment"].tap()
        XCTAssertTrue(app.staticTexts["People needed: 3"].exists)
        app.buttons["saveTask"].tap()
        XCTAssertTrue(app.staticTexts["Bring Snacks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["0 of 3 people confirmed"].waitForExistence(timeout: 5))
        app.swipeDown()
        let confirm = app.buttons["confirmEvent"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        app.buttons["Schedule event"].tap()
        let organizer = app.buttons["organizerInvitation"]
        reveal(organizer, in: app)
        organizer.tap()
        XCTAssertTrue(app.staticTexts["This is a simulated code and cannot be redeemed."].waitForExistence(timeout: 5))
        let notice = app.staticTexts["The event is scheduled. Tasks still require participant acceptance."]
        reveal(notice, in: app)
        XCTAssertTrue(notice.exists)
        XCTAssertFalse(app.staticTexts["Confirmed: Alex"].exists)
        capture(app, name: "Demo scheduled event and separate organizer code")
    }

    func testReviewedFictionalContactStaysInvited() {
        let app = localApp()
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

    func testLargeTextWelcomeAndPhoneLinkInstructions() {
        let app = localApp()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        capture(app, name: "Welcome large type")
        enterDemo(app)
        let connect = app.buttons["Connect iMessage"]
        reveal(connect, in: app)
        connect.tap()
        let instructions = app.staticTexts["Connect your own phone"]
        reveal(instructions, in: app)
        XCTAssertTrue(instructions.exists)
        let phone = app.textFields["linkPhoneNumber"]
        reveal(phone, in: app)
        XCTAssertTrue(phone.exists)
        capture(app, name: "Phone linking large type")
    }

    func testPhoneCodeRequiresExplicitSimulatedProof() {
        let app = localApp()
        app.launch()
        enterDemo(app)
        completeDemoPhoneProof(app)
        capture(app, name: "Phone linked only after explicit demo proof")
    }

    func testVerifiedDemoRouteStaysDisabledAndStatusSeparatesDelivery() {
        let app = localApp()
        app.launch()
        enterDemo(app)
        XCTAssertTrue(app.staticTexts["progress-event_charity_5k"].waitForExistence(timeout: 5))
        completeDemoPhoneProof(app)
        let route = app.buttons["openRallyMessages"]
        reveal(route, in: app)
        XCTAssertFalse(route.isEnabled)
        capture(app, name: "Demo verified route is disabled")
        app.buttons["Done"].tap()
        for _ in 0..<10 {
            if app.buttons["event-event_charity_5k"].isHittable { break }
            app.swipeDown()
        }
        app.buttons["event-event_charity_5k"].tap()
        let consent = app.staticTexts["eventMessagingStatus"]
        reveal(consent, in: app)
        XCTAssertEqual(consent.label, "Event messages enabled")
        reveal(route, in: app)
        XCTAssertFalse(route.isEnabled)
        let delivery = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Sent to messaging service")).firstMatch
        reveal(delivery, in: app)
        XCTAssertTrue(delivery.exists)
        XCTAssertFalse(app.staticTexts["Delivered"].exists)
        capture(app, name: "Demo consent and own delivery status")
    }

    private func completeDemoPhoneProof(_ app: XCUIApplication) {
        let connect = app.buttons["Connect iMessage"]
        reveal(connect, in: app)
        connect.tap()
        let phone = app.textFields["linkPhoneNumber"]
        XCTAssertTrue(phone.waitForExistence(timeout: 5))
        phone.tap()
        phone.typeText("+15555550123")
        let request = app.buttons["requestPhoneCode"]
        reveal(request, in: app)
        request.tap()
        XCTAssertTrue(app.staticTexts["phoneJoinCode"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Demo phone proof simulated"].exists)
        let check = app.buttons["checkPhoneProof"]
        reveal(check, in: app)
        check.tap()
        XCTAssertFalse(app.staticTexts["Demo phone proof simulated"].exists)
        let simulate = app.buttons["simulatePhoneJoin"]
        reveal(simulate, in: app)
        simulate.tap()
        XCTAssertTrue(app.staticTexts["Demo phone proof simulated"].waitForExistence(timeout: 5))
    }

    func testOrganizerApprovalDoesNotConfirmParticipant() {
        let app = localApp()
        app.launch()
        enterDemo(app)
        app.buttons["event-event_hack_night"].tap()
        let approve = app.buttons["approve-proposal_simulated_organizer_review"]
        reveal(approve, in: app)
        approve.tap()
        let notice = app.staticTexts["Organizer approval is recorded. The participant still needs to respond."]
        reveal(notice, in: app)
        XCTAssertTrue(notice.waitForExistence(timeout: 5))
        XCTAssertFalse(approve.exists)
        XCTAssertFalse(app.staticTexts["Confirmed: Alex"].exists)
        capture(app, name: "Organizer approval still awaits participant")
    }

    func testNativePickerCancellationDoesNotSelectContacts() {
        let app = localApp()
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
