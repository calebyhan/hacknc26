# M1 — Wire Messaging (A) to Domain (B): first live reassignment

Run by the Lane A and Lane B owners together (~hour 8). Goal: the P0 vertical slice from `README.md` works over **real Photon** with no Claude involved.

## Preconditions

- Lane A: T0 + T2 merged; real inbound/outbound works; `commands.route` calls `proposals.respond` / `domain.statusFor`.
- Lane B: T1 + T3 merged; ST-04–ST-10, ST-13, ST-18 pass under fakes.
- `npm run check` green on `main`.

If either side isn't ready, stop and report which preconditions fail; don't paper over it with mocks.

## Steps

1. Pull `main`. Run `seed.bootstrap` (labeled ADR-013 setup) on the dev deployment, but with two real opted-in test phones as Alex (organizer) and Jordan: both must have texted `JOIN <code>` for real. Maya and Taylor stay fake.
2. Because the worker isn't wired yet, create the reassignment proposal by running `internal.proposals.create` from the Convex dashboard or a script, with Alex as originator. Label this in the trace as setup, not natural-language parsing (`docs/10`: no hidden admin action disguised as the agent).
3. Live run of **A1 → A2**: Jordan's phone receives exactly one request; Jordan replies `YES`; Jordan's commitment is `active`, Maya's `released`, Alex gets one confirmation. Then `STATUS` from Alex shows the new state.
4. Live run of **A3** on a fresh proposal: Jordan replies `NO`; nothing changes; Alex is told.
5. Replay: re-deliver the `YES` webhook (or send `YES` again) → no second commit, no second confirmation (A7/ST-07).
6. Remove any temporary routing shims; make sure every outbound message in this flow went through `outbox.enqueue`.
7. Save a sanitized trace (no real numbers, no message bodies beyond the demo text) to `tests/integration/traces/m1.md`.

## Done when

- A1, A2, A3, A7 pass live, and ST-04–ST-07 pass in `npm run check`.
- Outbox shows one row per business notification; no `sent` without a provider ID or acknowledged result.
- Any Spectrum behavior that surprised you is recorded in `docs/14`.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** If this checkpoint misses hour 10, say so; Lanes C and D pause and help (see `docs/17`).
