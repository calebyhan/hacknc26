# Rally iOS companion

Lane D's first slice: a SwiftUI setup/status app with an explicit in-memory demo and a configurable Convex/Auth0 adapter. The merged Lane A/B backend now implements authenticated account, event/task and messaging operations. The app still needs to wire account registration before protected queries, phone linking before event ownership, task time windows, draft confirmation and organizer messaging opt-in. Phone linking and a real iMessage-driven update are not implemented end to end; this does **not** close T6, M2 or ST-15.

## Open and run

Open `Rally.xcodeproj`, select the `Rally` scheme and an Apple Silicon iPhone simulator, then Run. Select **Explore demo**. No account or provider configuration is needed for the demo. Changes and selected contacts remain in memory and are discarded when leaving the demo or restarting the app.

The app includes:

- Event list, event creation, open-task creation, and participant state.
- Confirmed assignments displayed separately from pending proposals.
- A native Contacts phone-property picker and review before invitation creation. One person is invited per submission so the returned code has an unambiguous recipient. No full-address-book permission or `CNContactStore` fetch is used. The app never sends invitations or marks selected people enrolled.
- A clearly labeled local acceptance simulation for Charity 5K, and a phone-link screen that truthfully reports the missing capability.
- Loading, empty, error, disconnected/stale, unknown-status, Dynamic Type and accessibility labels. A query failure clears protected query data; losing connection alone marks it stale. Signing out clears protected views.

The Charity 5K/Hack Night fixture mirrors `packages/shared/fixtures.ts`; the pending Jordan offer and an inaccessible event are explicitly added simulation scenarios. Demo behavior is not backend authorization or proof of actual consent.

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

Auth0 requires matching backend verification/provisioning from Lane B. Invitation redemption and phone-link contracts require Lane A. See [the Lane D continuation prompt](../../prompts/lane-d-ios-remaining.md) for remaining work, contract gaps and ownership. No provider secret belongs in this app.

The user’s intended install is directly from Xcode onto an iPhone 16 Pro running iOS 27.0.1. Choose a signing team in Xcode, connect/trust the device, enable Developer Mode if requested, and Run. Keep team-specific changes local. Actual device pairing/signing and provisioning expiry have not been verified; simulator success does not prove this install path.

## Tests

Normally, select Product → Test in Xcode or run:

```sh
xcodebuild test -project Rally.xcodeproj -scheme Rally \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID'
```

On this machine Xcode 26.6 lists the iOS 26.5 SDK but its scheme destination resolver requires a missing matching platform component, even with iOS 26.2 simulators installed. The compiler and those runtimes work. A target-only build followed by an `xctestrun` invocation bypasses that destination resolver without changing Xcode/system files:

```sh
./scripts/test-simulator.sh YOUR_SIMULATOR_UDID
```

The script builds arm64 simulator targets, runs the tests and saves the result bundle under ignored `TestResults/`. The combined wrapper passed end to end during merge verification with Xcode 27.0 and an iOS 26.2 simulator (see below). The manifest includes version-sensitive runner flags; revalidate after Xcode upgrades. The script neither downloads runtimes nor changes signing, accounts, SDKs or simulator runtime mappings. The normal Xcode path remains preferable once platform setup is repaired.

Core tests cover forward-compatible state decoding, milliseconds/wire keys, minimal selected-contact payloads, phone normalization, pending/confirmed separation, simulated acceptance, scoped mock access, organizer-only mutations, invitation state and idempotency. Live adapter tests cover public configuration validation, numeric/optional encoding, connectivity labels and background SDK login notifications. UI tests cover event creation, proposed versus confirmed state, simulated acceptance, fictional invitations, large text, unavailable phone linking, and native picker cancellation.

## Verification record — 2026-10-10

- Merge verification from a clean detached checkout of `48335d7`: `npm ci && npm run check` passed all 64 backend/bootstrap tests. `./scripts/test-simulator.sh <booted-simulator-UDID>` passed end to end on Xcode 27.0 / iOS 26.2: build succeeded, all 16 Core/Live unit tests and all five UI tests passed (21 total, zero failures). No local configuration was copied into the verification checkout. These are simulator/demo tests, not live M1 or ST-15 evidence.
- `npm ci && npm run check`: strict TypeScript checks and all 64 existing backend/bootstrap tests passed.
- Target-only `xcodebuild build` for arm64 `iphonesimulator`: app and test targets compiled. The app was installed and launched on iOS 26.2; welcome, event list and pending assignment screens were visually inspected.
- All 16 Core/Live XCTest cases passed on the iOS 26.2 simulator after the sign-in crash fix. The original 15 also passed in a temporary macOS harness. The new regression uses the real Convex SDK with a fixture auth rejection and verifies background loading notifications safely return to the sign-in gate.
- All five UI tests passed on iOS 26.2: event creation, proposed/confirmed separation with simulated acceptance, fictional invitation handoff, large text/unavailable phone linking, and native picker cancellation/reopening. The picker test caught and verified a fix for double dismissal of the invitation review sheet. Four tests ran together; the added picker regression ran separately against the rebuilt targets. The affected invitation test passed again after that fix.
- Inspected XCTest screenshots: [pending demo assignment](Evidence/demo-pending.png), [fictional invitation](Evidence/demo-invitation.png), and [native picker with simulator sample contacts](Evidence/native-picker.png). The system picker states that Rally can access only selected contacts. These are local simulation evidence, not a live Photon trace.
- Xcode 27.0's debugger identified an actor-isolation crash in `AppSession` when Convex emitted `.loading` on a background executor. Auth/connectivity publishers now reduce payloads to flags and schedule UI delivery on the main queue. The rebuilt app opened the actual Auth0 hosted login page on iOS 26.2. Credentials, token acceptance and the return callback were not exercised. Regression result: `/tmp/rally-auth-regression-tests.xcresult`.

The user subsequently reported successful Auth0 sign-in, and the simulator returned to Rally's live event screen. It was reconnecting/loading; no authorized event response was observed. Not verified: backend token acceptance, auth refresh/sign-out, backend membership enforcement, live creation/invitation redemption, actual phone linking, physical-device install, live Photon delivery or ST-15. Missing activity/delivery/worker facts are not fabricated in the app.
