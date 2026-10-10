# Testing, fixtures, and judge demo

## Test pyramid

**Pure unit tests** (fast): event resolver, compact-context builder, YES/NO parser, membership checks, planning filter/scorer, decision schema validation, state machine transition guards, weather policy.

**Convex integration tests:** actual database mutations under fake provider, inbound dedupe, per-event auth, proposal TTL/version, single acceptance, outbox idempotency, worker leases and stale job cancellation.

**External smoke tests [R1]:** one live Photon inbound + outbound DM; actual opted-in second participant reply; optional actual Open-Meteo lookup. Mock tests do not satisfy the Photon smoke test.

## Seeded fixtures

1. `Charity 5K` with Alex organizer, Maya `active` on setup 10:00–11:00, Jordan enrolled and available 10:00–11:00, Taylor `invited` but never joined (matches [`03-data-model.md`](03-data-model.md#minimal-seed-fixture)).
2. `Hack Night` with Alex and Jordan plus an overlapping task name.
3. One pending assignment and one expired assignment.
4. Two incoming messages sharing a provider ID for replay.
5. One simulated weather threshold crossing clearly labeled test data.

Do **not** use private contacts or messages in shared fixtures.

## Required scenario tests

IDs are `ST-xx` (scenario test) to avoid confusion with tickets `T0–T8` in `16`. The bracket shows the acceptance scenario/requirement in `01` each test proves.

- **ST-01 [A6]:** Unknown sender → onboarding only, no event disclosure.
- **ST-02 [A9, R2]:** Contact selected but not enrolled → zero outbound attempts.
- **ST-03 [A4, R4]:** Clear recent focus resolves correctly; ambiguous event asks and makes no mutation.
- **ST-04 [A1]:** Organizer proposes replacement; target has not accepted; status remains pending.
- **ST-05 [A2]:** Target replies YES once → one commit; organizer receives one correct confirmation; prior assignee `released`.
- **ST-06 [A3, R6]:** Target replies NO → no replacement.
- **ST-07 [A7, R7]:** Same YES webhook twice → no second commit or notification.
- **ST-08 [A5, R7]:** Stale reply after event or target task changed → reject or request renewed approval.
- **ST-09 [R5]:** “Maybe” is not YES.
- **ST-10 [R3]:** Unauthorized participant attempts organizer-only change → rejected.
- **ST-11 [A8, R8]:** Worker down but pending YES and STATUS still function.
- **ST-12 [R10]:** Prompt injection cannot send arbitrary messages or reveal private data.
- **ST-13 [A10, R7]:** Two acceptances racing for one exclusive slot → no double-booking.
- **ST-14 (P1):** Weather trigger once; organizer approval required before changes.
- **ST-15 (P1):** App shows same confirmed state as iMessage trace.
- **ST-16 [R10]:** After a full scenario run, logs contain no secrets, raw phone numbers or unredacted message bodies, and captured worker prompts contain no unrelated event data.
- **ST-17 [R9]:** `STATUS` from organizer and from participant returns accurate state scoped to their own memberships.
- **ST-18 [ADR-011]:** Organizer reports “Maya can't make it” → Maya `released`, task `needs_coverage`; a declined replacement leaves it `needs_coverage`; the same report from a non-organizer → no write.

## 90-second judge demo storyboard

**Preparation:** use two or three real phones/accounts explicitly opted in to the Photon project. Seed one event with real consented test members; run smoke test immediately beforehand. Have offline proof video and an annotated test trace ready if venue connectivity fails.

1. **0–15s** Organizer texts: “For Charity 5K, can Jordan cover Maya's 10 AM setup?” Show immediate contextual interpretation and an accurately pending proposal.
2. **15–35s** Jordan receives an actual message via Photon and replies “Yes.” Show a live receipt and one committed change.
3. **35–50s** Organizer receives correct confirmation and Maya gets a release notice. If the P1 app shipped, show it flip from `awaiting_participant` to `confirmed`; otherwise organizer texts `STATUS`.
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
