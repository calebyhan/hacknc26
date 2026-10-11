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

Session restoration (October 11): launch now calls the installed SDK's `loginFromCache()` once, which uses Auth0 Keychain credentials and its refresh path without opening the browser. A fresh authorized account subscription restores the canonical user and phone-link status. Missing credentials show sign-in; temporary restoration failures do not erase stored credentials. Sign-out prevents a late restoration from reopening protected views. `SessionTests` covers successful restoration, absent cache, failed account reads, transient refresh failure and sign-out races. The complete simulator run passed **81 unit tests and eight UI tests**, zero failures (`TestResults/run-20261011T042516Z-2D5Hu6/Rally.xcresult`). A signed physical-device build succeeded; these tests do not establish an actual Auth0 refresh/relaunch on a person's device.

Task setup now exposes **People needed** (1–20) instead of fixing every task to one person. Event task rows show confirmed/required staffing alongside participant names. Each participant still accepts through iMessage.

The focused updated task UI test created a three-person task and verified `0 of 3 people confirmed` (`/tmp/rally-team-task-ui-fixed.xcresult`). The October 11 signed build was installed and launched on the connected iPhone; device installation/launch does not establish actual saved-session restoration. Local logs: `/tmp/rally-session-device-build.log`, `/tmp/rally-session-device-install.log`, `/tmp/rally-session-device-launch.log`.

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

Routing accepts a recent authenticated dedicated-line observation or a trusted internal provider allocation. Shared-line metadata alone cannot supply a contact. A caller-owned phone-link challenge can show its trusted bot destination before verification; opening Messages still requires an explicit tap and sends nothing. Routes expire within 24 hours and are disabled on stale connections. The reporting user's actual allocation was verified and recorded during the phone-link correction below. New participants still require operator setup; no automatic provider provisioning is claimed. Activity does not infer delivery or worker health from connectivity.

The user’s intended install is directly from Xcode onto an iPhone 16 Pro running iOS 27.0.1. Choose a signing team in Xcode, connect/trust the device, enable Developer Mode if requested, and Run. Keep team-specific changes local. Signed installation and initial sign-in are verified on that device; provisioning expiry remains unverified.

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

- Phone-link correction: regression tests first reproduced the app JOIN rejection for an existing Messages identity and the missing challenge destination. Routing now accepts app phone proof without attaching Auth0 or granting event consent; authenticated app completion reconciles the canonical identity. The challenge displays the assigned bot number and a Messages shortcut, or explicit missing-setup instructions. `npm run check` passed strict TypeScript and **409 tests, one live test skipped** (`/tmp/rally-phone-link-final-check.log`). A further red regression reproduced app completion racing the scheduled router; the same-phone proof acknowledgement now survives that ordering. The account/status suites also passed **26 tests** after the routing refactor (`/tmp/rally-phone-routing-final.log`). These use synthetic encrypted messages and fixture provider allocations.
- `AdapterTests.testPhoneChallengeDecodesItsAssignedBotDestinationBeforePhoneProof` verifies the destination and expiry; **76 iOS unit tests passed, zero failures** (`/tmp/rally-phone-link-unit.log`, `/tmp/rally-phone-link-unit.xcresult`). The simulator app/test build passed (`/tmp/rally-phone-onboarding-ios-build.log`). The earlier eight UI tests below cover the existing simulated flows; the user subsequently confirmed the new live-number presentation on the physical device.
- `npx convex dev --once` deployed the correction to `rally:dev/caleb-han` (`/tmp/rally-phone-link-final-deploy.log`). The reporting user's current participant-to-bot allocation was observed in Photon's authenticated Users dashboard and recorded through the trusted internal mutation with a 24-hour expiry. No invitations or messages were sent by the operator. Private provisioning details remain under `/tmp`, outside this repository.
- The final signed physical-device build, install and launch succeeded on the connected iPhone 16 Pro (`/tmp/rally-phone-link-device-build.log`, `/tmp/rally-phone-link-device-install.log`, `/tmp/rally-phone-link-device-launch.log`). The user retried and confirmed: **“Number appears and phone verification succeeds.”** This is physical-device observation of the assigned-number display and real JOIN phone verification; event messaging consent, restart persistence and ST-15 parity remain unverified.
- Physical-device sign-in crash fix: the iPhone's crash reports show `EXC_BREAKPOINT` in `ConvexRallyClient.stream` on `tokio-runtime-worker`, through `_dispatch_assert_queue_fail` and Swift's actor-isolation check. The account query's Combine callbacks inherited `MainActor` but received data on Convex's background executor. Both value and completion callbacks now explicitly use `@Sendable`; the async stream consumer retains responsibility for UI isolation.
- Added `AdapterTests.testBackgroundAccountUpdateAndCompletionDoNotCrashAfterLogin` and `testBackgroundProtectedQueryFailureIsSanitizedWithoutCrashing`, using fictional data on dedicated background queues. Before the fix, the first test reproduced the same actor-isolation crash; the crashed test runner restarted and its stalled reporting process was terminated after saving the simulator crash evidence. After the fix, **75 unit tests and eight UI tests passed**, with zero failures, using `xcodebuild test-without-building -xctestrun /tmp/rally-auth-regression.xctestrun -destination 'platform=iOS Simulator,id=F72C0C21-28E9-4869-A6AD-022BA39B19E3' -parallel-testing-enabled NO`. Log: `/tmp/rally-auth-fixed-tests.log`; result: `/tmp/rally-auth-fixed-tests.xcresult`.
- A signed physical-device build succeeded (`xcodebuild build -project Rally.xcodeproj -scheme Rally -configuration Debug -destination 'platform=iOS,id=00008140-001968A81A39801C'`). The corrected app was installed and launched on the connected iPhone 16 Pro. The user retried Auth0 consent and confirmed: **“Sign-in succeeds and app stays open.”** This is real device sign-in evidence; it does not establish token refresh, phone linking, event creation or full ST-15 parity. Existing local signing changes were preserved. Build log: `/tmp/rally-auth-device-build.log`; raw device crash reports remain private under `/tmp`.

- Final status-contract continuation: `npm run check` passed strict root/workspace TypeScript checks and **225 backend/shared/integration tests in 14 files**. Log: `/tmp/rally-status-backend-check.log`.
- `./scripts/test-simulator.sh F72C0C21-28E9-4869-A6AD-022BA39B19E3` built the app/test targets and passed **73 unit tests + eight UI tests, zero failures**, on Xcode 27.0 / iOS 26.2 (iPhone 17 Pro simulator). Result: `TestResults/run-20261010T221217Z-2aKHF3/Rally.xcresult`; log: `/tmp/rally-ios-status-validation.log`.
- Inspected the final [disabled fictional contact shortcut](Evidence/demo-verified-route.png), [redacted simulated activity/delivery](Evidence/demo-activity.png), and accessibility XXXL phone instructions. Every UI fixture is local; none is real consent or receipt evidence. `git diff --check` passed.

- Earlier app-wiring pass (`0846984`): `./scripts/test-simulator.sh F72C0C21-28E9-4869-A6AD-022BA39B19E3` passed end to end on Xcode 27.0 / iOS 26.2 (iPhone 17 Pro simulator). App/test build succeeded; **56 unit tests + seven UI tests passed, zero failures**. Local result bundle: `TestResults/run-20261010T215802Z-kmkOKY/Rally.xcresult`; wrapper log: `/tmp/rally-ios-integration-final-validation.log`. `git diff --check` passed.
- Inspected final XCTest screenshots of [simulated phone proof](Evidence/demo-phone-proof.png), [separate organizer JOIN code](Evidence/demo-organizer-code.png), and accessibility XXXL phone-link instructions. These are labeled local fixtures; the screenshots are not live consent or delivery evidence.
- The local regressions cover registration before protected access, late login/registration after sign-out, repeated sign-out during suspended logout, canonical phone identity changes, proof/expiry/idempotency, fractional date conversion, stale/no-op approval and conservative unknown statuses. Simulated phone proof remains separate from demo event-creation convenience.
- The earlier app-wiring pass changed only app source, tests and documentation. This continuation adds coordinated backend/shared status and error contracts. The merged A/B baseline (`b73fba8`) passed 173 backend tests and strict TypeScript checks; those are historical merge results, not new live acceptance evidence.
- Earlier Lane D merge verification (`48335d7`) passed 16 unit tests and five UI tests. Historical local screenshots: [pending demo assignment](Evidence/demo-pending.png), [fictional invitation](Evidence/demo-invitation.png), and [native contact picker](Evidence/native-picker.png). The background SDK auth crash regression remains in the current suite.

## Deferred live/device acceptance

The earlier status-contract pass used only fixtures. The physical-device follow-ups above include real sign-in observation, development deployment, trusted route registration, and signed installation. Corrected live phone proof is user-confirmed; event/message parity remains a separate acceptance gate. No operator message send was performed during these follow-ups.

1. Real Auth0 refresh, sign-out/relogin and unauthorized access rejection. Initial physical-device sign-in after consent is now user-confirmed (see the crash-fix evidence above).
2. Verify/provision each additional participant’s assigned route, then each participant's signed phone JOIN proof, event creation/confirmation, separate organizer and participant event JOIN, and persistence across restart. The reporting user's phone proof is user-confirmed. The additive backend is deployed and the reporting user's assigned route is recorded.
3. A real participant's iMessage YES changes the app's committed state, matched to the sanitized M1 trace (ST-15). No simulator simulation closes this gate.
4. Physical iPhone 16 Pro / iOS 27.0.1 signing/provisioning expiry, native Contacts, navigation and accessibility. Signed install and launch have succeeded.
5. M2 natural-language coordination after Lane C and the real M1 gate are ready.

The physical-device sign-in retry confirms the app stays open after consent. The phone-link correction is deployed and installed; the user confirmed the number appears and phone verification succeeds. Event creation and message/app parity still require their separate live checks. Automatic provisioning for new Photon participants remains unimplemented.
