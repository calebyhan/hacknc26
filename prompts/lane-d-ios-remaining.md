# Lane D — Local integration complete; live acceptance deferred

Continue Rally's SwiftUI setup/status companion toward **T6**, **M2** and **ST-15**. Everyday coordination remains in iMessage. Preserve the existing app and its tested contracts.

## Current status — 2026-10-10

Lane D and A/B were merged into `main` at `b73fba8`. The continuation is on `lane/d-ios-integration`; do not resume the old `lane/d-ios` tip. The initial app-wiring commit is `0846984`. The latest continuation also implements the formerly missing account, consent, routing, activity/progress and public-error contracts. There are no remaining Lane D code-contract blockers from the previous checklist. The final local gate passed **225 backend tests, 73 iOS unit tests and eight simulator UI tests**, with zero failures.

See [the app README](../ios/Rally/README.md) for local build/test results and [implemented app contracts](../docs/22-ios-app-contracts.md) for exact APIs, privacy rules and trusted route provisioning. These are local implementation results, not live acceptance. **M1 live verification remains pending; T6/M2/ST-15 stay open.** Lane C reasoning/worker work remains separate.

## Authorization and working boundary

The user requested **everything in this Lane D continuation except live testing**. Local code, fixtures, injected adapters, backend tests and simulator checks are authorized. Live login, deployment/cloud mutations, provider configuration, real sends and physical-device acceptance are deferred until the user resumes them. No missing phone or live session should block independent code maintenance.

Inspect Git status and preserve existing work, ignored `ios/Rally/Configuration/Local.xcconfig`, credentials and signing settings. Never fabricate real consent, seed a real participant as opted in, or silently switch a failed live connection to demo. Commit only scoped source/docs/tests; exclude generated test artifacts and local configuration.

## Read first

1. `AGENTS.md` and its mandatory reading order on a new session.
2. `ios/Rally/README.md` and `docs/22-ios-app-contracts.md`.
3. `docs/07-ios-companion.md`, `docs/06-workflows.md#status-vocabulary`, `docs/03-data-model.md#canonical-state-enums` and `docs/10-security-privacy.md`.
4. `docs/20-domain-evidence.md`, `docs/21-messaging-domain-integration.md` and `docs/17-workstreams.md`.
5. `prompts/m1-messaging-domain.md`, `prompts/m2-ai-and-app.md` and `docs/11-testing-and-demo.md` for the deferred checkpoints.

## Implemented behavior to preserve

- **Authenticated account readiness:** register the signed-in identity with its display name, then wait for `accounts.current` before exposing protected views. Continuously observe canonical ID and server-verified phone state; recreate scoped views after canonical changes and clear protected state on revoked/unavailable account reads. Auth0 login alone is not phone proof.
- **Phone proof:** create/renew a challenge, display JOIN/expiry, and explicitly check completion. A pending/expired challenge cannot enable live event creation. Already linked accounts restore their proof from the authorized query without another challenge. Phone linking does not grant event consent.
- **Event/task setup:** create drafts, specify task time windows in the event timezone, review and confirm with the current event version. Encode integer Unix milliseconds as JSON numbers; omit absent optionals. Confirmation schedules the event but does not assign tasks.
- **Event opt-in and contacts:** organizer app membership is separate from event JOIN consent. Show organizer JOIN code/expiry only when needed. Native contact selection reviews only the chosen name/number; one participant per submission keeps code handoff unambiguous. Codes send nothing and do not enroll recipients. An invitee must use their own provisioned Rally conversation.
- **Approval and committed state:** organizer approval permits a request but never substitutes for the target's acceptance. Refresh authorized state after uncertain/no-op mutations. Preserve reviewed input and request keys on retries; an explicit new request must not silently duplicate an uncertain write. Idle pending offers expire in the UI.
- **Status and activity:** show canonical task counts, caller-specific event consent/global messaging controls, redacted bounded event activity and only the caller's delivery states. `sent` is provider accepted; `delivered` requires a receipt. Connectivity is neither delivery nor worker health.
- **Messages shortcut:** accept only the backend's current caller route with strict E.164 and future expiry. Disable on stale connections and at expiry, recheck at tap, and never include an automatic send. Missing/shared/invalid routing remains unavailable. Demo uses a labeled fictional route and cannot open Messages.
- **Safe failures:** parse only strict versioned SDK ConvexError data; raw server text stays generic. Authentication expiry clears the session; failed or denied queries clear protected results. Unknown enums remain conservative.
- **Local demo:** explicit in-memory phone proof, organizer consent and participant acceptance controls are simulation only. New events do not inherit sample-event consent. No test fixture calls a messaging provider.

## Implemented API surface

Swift names use `module:function`; inspect server validators for full inputs/results.

| API | Purpose |
|---|---|
| `accounts.register`, `accounts.current` | Caller registration and canonical/verified account read |
| `accounts.beginPhoneLink`, `accounts.completePhoneLink` | Short-lived challenge and actual signed JOIN proof check |
| `events.myEvents`, `events.detail` | Authorized event/task/member/proposal subscriptions |
| `events.create`, `events.confirmDraft`, `tasks.create` | Organizer setup with stable keys and version checks |
| `events.organizerInvitation`, `invitations.createForContacts` | Explicit opt-in invitations; no sends or automatic enrollment |
| `proposals.approve` | Authenticated organizer approval; separate participant response |
| `appStatus.overview`, `appStatus.event`, `appStatus.route` | Authorized progress, consent, activity, caller-only delivery and contact routing |
| Internal `appStatus.recordProvisionedRoute`, `appStatus.revokeProvisionedRoute` | Trusted provider-allocation handoff and revocation; never callable by public apps or DMs |

The internal provisioning boundary is implemented but has not been exercised against a real provider allocation. Shared Spectrum metadata does not identify the bot destination. Follow `docs/22-ios-app-contracts.md` when live work resumes; do not invent a universal number, use the participant's sender/space ID, or reuse another invitee's assigned route.

## Local validation for future edits

SDK pins are Convex Swift **0.8.1**, Convex Auth0 **0.4.0**, Auth0.swift **2.17.0**; Swift 6, minimum iOS 17. Verify installed public interfaces when changing adapters. Keep UI state on the main actor and preserve background SDK auth/late-login/logout regressions.

Run tests appropriate to changed behavior, then the combined gate when changing shared contracts:

```sh
npm run check
cd ios/Rally
./scripts/test-simulator.sh YOUR_AVAILABLE_IOS_SIMULATOR_UDID
```

The wrapper is the documented fallback for this machine's Xcode scheme destination issue. UI tests use `--rally-local-tests` to disable ignored live configuration. Unit suites include Core/Live, Adapter, Session, PhoneLink, EventSetup, MockIntegration, ContactReview, AppStatus and StatusPresentation. UI coverage includes setup/confirmation, phone proof, approval vs commitment, contact review/picker cancellation, large text and disabled demo routing/activity. New backend tests cover account/error boundaries and status/routing authorization, redaction, TTL and revocation.

Regenerate the project when file membership changes, preserving intentional project metadata, Info.plist and the pinned SwiftPM lockfile. Keep simulator/build artifacts ignored. Do not repeat passing unrelated suites without new changes, failures or concerns.

## Deferred live/device acceptance — run later

1. Deploy the additive backend contracts to the intended development deployment. Verify real Auth0 token acceptance, registration, refresh, sign-out/relogin and permission rejection. A previously reported simulator login is not this evidence.
2. Complete actual signed phone proof, create/confirm a real event with timed tasks, and have organizer/participants redeem their own event JOIN. Follow the authenticated M1 runbook; simulation seeds cannot establish real consent.
3. Verify each participant's actual assigned Rally destination, provisioning/rotation/expiry/revocation, and user-initiated Messages opening. Validate shared-line allocation through an authoritative provider channel before recording it.
4. Verify persistence across restart, authorized subscriptions, invitation redemption and permission removal. Match a real participant's iMessage YES to app committed state and sanitized M1 IDs/versions (**ST-15**). Exercise NO, cancellation, STOP/PAUSE/LEAVE and delivery receipts without optimistic confirmation.
5. Install directly from Xcode onto the user's iPhone 16 Pro / iOS 27.0.1. Verify pairing/signing, actual provisioning expiry, login, Contacts, navigation and accessibility. Team settings stay local; simulator results do not prove device installation.
6. Run M2 natural-language coordination after Lane C and the real M1 gate are ready. Save sanitized trace/screen recording without tokens, real phone numbers or unrelated event data.

Weather, widgets, project mode and extra integrations remain outside this continuation. Follow P0/P1/P2 cuts and the feature freeze.

## Completion and report

The Lane D local implementation is complete when its code and meaningful local checks pass; read/error contracts are now implemented, not a future handoff. **T6/M2/ST-15 complete only with their actual live/device evidence.**

Report **Goal / Changed files / Acceptance evidence / Risks and open questions**. Separate tested local behavior from deferred deployment/provider/device checks. Never label a simulation as live evidence.
