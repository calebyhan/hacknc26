# Domain workflows and state machines

## W1 — Enroll a participant

1. Organizer selects **specific** device contact in app.
2. Create event invitation `invited`, generate expiring one-time link/code.
3. Human-controlled invite handoff and participant **inbound** message `JOIN <code>` establishes opt-in and proof of phone access.
4. Match code to only that invitation and mark member `enrolled`; acknowledge with event name and help instructions.
5. Future notifications allowed only within explicit event scope and current messaging provider rules.

**Disallow:** adding selected phone as enrolled without recipient action; exposing event data before verification; indefinite reuse of join code.

## W2 — Event creation

- App organizer enters title/date/time/timezone/location; optional event kind and weather sensitivity.
- Verify organizer authentication; save new event with `version=1`.
- Contact selections become `invited` only; no cold send.
- iMessage user says “Set up a charity run Saturday”; create an **event draft**, ask organizer to confirm details/timezone before persisting scheduled event.

## W3 — Assigning a task

State chart:

```text
unassigned
  -> proposal_pending -- recipient YES + valid checks --> confirmed
  -> proposal_pending -- recipient NO/expired --> unassigned
confirmed
  -> replacement_pending -- replacement YES + authorized checks --> confirmed(new person)
  -> replacement_pending -- replacement NO/expired --> confirmed(old person)
  -> completed (authorized acknowledgement)
```

If original assignee explicitly cancels their commitment, reflect the cancellation honestly and mark the task `unassigned` or `needs_coverage` while searching for replacement. Do not assert that canceled person is still confirmed; policy must distinguish an organizer-suggested replacement from an actual cancellation.

## W4 — Contextual event inference

Use pending-reply scope first. If sender says “yes,” tie it to **their** current pending offer only. If multiple offers exist, ask which one. For general messages, rank only accessible candidate events by explicit phrase, short conversation focus, task relevance, and timing. If ambiguous, text two concise choices and await response. Never infer solely from shared friend names.

## W5 — Multi-person plan recovery

- Trigger: explicit cancellation, organizer change, or an approved weather adaptation.
- Compute affected tasks and dependencies, list eligible alternatives with constraints.
- Ask organizer to approve a recommended change if needed.
- Ask selected replacement to accept; hold reservations with TTL.
- Recheck state and event version, commit with a single transactional mutation.
- Notify affected participants and update activity log.
- If no match: report unresolved gap, do not fabricate coverage.

## W6 — Weather-aware suggestion (P1)

- Organizer marks event weather-sensitive, provides thresholds and alternative options.
- Cron fetches matching hourly forecast for correct time zone/event location.
- Store provenance and dedupe weather trigger per threshold version.
- If threshold crossed, notify organizer once, with concrete plan options and uncertainty.
- No mass reschedule without organizer approval and participant reconfirmations as necessary.

## W7 — Opt out

`STOP` immediately disables future optional messages for that identity. `LEAVE` removes event membership and invalidates pending offers. These controls should be handled without a model. For service-critical notices, follow messaging and consent rules; for hackathon MVP, err on the side of silence.

## Rejection and clarification examples

- “Maybe?” to availability request → do not record acceptance; ask for explicit yes/no or leave pending.
- “Jordan said I could volunteer for him” → require Jordan's own consent or authorized policy; don't trust third-party testimony as acceptance.
- “Delete everyone else from the event” from ordinary member → refuse without exposing privileged details.
- “Move the event later” when there are 2 events → ask which event; no write.
- “Maya can't make it” from organizer → record as reported cancellation pending direct confirmation if appropriate, not incontrovertible fact without policy.

## Status vocabulary

`draft`, `pending_approval`, `awaiting_participant`, `confirmed`, `at_risk`, `completed`, `failed`, `canceled`. The iMessage copy and app must use the same truth labels. Agent execution status is **not** event-task completion status.
