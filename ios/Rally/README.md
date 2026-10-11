# Rally iOS companion

Lane D's SwiftUI setup/status app has an explicit in-memory demo and a configurable Convex/Auth0 adapter. The continuation wires the merged A/B account, phone-link, event/task, invitation and approval APIs, plus authorized account/status/routing reads and safe public errors. Local simulator checks cover these flows; real Auth0/Photon operation and device acceptance remain pending. This does **not** close T6, M2 or ST-15.

## Open and run

Open `Rally.xcodeproj`, select the `Rally` scheme and an Apple Silicon iPhone simulator, then Run. Select **Explore demo**. No account or provider configuration is needed for the demo. Changes and selected contacts remain in memory and are discarded when leaving the demo or restarting the app.

The app includes:

- Registration followed by an authorized account read before protected screens; restored server-verified phone status, retryable setup, canonical identity rebinding and protected-state clearing on sign-out/session expiry.
- Phone-link challenge, expiry/renewal and explicit proof checking. Only successful backend completion enables live event creation. Canonical identity changes discard identity-specific views.
- Draft event creation, task time windows in the event's timezone, and explicit draft confirmation. Date values use integer Unix milliseconds encoded as JSON numbers.
- Organizer event JOIN codes separate from phone linking and organizer membership. Codes send nothing and do not prove event messaging consent.
- Confirmed assignments displayed separately from pending proposals; event-list progress counts come from canonical task state.
- Current-user event messaging consent and STOP/PAUSE/notification state, bounded redacted event activity, and caller-only delivery states. Provider acceptance is distinct from a delivery receipt.
- Verified current-user Messages shortcuts with a bounded expiry and safe unavailable state. Demo shortcuts are disabled; invitation recipients must use their own assigned Rally conversation.
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

Auth0 requires matching backend verification/provisioning. Deploy the coordinated backend contracts before testing this app live. No provider secret belongs in the app; preserve ignored local configuration.

## Implemented backend contracts

The additive A/B/D APIs and privacy/routing decisions are documented in [iOS app contracts](../../docs/22-ios-app-contracts.md). Existing domain mutation inputs are preserved.

| API | App behavior |
|---|---|
| `accounts.current` | Restores the authenticated account's canonical ID and server-verified phone state; no repeated phone proof after a successful authorized read. Loss of account status clears protected views. |
| `appStatus.overview` | Progress counts for the caller's enrolled events. |
| `appStatus.event` | Member-authorized counts, current-user consent/notification state, redacted activity and caller-only delivery status. |
| `appStatus.route` | Current caller's verified destination and expiry, or unavailable. Never a universal-number fallback. |
| Structured public errors | Strict `{version:1,code}` ConvexError payloads map to safe local messages and auth/link handling. Ordinary SDK errors remain generic. |

Routing accepts a recent authenticated dedicated-line observation or a trusted internal provider allocation. Shared-line metadata alone cannot supply a contact. Internal provision/revoke APIs are implemented; actual allocations and provider verification are deferred. Routes expire within 24 hours and are disabled on stale connections. No automatic provider provisioning is claimed. Activity does not infer delivery or worker health from connectivity.

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

Unit tests cover account restoration/rebinding/revocation, strict public errors, route expiry/E.164 checks, consent and delivery presentation, status-query contracts, forward-compatible decoding, numeric/optional wire encoding, task windows/timezones, exact API arguments, safe failures/cancellation, auth ordering and cleanup races, phone proof/expiry/canonical identity, approval versus commitment, reviewed-contact privacy and idempotency. The existing background SDK auth regression remains included. UI tests cover draft → timed task → confirmation, explicit simulated phone proof, organizer approval, proposed versus confirmed state, fictional invitations, large text, native picker cancellation, event consent, own delivery state and disabled demo Messages shortcuts.

Every UI test launches with `--rally-local-tests`, which disables live configuration even if an ignored local config exists. Test transports and authentication boundaries use fixtures; tests do not log in to real accounts or send messages. The SDK auth regression uses a fixture rejection.

## Verification record — 2026-10-10

- Final status-contract continuation: `npm run check` passed strict root/workspace TypeScript checks and **225 backend/shared/integration tests in 14 files**. Log: `/tmp/rally-status-backend-check.log`.
- `./scripts/test-simulator.sh F72C0C21-28E9-4869-A6AD-022BA39B19E3` built the app/test targets and passed **73 unit tests + eight UI tests, zero failures**, on Xcode 27.0 / iOS 26.2 (iPhone 17 Pro simulator). Result: `TestResults/run-20261010T221217Z-2aKHF3/Rally.xcresult`; log: `/tmp/rally-ios-status-validation.log`.
- Inspected the final [disabled fictional contact shortcut](Evidence/demo-verified-route.png), [redacted simulated activity/delivery](Evidence/demo-activity.png), and accessibility XXXL phone instructions. Every UI fixture is local; none is real consent or receipt evidence. `git diff --check` passed.

- Earlier app-wiring pass (`0846984`): `./scripts/test-simulator.sh F72C0C21-28E9-4869-A6AD-022BA39B19E3` passed end to end on Xcode 27.0 / iOS 26.2 (iPhone 17 Pro simulator). App/test build succeeded; **56 unit tests + seven UI tests passed, zero failures**. Local result bundle: `TestResults/run-20261010T215802Z-kmkOKY/Rally.xcresult`; wrapper log: `/tmp/rally-ios-integration-final-validation.log`. `git diff --check` passed.
- Inspected final XCTest screenshots of [simulated phone proof](Evidence/demo-phone-proof.png), [separate organizer JOIN code](Evidence/demo-organizer-code.png), and accessibility XXXL phone-link instructions. These are labeled local fixtures; the screenshots are not live consent or delivery evidence.
- The local regressions cover registration before protected access, late login/registration after sign-out, repeated sign-out during suspended logout, canonical phone identity changes, proof/expiry/idempotency, fractional date conversion, stale/no-op approval and conservative unknown statuses. Simulated phone proof remains separate from demo event-creation convenience.
- The earlier app-wiring pass changed only app source, tests and documentation. This continuation adds coordinated backend/shared status and error contracts. The merged A/B baseline (`b73fba8`) passed 173 backend tests and strict TypeScript checks; those are historical merge results, not new live acceptance evidence.
- Earlier Lane D merge verification (`48335d7`) passed 16 unit tests and five UI tests. Historical local screenshots: [pending demo assignment](Evidence/demo-pending.png), [fictional invitation](Evidence/demo-invitation.png), and [native contact picker](Evidence/native-picker.png). The background SDK auth crash regression remains in the current suite.

## Deferred live/device acceptance

No real login, cloud mutation, deployment, provider configuration change or message send was performed in this continuation. Local results are fixture/simulator evidence only.

1. Real Auth0 token acceptance, registration, refresh, sign-out/relogin and unauthorized access rejection.
2. Deploy the additive backend contracts, verify/provision each participant’s assigned route, then actual signed phone JOIN proof, event creation/confirmation, separate organizer and participant event JOIN, and persistence across restart.
3. A real participant's iMessage YES changes the app's committed state, matched to the sanitized M1 trace (ST-15). No simulator simulation closes this gate.
4. Physical iPhone 16 Pro / iOS 27.0.1 install, signing/provisioning expiry, native Contacts, navigation and accessibility.
5. M2 natural-language coordination after Lane C and the real M1 gate are ready.

The user previously reported Auth0 sign-in, but successful protected backend reads were not observed. That report does not establish the live login/link/create flow or replace these checks. Backend read/error additions are implemented and locally tested. The current live backend has not been updated by this continuation.
