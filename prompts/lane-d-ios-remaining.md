# Lane D — Finish iOS integration and acceptance

Continue the existing SwiftUI companion toward **T6**, **M2** and **ST-15**. The app remains setup/status; everyday coordination stays in iMessage. This is the continuation checklist after the initial UI slice, not a request to rebuild it.

Work in the existing repository checkout on **`lane/d-ios`**. The user requested ordinary branch work, not a separate worktree. Inspect and preserve the current uncommitted implementation before editing.

## Read first

1. `AGENTS.md` and its mandatory reading order if this is a new session.
2. `prompts/lane-d-ios.md` — original scope and ownership.
3. `ios/Rally/README.md` — build, configuration, test instructions and implementation evidence.
4. `docs/07-ios-companion.md` — required screens and behavior.
5. `docs/06-workflows.md#status-vocabulary` and `docs/03-data-model.md#canonical-state-enums`.
6. `docs/10-security-privacy.md`, `docs/17-workstreams.md`, `docs/16-agent-task-board.md#t6--swiftui-companion` and `docs/11-testing-and-demo.md`.

## Current state — verify before continuing

- SwiftUI screens, contract models, explicit local demo fixtures, selected-contact review and Convex/Auth0 adapters exist under `ios/Rally/`.
- Auth0's public Native application settings and the Convex URL are in ignored `Configuration/Local.xcconfig`. Do not replace them with examples or commit the local file.
- The user reported successful simulator Auth0 sign-in; the app visibly returned to its live event screen. That screen was reconnecting/loading. Authorized event reads and backend token acceptance have not been proved.
- A Swift 6 actor-isolation crash was fixed by scheduling auth/connectivity notifications on the main queue after reducing SDK payloads to flags. Keep that boundary intact.
- **16 iOS unit tests** passed, including the SDK background-login regression. **Five distinct UI tests** passed for demo creation, assignment separation/acceptance, invitations, large text and picker cancellation/reopening. These tests do not prove live backend authorization or real messaging.
- Xcode 27.0 is installed; iOS 26.2 simulator behavior was checked. The intended physical device is an **iPhone 16 Pro on iOS 27.0.1**, using direct temporary Xcode installation. Physical-device installation is unverified.
- At the last inspection, this branch had no `convex/auth.config.ts`; app handlers and authorization helpers remained throwing stubs. Other lanes or deployments may have progressed, so inspect before declaring a blocker.
- Phone linking and activity history currently report unavailable capability. Demo invitation codes and simulated acceptance are explicitly labeled.

## You own

`ios/`, plus this lane's prompt/app documentation. Consume the frozen `events.myEvents`, `events.detail`, `events.create`, `tasks.create` and `invitations.createForContacts` contracts. Lane B owns backend identity, membership and domain functions; Lane A owns phone linking, invitation redemption and Photon routing.

For missing queries/fields, prepare an additive `contract:` PR for Lane B review. Do not implement another lane's backend files directly. Continue independent app work while dependencies are unavailable, and record exact blockers rather than inventing data or treating mock evidence as live evidence.

## Tasks, in order

1. **Finish auth verification (D; partially available now).** Verify sign-out immediately clears protected screens and local credentials, and signing back in works. Once backend auth is configured, verify refresh, session expiry and return to the auth gate. Failures must show an actionable error and never silently enter demo mode.

2. **Run on the physical iPhone (D; available now with the user's device/account).** Configure signing locally, pair/trust the iPhone 16 Pro, follow device preparation prompts and run Rally. Check login, navigation, layout and Contacts. Keep team-specific settings local. Record the actual provisioning expiry; do not promise a ten-day lifetime or require TestFlight for the chosen installation path.

3. **Complete small required UI gaps (D; mostly available now).** Add the event-type selector using canonical `event` / `project` values. Add the event-list progress summary when authorized read models provide enough data; request a contract addition if needed. Never infer commitment counts from event status or connectivity.

4. **Verify actual contact selection (D; available now).** Exercise selection of a specific phone property from a multi-number contact, review/edit, removal and invalid-number rejection. Require an explicit country code rather than guessing. Verify only the final selected name/number reaches the invitation payload, without full-address-book access. Preserve cancellation/reopening behavior and the current one-person-per-submission flow until result-to-recipient correlation supports more. Use fictional test contacts and sanitized evidence.

5. **Finish accessibility verification (D; available now).** Check VoiceOver labels/focus and large Dynamic Type across event creation, task creation, contact review, invitation results and event detail. Check empty/loading/error layouts and that confirmed/proposed distinctions remain understandable without color. Existing large-text evidence covers welcome/phone-link screens, not every screen.

6. **Integrate backend identity (B dependency; D consumes it).** Lane B must deploy the matching Auth0 provider configuration, resolve signed identities to Rally users and define first-login provisioning. Verify backend token acceptance before counting authentication complete. Login must not grant organizer role, prove a phone number or enroll a messaging participant. Never send client-supplied user IDs or roles as authorization.

7. **Verify live queries and mutations (B dependency; D tests the app).** Load authorized event lists/details, create an event and open task, and prove persistence across app restart. Verify organizer/member controls reflect backend permissions. Exercise the real subscription path; the adapter already exists, so do not replace the app with a second implementation.

8. **Implement phone linking (A dependency; D implements the UI).** Consume an authenticated challenge/status contract that supplies a real short-lived code, expiry and actual assigned Rally routing instructions. Show the `JOIN <code>` handoff and observe verified inbound completion. Handle pending, linked, expired and retry states. Never mark linked from an app-entered number or assume a universal shared Rally number.

9. **Complete live invitations (A/B dependencies; D implements the flow).** Submit reviewed contacts to `invitations.createForContacts`, correlate the result to the selected person, and show expiry and actual handoff instructions. Keep the status “Waiting for them to text Rally” until verified redemption/enrollment appears in authorized state. The app must not send invitations automatically or enroll someone merely because they were selected. Handle failed/expired invitations without creating duplicates.

10. **Complete activity and iMessage navigation (backend contract dependency).** Add a short event-scoped, redacted activity timeline with actual timestamps and an iMessage shortcut using verified routing information. Preserve truthful unavailable states until those contracts exist. Do not derive delivery receipts, worker health or activity history from WebSocket/task status.

11. **Verify live failure and permission paths (A/B dependencies).** Test disconnect/reconnect, stale data, failed or stalled initial loads, retry, duplicate submissions, mutation version conflicts, session expiry and membership removal. Another user's event must never appear or leak through detail access. Query permission failures must clear protected data. Ask before overwriting competing changes; do not retry a consequential mutation with a new idempotency key blindly.

12. **Run the real-device acceptance scenario (A/B/C integration).** Sign in → see authorized seeded Charity 5K → create a test event → select/review a contact → show the waiting-to-join state → observe setup become confirmed after Jordan's actual iMessage `YES`. Compare the event/task versions and active assignee with the sanitized iMessage trace for **ST-15**. Capture a screen recording with private details redacted, the relevant test output and a clearly identified real-provider trace. Simulated acceptance does not close this gate.

13. **Commit and hand off (D).** Run checks appropriate to the final changes, review the diff and commit the lane's changes on `lane/d-ios`. Do not stage unrelated lane work, build artifacts or local configuration. Update the app README and continuation prompt with commands, results and remaining blockers. Close T6/M2/ST-15 only when their actual acceptance evidence exists; merge according to the team's checkpoint process.

## Optional work and cut order

- **Weather-sensitive creation controls:** only when the backend weather capability is ready and the required app/messaging path is passing. Weather remains a signal requiring the appropriate approvals.
- **Widget (P2):** defer until the required milestones are green and the team schedule permits it. One card: next event, date/time, confirmed vs outstanding commitment counts and a deep link into the app. Widget updates are system-budgeted; make no immediate-update claim.
- Respect `prompts/m3-freeze.md`: no new features after feature freeze. A passed checkpoint is not a reason to introduce widget work after the freeze; cut unfinished optional work first.

## Tests you must make pass

- Keep the existing unit/UI coverage green when affected by a change. Add meaningful regressions for new behavior or defects, not tests that merely repeat implementation.
- T6: selected contacts only; pending vs confirmed distinction; denied access to unrelated events. Mock authorization tests must be supplemented with real backend evidence.
- Auth: sign-out/relogin, refresh/expiry and failed-login behavior without a silent demo fallback.
- Real-device contact/invitation and verified phone-link paths, including expiry and retries.
- ST-15: confirmed app state agrees with the actual iMessage trace.
- Review captured logs, screenshots and recordings for secrets, raw phone numbers and unrelated event data.

## Done when

The real-device T6/M2 scenario and ST-15 pass with actual provider traffic, authorized backend data and the correct consenting participants. Relevant app tests/checks pass, evidence is recorded, and unavailable optional features are honestly labeled or cut. Simulator sign-in or fixture acceptance alone does not satisfy this milestone.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** Include the auth and device verification status, A/B contract dependencies, what was actually tested live, and any explicitly simulated evidence.
