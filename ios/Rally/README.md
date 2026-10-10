# Rally iOS companion

Lane D's SwiftUI setup/status app has an explicit in-memory demo and a configurable Convex/Auth0 adapter. The continuation wires the merged A/B account, phone-link, event/task, invitation and approval APIs. Local simulator checks cover these flows; real Auth0/Photon operation and device acceptance remain pending. This does **not** close T6, M2 or ST-15.

## Open and run

Open `Rally.xcodeproj`, select the `Rally` scheme and an Apple Silicon iPhone simulator, then Run. Select **Explore demo**. No account or provider configuration is needed for the demo. Changes and selected contacts remain in memory and are discarded when leaving the demo or restarting the app.

The app includes:

- Registration with the entered display name before protected queries, retryable account setup, and protected-state clearing on sign-out/session expiry.
- Phone-link challenge, expiry/renewal and explicit proof checking. Only successful backend completion enables live event creation. Canonical identity changes discard identity-specific views.
- Draft event creation, task time windows in the event's timezone, and explicit draft confirmation. Date values use integer Unix milliseconds encoded as JSON numbers.
- Organizer event JOIN codes separate from phone linking and organizer membership. Codes send nothing and do not prove event messaging consent.
- Confirmed assignments displayed separately from pending proposals.
- Organizer approval with a fresh authorized read after mutation. Approval never substitutes for participant acceptance; expired offers lose their pending cards and approval controls even while the screen is idle; terminal request rows remain visible.
- A native Contacts phone-property picker and review before invitation creation. One person is invited per submission so the returned code has an unambiguous recipient. No full-address-book permission or `CNContactStore` fetch is used. The app never sends invitations or marks selected people enrolled.
- Clearly labeled local phone-proof and Charity 5K acceptance simulations, plus an organizer-review fixture in Hack Night. No fixture calls a messaging provider.
- Loading, empty, error, disconnected/stale, unknown-status, Dynamic Type and accessibility labels. A query failure clears protected query data; losing connection alone marks it stale. Signing out clears protected views.

The Charity 5K/Hack Night fixture starts from `packages/shared/fixtures.ts`; pending offers, phone proof and an inaccessible event are explicitly added simulation scenarios. Demo behavior is not backend authorization or proof of actual consent. Uncertain event/task/invitation retries preserve the original reviewed input and request key; starting a separate request requires an explicit action.

## Project and dependencies

XcodeGen 2.44.1 generated the checked-in project from `project.yml`. XcodeGen is only needed after adding/removing files or changing project settings:

```sh
cd ios/Rally
xcodegen generate
```

Deployment target: iOS 17. Swift language mode: 6. Dependencies and the SwiftPM lockfile are checked in: Convex Swift 0.8.1, Convex Auth0 0.4.0, Auth0.swift 2.17.0. These versions were verified against their official manifests and compiled locally.

## Live configuration

Copy `Configuration/Local.xcconfig.example` to ignored `Configuration/Local.xcconfig` and fill in the public Convex URL, Auth0 native app domain and client ID. Preserve the URL escaping in the example. A build script generates the provider's `Auth0.plist` resource. Blank configuration disables live sign-in; a live failure never switches to demo.

In Auth0's Native application settings, set both Allowed Callback URLs and Allowed Logout URLs to `dev.rally.companion://YOUR_AUTH0_DOMAIN/ios/dev.rally.companion/callback`, replacing `YOUR_AUTH0_DOMAIN` with the configured domain. This uses the app's current bundle ID and custom URL scheme.

Auth0 requires matching backend verification/provisioning from Lane B. The existing Lane A/B mutations verify phone proof and invitation redemption. See [the Lane D continuation prompt](../../prompts/lane-d-ios-remaining.md) for remaining work, contract gaps and ownership. No provider secret belongs in this app.

No authenticated account/link read API exists yet. After every live sign-in the app conservatively requires a fresh phone-link challenge before creating events, even for an already linked account. Existing authorized events remain readable. Ordinary backend errors have no stable public code, so the adapter shows safe operation-specific retry text instead of parsing or displaying server error strings. SDK auth-state expiry still clears the session; query failures clear protected response data.

## Backend handoff — proposed contracts, not implemented APIs

These additions belong to A/B. Keep current mutations unchanged; agree on additive fields/endpoints and runtime validators before wiring them. Each public query must derive the caller from verified authentication and validate event membership/role where applicable.

| Need | Minimum proposed data and access | Local acceptance required from A/B |
|---|---|---|
| Restore account/phone status | A caller-only account query returning canonical user ID and verified phone-link state; optionally caller-owned pending challenge ID/expiry. Never return another account's phone or trust a client user ID. | Unauthenticated access rejects; provisional-to-canonical merge is reflected; restart restores only server-verified proof; expired/pending challenges never appear verified. |
| Event messaging consent | Current caller's event consent/notification status, separate from membership role/state and global STOP/PAUSE state; event-member authorization. | App-created enrolled organizer is still not opted in; actual JOIN changes consent; STOP/PAUSE/LEAVE are reflected; unrelated events reject. |
| Assigned Rally contact | Verified routing for the current caller and selected event/conversation, with availability and provider-supported destination. Expose another invitee's handoff only under an explicitly authorized invitation contract. | Missing/unprovisioned routing returns unavailable; no universal-number fallback; unrelated event/contact lookup rejects. |
| Activity and progress | Optional aggregate task counts on authorized event summaries; a bounded event-scoped redacted activity feed with domain and delivery states kept distinct. | Counts match committed tasks rather than offers; queued/sent/delivered stay distinct; private contact, budget and unrelated-event data never leak. |
| Stable public errors | Structured error codes for unauthorized/forbidden, proof required, challenge expired, identity conflict, phone change unsupported and version conflict; safe details only. | Assert actual SDK-decoded error envelopes, including production-style redaction; unknown errors stay generic; authorization failures clear protected UI. |

Until these exist, the app does not invent consent badges, progress counts, activity history, delivery/worker health or a deep link to an assumed Rally number. Code-only handoff refers to an existing provisioned Rally conversation.

The user’s intended install is directly from Xcode onto an iPhone 16 Pro running iOS 27.0.1. Choose a signing team in Xcode, connect/trust the device, enable Developer Mode if requested, and Run. Keep team-specific changes local. Actual device pairing/signing and provisioning expiry have not been verified; simulator success does not prove this install path.

## Tests

Normally, select Product → Test in Xcode or run:

```sh
xcodebuild test -project Rally.xcodeproj -scheme Rally \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID'
```

The normal scheme destination resolver previously rejected the installed iOS 26.2 simulators on this machine. A target-only build followed by an `xctestrun` invocation bypasses that resolver without changing Xcode/system files; the fallback is verified with Xcode 27.0:

```sh
./scripts/test-simulator.sh YOUR_SIMULATOR_UDID
```

The script builds arm64 simulator targets, runs the tests and saves the result bundle under ignored `TestResults/`. The combined wrapper passed end to end during merge verification with Xcode 27.0 and an iOS 26.2 simulator (see below). The manifest includes version-sensitive runner flags; revalidate after Xcode upgrades. The script neither downloads runtimes nor changes signing, accounts, SDKs or simulator runtime mappings. The normal Xcode path remains preferable once platform setup is repaired.

Unit tests cover forward-compatible decoding, numeric/optional wire encoding, task windows/timezones, exact API arguments, safe failures/cancellation, auth ordering and cleanup races, phone proof/expiry/canonical identity, approval versus commitment, reviewed-contact privacy and idempotency. The existing background SDK auth regression remains included. UI tests cover draft → timed task → confirmation, explicit simulated phone proof, organizer approval, proposed versus confirmed state, fictional invitations, large text and native picker cancellation.

Every UI test launches with `--rally-local-tests`, which disables live configuration even if an ignored local config exists. Test transports and authentication boundaries use fixtures; tests do not log in to real accounts or send messages. The SDK auth regression uses a fixture rejection.

## Verification record — 2026-10-10

- Continuation: `./scripts/test-simulator.sh F72C0C21-28E9-4869-A6AD-022BA39B19E3` passed end to end on Xcode 27.0 / iOS 26.2 (iPhone 17 Pro simulator). App/test build succeeded; **56 unit tests + seven UI tests passed, zero failures**. Local result bundle: `TestResults/run-20261010T215802Z-kmkOKY/Rally.xcresult`; wrapper log: `/tmp/rally-ios-integration-final-validation.log`. `git diff --check` passed.
- Inspected final XCTest screenshots of [simulated phone proof](Evidence/demo-phone-proof.png), [separate organizer JOIN code](Evidence/demo-organizer-code.png), and accessibility XXXL phone-link instructions. These are labeled local fixtures; the screenshots are not live consent or delivery evidence.
- The local regressions cover registration before protected access, late login/registration after sign-out, repeated sign-out during suspended logout, canonical phone identity changes, proof/expiry/idempotency, fractional date conversion, stale/no-op approval and conservative unknown statuses. Simulated phone proof remains separate from demo event-creation convenience.
- The continuation changes only app source, tests and documentation. Shared/backend contracts are unchanged. The merged A/B baseline (`b73fba8`) passed 173 backend tests and strict TypeScript checks; those are historical merge results, not new live acceptance evidence.
- Earlier Lane D merge verification (`48335d7`) passed 16 unit tests and five UI tests. Historical local screenshots: [pending demo assignment](Evidence/demo-pending.png), [fictional invitation](Evidence/demo-invitation.png), and [native contact picker](Evidence/native-picker.png). The background SDK auth crash regression remains in the current suite.

## Deferred live/device acceptance

No real login, cloud mutation, deployment, provider configuration change or message send was performed in this continuation. Local results are fixture/simulator evidence only.

1. Real Auth0 token acceptance, registration, refresh, sign-out/relogin and unauthorized access rejection.
2. Actual signed phone JOIN proof, event creation/confirmation, separate organizer and participant event JOIN, and persistence across restart.
3. A real participant's iMessage YES changes the app's committed state, matched to the sanitized M1 trace (ST-15). No simulator simulation closes this gate.
4. Physical iPhone 16 Pro / iOS 27.0.1 install, signing/provisioning expiry, native Contacts, navigation and accessibility.
5. M2 natural-language coordination after Lane C and the real M1 gate are ready.

The user previously reported Auth0 sign-in, but successful protected backend reads were not observed. That report does not establish the live login/link/create flow or replace these checks. Backend read/error additions above remain separate coding work that can proceed without a live phone test.
