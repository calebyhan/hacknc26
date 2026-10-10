# Testing, fixtures, and judge demo

## Test pyramid

**Pure unit tests** (fast): event resolver, compact-context builder, YES/NO parser, membership checks, planning filter/scorer, decision schema validation, state machine transition guards, weather policy.

**Convex integration tests:** actual database mutations under fake provider, inbound dedupe, per-event auth, proposal TTL/version, single acceptance, outbox idempotency, worker leases and stale job cancellation.

**External smoke tests:** one live Photon inbound + outbound DM; actual opted-in second participant reply; optional actual Open-Meteo lookup. Mock tests do not satisfy the Photon smoke test.

## Seeded fixtures

1. `Charity 5K` with Alex organizer, Maya check-in, Jordan eligible setup, Taylor selected-but-not-enrolled.
2. `Hack Night` with Alex and Jordan plus an overlapping task name.
3. One pending assignment and one expired assignment.
4. Two incoming messages sharing a provider ID for replay.
5. One simulated weather threshold crossing clearly labeled test data.

Do **not** use private contacts or messages in shared fixtures.

## Required scenario tests

- **T-01:** Unknown sender → onboarding only, no event disclosure.
- **T-02:** Contact selected but not enrolled → zero outbound attempts.
- **T-03:** Clear recent focus resolves correctly; ambiguous event asks and makes no mutation.
- **T-04:** Organizer proposes replacement; target has not accepted; status remains pending.
- **T-05:** Target replies YES once → one commit; organizer receives one correct confirmation.
- **T-06:** Target replies NO → no replacement.
- **T-07:** Same YES webhook twice → no second commit or notification.
- **T-08:** Stale reply after event changed → reject or request renewed approval.
- **T-09:** “Maybe” is not YES.
- **T-10:** Unauthorized participant attempts organizer-only change → rejected.
- **T-11:** Worker down but pending YES and STATUS still function.
- **T-12:** Prompt injection cannot send arbitrary messages or reveal private data.
- **T-13:** Two acceptances racing for one exclusive slot → no double-booking.
- **T-14 (P1):** Weather trigger once; organizer approval required before changes.
- **T-15 (P1):** App shows same confirmed state as iMessage trace.

## 90-second judge demo storyboard

**Preparation:** use two or three real phones/accounts explicitly opted in to the Photon project. Seed one event with real consented test members; run smoke test immediately beforehand. Have offline proof video and an annotated test trace ready if venue connectivity fails.

1. **0–15s** Organizer texts: “For Charity 5K, can Jordan cover Maya's 10 AM setup?” Show immediate contextual interpretation and an accurately pending proposal.
2. **15–35s** Jordan receives an actual message via Photon and replies “Yes.” Show a live receipt and one committed change.
3. **35–50s** Organizer receives correct confirmation; status in app updates from pending to confirmed.
4. **50–70s** Ask an intentionally ambiguous follow-up involving both `Charity 5K` and `Hack Night`. Rally asks which event, rather than guessing.
5. **70–90s** If tested and ready, inject a **clearly simulated** weather change, show suggestion and human approval gate. Otherwise demonstrate a second cancellation recovery and show the audit trail.

Say explicitly which parts are live and which are simulated. Do not change database rows off-screen during the demo.

## What judges might ask

- **Why iMessage?** People already coordinate in chats; the agent uses low-friction replies and follows through across participants.
- **What did you build, versus Claude?** Event model, scoped retrieval, intent schemas, permissions, atomic proposal/acceptance state machine, matching/constraint logic, durable delivery integration, iOS setup.
- **Why not just one LLM call?** It cannot safely guarantee identity, permissions, transaction ordering, real commitments, or replay protection.
- **What happens if Claude goes offline?** Deterministic responses continue, complex jobs are queued with truthful fallback.
- **How do you protect contacts?** Explicit selection, no bulk sync, recipient opt-in, no cold outreach, per-event access control.
- **Why not group chats?** Shared Photon tier has constraints; the enrolled DM architecture coordinates the same canonical group state.

## Evidence checklist

Record commands/results, framework versions, smoke test timestamp, sanitized before/after task state, duplicate test, one negative response, and failure simulation. Never claim metrics that were not measured.
