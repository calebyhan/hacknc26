# M1 — Wire Messaging (A) to Domain (B): first live reassignment

Run by the Lane A and Lane B owners together (~hour 8). Goal: the P0 vertical slice from `README.md` works over **real Photon** with no Claude involved.

## Preconditions

- Lane A: T0 + T2 merged; real inbound/outbound works; `commands.route` calls `proposals.respond` / `domain.statusFor`.
- Lane B: T1 + T3 merged; ST-04–ST-10, ST-13, ST-18 pass under fakes.
- `npm run check` green on `main`.

If either side isn't ready, stop the live run and report which preconditions fail; don't paper over it with mocks. Passing the code integration gate does not complete the live checkpoint. Live testing was initially deferred; the subsequent user-provided transcript below adds partial phone evidence.

## Latest evidence — partial M1

The user has observed phone-only draft creation, JOIN, enrolled STATUS, draft confirmation, an unassigned task, a cover request and expiry about ten minutes later. No target YES/NO, committed reassignment or acceptance replay is shown. See the [sanitized assessment](../docs/19-messaging-evidence.md#user-reported-live-setup-and-offer-follow-up). This is progress toward M1, not its completion.

The C branch (`6c4c444`) and A/B/D implementation are now integrated on `main`. The [combined rehearsal](../docs/23-demo-readiness.md) passes locally, including canonical app reads, worker flow, YES/NO/replay and outage fallback. This does not close the live gate. STATUS now includes IDs for duplicate titles; offers show their deadlines and stale queued requests are suppressed. Fresh offers are needed after expiry.

## Steps

1. Run `npm ci && npm run check` on integrated `main` and confirm the development deployment. For the authenticated app/CLI path, follow [manual setup](../docs/20-domain-evidence.md#auth0-and-manual-event-setup): use a genuine Auth0 session, register the organizer, complete phone proof **before** event creation, create an event and tasks with explicit non-overlapping time windows, and confirm the draft. Keep tokens and real-phone argument files private. The iOS registration/linking/task-window/confirmation/organizer-opt-in wiring now passes local tests; actual device acceptance remains open. The integrated deterministic phone-only CREATE EVENT → JOIN → CONFIRM setup path does not require app authentication and retains signed-sender and event-consent checks.
2. Have the organizer redeem its own event invitation and Jordan redeem their selected-contact invitation through actual Photon `JOIN` messages. Verify enrolled `STATUS`. Do **not** use `seed.bootstrap` for live setup: it accepts no phone overrides and intentionally creates only simulation drafts, unassigned tasks and invited fake contacts. Fake Maya/Taylor must never acquire fabricated consent or active commitments.
3. Establish the initial assignment through a real offer and the initial assignee's actual `YES`. With two phones, the organizer can be the initial assignee; label this as the **two-phone variant** in the trace. The canonical Alex/Maya/Jordan scenario needs a third real consenting participant as Maya. Record the initial commitment and current event/task versions.
4. For the deterministic M1 checkpoint with inference stopped, create offers using `internal.proposals.create` from the Convex dashboard or an operator script. Each call must include an actual persisted originator `sourceMessageId`, authorized `originatorId`, `eventId`, `targetTaskId`, `targetUserId`, current `expectedEventVersion`/`expectedTaskVersion`, a future `expiresAt` within 24 hours, and a stable `idempotencyKey`. Initial offers use `type:assignment`; replacement offers use `type:reassignment` and `subjectId` of the current assignee. Have the originator send the explicit request first; do not invent a signed inbound row. Label these calls **manual proposal setup**, not natural-language parsing. The integrated worker can instead produce offers for M2's inference scenario. Never edit commitments or invoke `proposals.respond` to impersonate a participant.
5. Live run of **A1 → A2**: Jordan receives exactly one replacement request while the prior commitment stays active. Jordan replies `YES`; Jordan becomes `active`, the prior commitment becomes `released`, and the appropriate organizer/target/prior-assignee notices are recorded. Then organizer `STATUS` shows the new state. In the two-phone variant the organizer and prior assignee are the same person; record the actual business notices rather than assuming three distinct recipients.
6. Replay the accepted `YES` webhook, or have Jordan send `YES` again before creating any other pending offer. Expect no second commit or business confirmation (A7/ST-07). A new message may receive a truthful no-pending-offer reply; replaying the same provider ID must not create a second inbox row.
7. Live run of **A3**: use a second task at a non-overlapping time, establish its initial commitment through genuine acceptance, then offer its reassignment to Jordan. Jordan replies `NO`; the initial assignment stays unchanged and the organizer is told. Do not offer Jordan the task they already accepted in step 5; that target is ineligible.
8. Remove any temporary routing shims; verify every outbound message used `outbox.enqueue`. Save a sanitized trace (no tokens, real numbers or unrelated message content) to `tests/integration/traces/m1.md`. Include the setup variant, timestamps, hashed trace IDs, versions, domain states, outbox counts/attempts and actual phone observations. Do not create a purported live trace from the simulation tests.

## Done when

- A1, A2, A3, A7 pass live, and ST-04–ST-07 pass in `npm run check`.
- Outbox shows one row per business notification; no `sent` without a provider ID or acknowledged result.
- Any Spectrum behavior that surprised you is recorded in `docs/14`.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** If this checkpoint misses hour 10, say so; Lanes C and D pause and help (see `docs/17`).
