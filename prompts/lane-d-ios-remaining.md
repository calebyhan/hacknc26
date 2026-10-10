# Lane D — Finish iOS integration, then verify live acceptance

Continue the existing SwiftUI companion toward **T6**, **M2** and **ST-15**. The app remains setup/status; everyday coordination stays in iMessage. Extend the existing app rather than rebuilding it.

## Current status — local pass complete, 2026-10-10

The available iOS API/UI wiring is implemented on `lane/d-ios-integration`. The final local app/test build passed **56 unit tests and seven UI tests**, with zero failures. See `ios/Rally/README.md` for commands, evidence and the precise A/B contract handoff. The implementation sections below describe behavior to preserve; do not redo completed work.

**Next work:** coordinated additive backend read/error contracts below, then their app wiring and local tests. Live Auth0/Photon and physical-device acceptance remain deferred. T6/M2/ST-15 are still open.

## Current authorization and starting point

Continue any remaining contract/app work **without live testing for now**, following the user's decision to defer live verification. Complete the available app work with deterministic test clients, contract fixtures and simulator tests. Missing phones, device access or a live Auth0 session must not block independent coding. Keep the deferred live checklist below explicit; local success cannot close the live milestones.

Lane D and A/B are merged into `main` (integration merge `b73fba8`, 2026-10-10). Inspect status and preserve local work. Continue from `lane/d-ios-integration` and incorporate current `main` as needed; do not discard this continuation or resume the old `lane/d-ios` tip. Preserve ignored `ios/Rally/Configuration/Local.xcconfig`, credentials and team-specific signing settings.

During this pass, do not send real messages, seed a cloud deployment, change provider configuration, deploy backend changes or exercise real-account login/device acceptance. Dependency resolution and local builds/tests are allowed. Do not add fake consent to real records or make a failed live connection silently enter demo mode.

## Read first

1. `AGENTS.md` and its mandatory reading order if this is a new session.
2. `ios/Rally/README.md` — existing implementation, configuration and build/test evidence.
3. `docs/07-ios-companion.md`, `docs/06-workflows.md#status-vocabulary` and `docs/03-data-model.md#canonical-state-enums`.
4. `docs/20-domain-evidence.md` and `docs/21-messaging-domain-integration.md` — merged APIs, authenticated setup and remaining integration gaps.
5. `docs/10-security-privacy.md`, `docs/17-workstreams.md` and `docs/11-testing-and-demo.md`.
6. `prompts/m1-messaging-domain.md` and `prompts/m2-ai-and-app.md` — deferred live checkpoints, not prerequisites for local app work in this pass.

## Verified baseline and remaining boundaries

- SwiftUI screens, Codable models, selected-contact review, explicit demo fixtures and Convex/Auth0 adapters exist under `ios/Rally/`.
- The merged A/B backend implements auth checks, account provisioning, phone-link mutations, event/task APIs, invitation redemption, approvals and deterministic proposal acceptance. Do not describe those handlers as stubs. Lane C's worker/context/weather implementation remains separate work.
- Merge verification passed **173 backend tests**, strict TypeScript checks and GitHub CI. The unchanged iOS source built and passed **16 Core/Live unit tests plus five UI tests** on Xcode 27.0 / iOS 26.2. These are recorded baseline results, not evidence for changes made in this continuation.
- SDK pins: Convex Swift 0.8.1, Convex Auth0 0.4.0, Auth0.swift 2.17.0; Swift 6, minimum iOS 17. Verify installed interfaces before changing SDK integration. Keep auth/connectivity UI updates on the main queue; the existing background-login crash regression must remain green.
- The user previously reported simulator Auth0 sign-in, but successful protected backend reads and the complete app login/link/create flow have not been demonstrated.
- The continuation on `lane/d-ios-integration` now wires registration before protected subscriptions, explicit phone proof before live event creation, timed tasks, draft confirmation, organizer JOIN code generation and organizer approval. Auth/link and adapter tests use injected offline boundaries. See `ios/Rally/README.md` for the final verification record; do not repeat this implementation from scratch.
- Current read models omit account/link status, messaging consent, provider routing, activity history and event-list progress counts. UI connection state is not evidence of any of those facts.
- The current milestone is **M1 live verification pending**. D's local implementation can progress now; T6/M2/ST-15 acceptance remains pending real evidence.

## Ownership and available contracts

Own `ios/` and its prompt/app documentation. Extend `RallyClient`, the live adapter, mock/test implementations and views together. Lane B owns backend identity/domain/read contracts; Lane A owns invitation redemption, messaging consent and Photon transport. New backend fields/endpoints need an additive contract change coordinated under `docs/17`; do not bypass authorization or silently implement another lane's files.

These public APIs exist now; inspect source validators for complete shapes. Swift call names use `module:function`.

| API | Current input and behavior |
|---|---|
| `accounts.register` | `{displayName}` → user ID; requires verified Auth0 identity; repeat registration returns the existing account |
| `accounts.beginPhoneLink` | `{phoneE164,idempotencyKey}` → `{invitationId,code,expiresAt}`; creates a short-lived challenge, sends nothing |
| `accounts.completePhoneLink` | `{invitationId}` → canonical user ID, only after the backend finds the phone's actual signed JOIN proof; this is a mutation, not a status query |
| `events.myEvents`, `events.detail` | Authorized subscriptions; detail takes `{eventId}` and returns event/tasks/members/proposals |
| `events.create` | Event fields and stable `idempotencyKey` → draft event; derive ownership on the server |
| `events.confirmDraft` | `{eventId,expectedVersion}` → event ID; schedules the draft and increments event version |
| `tasks.create` | Task fields, `eventId`, `expectedEventVersion`, `idempotencyKey`; include both `windowStart` and `windowEnd` for assignable tasks |
| `events.organizerInvitation` | `{eventId,idempotencyKey}` → invitation ID/code/expiry; requires linked phone; organizer must JOIN this event separately |
| `invitations.createForContacts` | `{eventId,contacts:[{displayName,phoneE164}],idempotencyKey}` → invitation records/codes/expiry; never sends or enrolls recipients |
| `proposals.approve` | `{proposalId}` → organizer approval; does not accept on the target participant's behalf |

Preserve JSON-number encoding for Convex `v.number()` and omit absent optional fields. Backend timestamps are **integer Unix milliseconds**: explicitly convert/round dates before encoding. `Date.timeIntervalSince1970 * 1000` can contain fractions; cover this with a regression test. Do not switch these values to the Swift SDK's int64 wire representation.

## Implemented local scope — preserve and verify when changing

1. **Provision the signed-in account before protected queries.** Add registration to the session flow using a validated display name. Auth0 login alone does not create a Rally user. Gate subscriptions until registration succeeds; expose retry/failure states, clear protected data on auth failure/sign-out, and preserve the main-queue SDK boundary. Use injected authentication/API test doubles; no real login is required for these tests.

2. **Wire phone linking before event creation.** Extend the client and onboarding UI for challenge creation and explicit completion checks. Show code, expiry, pending, success and retry states; successful server completion is the only proof of linking. Completion can return a different canonical user ID than registration, so discard/rebind identity-specific cached state. Never infer linking from an entered phone, a sent-message button or cached local flags.

   Inspect how backend failures reach the installed Swift SDK before mapping them to UI states. Backend functions currently throw ordinary errors; if stable public error codes are unavailable, request a structured error contract rather than depending on raw server text. Semantics to preserve: `PHONE_PROOF_REQUIRED` stays pending; expired challenges need an explicit new request key (reusing the old key returns its old challenge); `PHONE_IDENTITY_CONFLICT`, `LINK_PHONE_BEFORE_CREATING_EVENTS` and `PHONE_CHANGE_NOT_SUPPORTED` need an actionable error, never client-side identity migration. `UNAUTHORIZED` clears protected data.

3. **Finish event/task setup.** Convert event and task dates to integer milliseconds. Add task start/end controls in the event's timezone, validate `end > start`, and use the current event version. Add explicit draft review/confirmation through `events.confirmDraft`; re-read the authorized event state before subsequent versioned operations. Keep `kind=event` for MVP per ADR-003; the schema's `project` value is not a reason to add a project selector. An open task remains unassigned until verified participant acceptance.

4. **Add organizer opt-in and invitation handoff.** Phone linking and event messaging consent are separate. App event creation gives organizer access with messaging notifications disabled; even an `enrolled` organizer membership does not prove event JOIN. Wire `events.organizerInvitation`, show the real code/expiry, and do not label messaging active without server evidence. Preserve the native phone-property picker, review/edit/removal, explicit country-code validation and one-person-per-submission invitation flow. Retry unchanged submissions with the same key; an explicit replacement/renewal is a new request. Copy/share actions must remain user initiated and must not claim that the recipient has joined.

5. **Wire approval and truthful read models.** Add organizer-only approval through `proposals.approve`. Its `null` result can also mean an expired/no-op offer; observe the updated authorized proposal instead of claiming the participant was contacted. Present organizer approval separately from participant acceptance; never optimistically mark a task confirmed. Decode the backend's optional derived `displayLabel` where relevant, including stale/expired offers, while keeping committed task state separate from proposals. Support unknown enum values conservatively. Clear protected query data on permission failure; show stale/disconnected data honestly and re-read versions after conflicts. Do not automatically overwrite competing state or invent a fresh key to retry an uncertain consequential mutation.

6. **Finish local UX and accessibility.** Exercise loading/empty/error/retry states, large Dynamic Type and VoiceOver labels across registration, linking, event/task creation, contact review, invitation results and event detail. Test picker cancellation/reopening and multi-number fictional contacts. Event-list progress, activity and iMessage shortcuts depend on the read contracts below; build their UI against labeled fixtures only if useful, and keep unavailable live capabilities truthful.

7. **Run meaningful local checks and document the handoff.** Add regressions for changed transitions and adapter behavior, then run the relevant XCTest/UI suites and `npm run check` when shared/backend contracts change. Run the full app build/test gate before handoff. Update the app README with commands, outcomes, remaining contract blockers and the deferred live checklist. Commit only scoped source/docs/tests on the continuation branch; exclude configuration, test artifacts and unrelated work.

## Backend contracts still needed — continue independent work

The proposed data, authorization boundaries and A/B acceptance checks are recorded in `ios/Rally/README.md#backend-handoff--proposed-contracts-not-implemented-apis`. Implement these as coordinated additive contracts before extending their live UI. Do not pretend these APIs already exist.

- **Authenticated account/link read model:** restore verified linking after restart without trusting a cached user ID/flag; report pending/expired challenge status if needed. `completePhoneLink` proves completion for a known challenge but does not replace a general account/status query.
- **Current user's event messaging consent:** read models currently expose membership state/role without consent or notification flags. The organizer's app membership is already enrolled before JOIN, so that state cannot drive a “messaging active” badge.
- **Verified participant-specific Rally routing:** no public API supplies the actual assigned contact/number. Do not invent a universal Rally number or enable an unverified deep link. A code-only handoff can tell the user to use their existing provisioned Rally conversation; keep a shortcut unavailable until routing is known.
- **Activity/progress data:** event-scoped redacted activity and authorized progress counts are not in the current list/detail contract. Do not reconstruct an audit timeline, delivery state or worker health from WebSocket connectivity.
- **Stable client-visible errors:** inspect current SDK behavior and add a structured public error contract if required for dependable retry/linking UX.

A missing contract may block one feature's production wiring. It does not block local implementation/tests for the others. Broader A/B automatic cancellation→planner and messaging approval routing are separate work, not requirements to rebuild D's existing backend APIs.

## Local acceptance gate

Use fixtures/test doubles that cannot contact real recipients or mutate cloud data. Demo mode stays an explicit selection; test simulations never masquerade as live state.

- Registration finishes before protected subscriptions; registration failure, sign-out and expired sessions clear protected state.
- Phone challenge pending/expiry/retry, failed proof, canonical-ID replacement and identity conflicts produce the correct UI; no event creation before verified linking in the app flow.
- Fractional `Date` input becomes integer millisecond JSON numbers; absent optionals stay omitted; task windows and timezone handling are validated.
- Draft confirmation and stale-version responses are handled without duplicate writes. Organizer opt-in remains distinct from app membership and phone proof.
- Contact selection submits only reviewed properties; invitation retries are stable; selected/invited is never enrolled automatically.
- Organizer approval never substitutes for target YES; pending/expired proposals remain distinct from confirmed commitments.
- Subscription denial/disconnect/reconnect, unknown fields/enums, large text and picker regressions pass with test-controlled inputs.

Use the build/test commands in `ios/Rally/README.md`, including `scripts/test-simulator.sh` if the normal Xcode destination resolver is unavailable. Focused unit suites now include `CoreTests`, `LiveTests`, `AdapterTests`, `SessionTests`, `PhoneLinkTests`, `EventSetupTests`, `MockIntegrationTests` and `ContactReviewTests`, alongside `RallyUITests`. UI tests pass `--rally-local-tests` so ignored live configuration cannot enable real login. Regenerate the Xcode project when file membership changes and preserve its checked-in package lockfile. Do not rerun unrelated suites repeatedly without a new change or failure.

## Deferred live/device acceptance — run later

Keep these pending until the user resumes live testing. They are not prerequisites for completing the available local work above.

1. Verify real Auth0 login, backend token acceptance, registration, refresh, sign-out/relogin and permission rejection against the intended development deployment.
2. Complete real phone proof before event creation. Create/confirm an actual event with timed tasks; organizer and invited participants each redeem their own event JOIN. Use `prompts/m1-messaging-domain.md` and its labeled authenticated setup; simulation seed data cannot establish real consent or assignments.
3. Verify authorized subscriptions, persistence across restart, real invitation redemption and permission removal. Observe a participant's actual iMessage YES changing the app's confirmed state and compare IDs/versions with the sanitized M1 trace (**ST-15**).
4. Run on the user's iPhone 16 Pro / iOS 27.0.1 via temporary direct Xcode installation. Verify pairing/signing, actual provisioning expiry, login, Contacts, navigation and accessibility. Keep team-specific settings local; simulator tests do not prove this install path.
5. Run the complete natural-language **M2** scenario only after Lane C and the M1 live gate are ready. Keep a sanitized trace/screen recording without tokens, real phone numbers or unrelated event data.

## Scope and completion

Weather, widgets, project mode and extra integrations remain deferred. Preserve the scope-cut rules in `docs/01` and feature freeze in `prompts/m3-freeze.md`.

**This local pass is complete** when the available app API/UI wiring and meaningful local tests are finished, required missing contracts are documented precisely, and remaining live/device checks are clearly pending. Do not stop all work merely because one contract or a real phone is unavailable.

**T6/M2/ST-15 are complete only** when their actual live/device acceptance evidence exists. A finished local pass, backend merge, simulator login or fixture acceptance cannot close those milestones.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** Separate locally implemented/tested behavior, outstanding backend contracts and deferred live checks. State which SDK/provider/device behavior remains unverified; never label simulation as a live pass.
