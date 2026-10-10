# Lane D — iOS companion (SwiftUI, auth, contact picker, status; widget if ahead)

You own the SwiftUI companion app: sign-in, phone linking, event list/create, contact selection, event status. Ticket **T6**; the Home Screen widget is **P2** and only happens after M3 if everything else is green.

The app is setup and status, **not** a chat UI (ADR-002). P0 doesn't depend on it (ADR-013), so never block another lane; your job is a credible, honest status view for the demo.

## Read first

1. `AGENTS.md`
2. `docs/07-ios-companion.md` (all of it)
3. `docs/06-workflows.md#status-vocabulary` — the only labels the UI may show
4. `docs/03-data-model.md#canonical-state-enums`
5. `docs/10-security-privacy.md` — app identity, consent, data minimization
6. `docs/17-workstreams.md` — the query/mutation names you call

## You own

`ios/` only. You consume `events.myEvents`, `events.detail`, `events.create`, `tasks.create`, `invitations.createForContacts` and the phone-link flow. If you need a new query or field, open a `contract:` PR (Lane B reviews); don't edit `convex/` files directly.

## Step 0 (hour 0, no backend needed)

- Create the Xcode project at `ios/Rally/` (SwiftUI, iOS target matching team devices).
- Choose the auth provider that the current Convex Swift client docs support (`docs/15-sources.md` links), and that you can set up in under an hour. Record the choice in `docs/14` (blocking Q4).
- Spike `CNContactPickerViewController` in a SwiftUI wrapper; confirm it returns only selected contacts without requesting full Contacts access.

## Tasks, in order

1. **Contract mirror.** Swift `Codable` types for the read models and an enum for each display label in `06#status-vocabulary`. Unknown label from the server → show a neutral "Unknown" state, never guess.
2. **Mock-first UI.** Build all screens from `07` (`AuthGate`, `EventListView`, `EventCreateView` + `NativeContactPicker`, `EventDetailView` with Participants/Tasks/AgentActivity, `OnboardingAndLinkPhoneView`) against a local mock client using the shared fixture data. This keeps you unblocked until B's queries are real.
3. **Auth.** Real sign-in wired to Convex auth. No client-supplied user IDs anywhere. Restrict to a few test accounts if needed.
4. **Contact flow.** Picker → normalize to E.164 locally → review screen → `invitations.createForContacts`. Show "Waiting for them to text Rally" for `invited`, never "Joined". Nothing in the app sends messages to contacts.
5. **Phone link.** Show the one-time code and the instruction to text `JOIN <code>` to the Rally number Photon actually provisions (don't promise a single shared number; see `04`).
6. **Live status.** Swap the mock client for the Convex Swift client with reactive subscriptions to `events.myEvents` / `events.detail`. Confirmed vs proposed shown distinctly and not by color alone; show stale/offline state when the subscription drops.
7. **Accessibility.** Dynamic Type, VoiceOver labels, loading/empty/error states. No real phone numbers in screenshots.
8. **Widget (P2, only after M3 if green).** One card per `07`; no claims of real-time updates.

## Tests you must make pass

T6 ticket tests in `docs/16`: selected contacts only; pending vs confirmed distinction; forbidden access blocked (another user's event never appears). ST-15 (P1): the app shows the same confirmed state as the iMessage trace. Use XCTest for label mapping and the mock client.

## Done when (for M2)

On a real device: sign in, see seeded Charity 5K, create a test event, pick a contact (invitation shows "Waiting for them to text Rally"), and watch the setup task move from `awaiting_participant` to `confirmed` when Jordan replies YES over iMessage. Evidence: screen recording with fake numbers, test output.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** Include the auth provider chosen and anything about TestFlight/device install that affects the demo.
