# Domain workflows and state machines

## W1 — Enroll a participant

1. Organizer selects a **specific** contact in app, or uses `invite someone` in their signed Rally conversation and reviews the name and selected phone's last four digits.
2. Create membership `invited` and an `invitations` row (`pending`) with an expiring one-time code.
3. Human-controlled invite handoff and participant **inbound** message `join <event name>` or `JOIN <code>` establishes opt-in and proof of phone access.
4. Match exactly one current invitation bound to that signed phone. Named JOIN rechecks the selected contact's event/inviter binding and invitation time boundary; duplicate matching event names require the original code. Mark the invitation `redeemed`, mark member `enrolled`, record `consentAt` and its source message; acknowledge with event name and help instructions.
5. Future notifications allowed only within explicit event scope and current messaging provider rules.

**Disallow:** adding selected phone as enrolled without recipient action; exposing event data before verification; indefinite reuse of join code.

## W2 — Event creation

- App organizer enters title/date/time/timezone/location; optional event kind and weather sensitivity.
- Verify organizer authentication; save new event with `version=1`.
- Contact selections become `invited` memberships only; no cold send.
- Guided iMessage setup starts with `create an event`, `new event`, or `plan an event`. Ask for title, an explicit date/time such as `Oct 18, 2026 at 2 PM`, timezone (or the sender's established default), and location. Ask again for ambiguous dates; the current deterministic parser does not interpret arbitrary phrases such as “Saturday afternoon.”
- Persist a sender-bound setup session, with a 15-minute inactivity expiry, instead of creating an event immediately. Review the local date/time/location and explicit event-notification consent. Only the sender's distinct `yes, create it` confirmation atomically creates the scheduled event, organizer membership, signed consent source and event/actor audit record. Bare `YES` remains reserved for pending offers. Cancellation/expiry leaves no event behind.
- Expert `CREATE EVENT` remains a separate draft → organizer JOIN → versioned `CONFIRM` path. App event creation does not by itself grant messaging consent.
- **P0 without the iOS app (ADR-013):** events, tasks and invited memberships may be created by a labeled seed/bootstrap script run by an authenticated organizer before the demo, or via the iMessage draft flow above. Neither path sends invitations automatically.

## W3 — Assigning a task

Task status reflects **committed** state only; pending offers are `proposals` (see [`03-data-model.md`](03-data-model.md#canonical-state-enums)). Reassignment policy is ADR-011.

Before assignment, a consented organizer can use `add a task`, choose the authorized event if needed, and enter title, window and required staffing (1–20). Review and `yes, add it` create an unassigned task. Overlapping task windows are allowed; each task has independent capacity. A time such as `1 PM` uses the displayed event day/timezone; a later-day end requires the full date. Event version and organizer access are rechecked when saving.

After saving, send the next task's name to continue in the same event, or `done` to finish. Each task still requires its own review and `yes, add it`. Commands and coordination requests leave saved tasks intact; late model questions from before a newer setup interaction are suppressed, including at outbox dispatch.

When organizer approval is required, `approve <task name>` matches only a unique current request visible to that organizer. Ambiguity produces explicit task/participant/event choices. Approval permits asking the participant; it never creates a commitment. If organizer and target are the same person, send the actionable offer once and still require their subsequent `YES`.

```text
task status        proposal (state)                         result
-----------        ----------------                         ------
unassigned         pending --target YES + checks-->  accepted  -> confirmed (new commitment active)
unassigned         pending --target NO / expiry-->   declined/expired -> unassigned
confirmed (Maya)   pending to Jordan --YES + checks--> accepted -> confirmed (Jordan active, Maya released)
confirmed (Maya)   pending to Jordan --NO / expiry-->  declined/expired -> confirmed (Maya unchanged)
needs_coverage     pending to Jordan --YES + checks--> accepted -> confirmed (Jordan active)
needs_coverage     pending to Jordan --NO / expiry-->  declined/expired -> needs_coverage
confirmed          (no proposal) assignee cancels / organizer reports unavailable -> needs_coverage
confirmed          (no proposal) authorized completion -> completed
```

Three triggers must stay distinct (ADR-011):

- **Organizer suggests a replacement** (“Can Jordan replace Maya on setup?”): Maya stays `active` until Jordan accepts; on accept Maya's commitment becomes `released` and Maya gets one notification. Adding someone to a task with spare capacity preserves existing assignees; unclear add-versus-replace requests should ask for clarification.
- **Assignee cancels** (“I can't do setup anymore” from Maya): commitment → `canceled_by_participant`, task → `needs_coverage`, organizer notified.
- **Organizer reports unavailability** (“Maya can't make it”): recorded as an audited organizer override; Maya's commitment → `released`, task → `needs_coverage`, Maya gets one notification. A declined replacement leaves the task `needs_coverage`, never silently back on Maya.

## W4 — Contextual event inference

Use pending-reply scope first. If sender says “yes,” tie it to **their** current pending offer only. If multiple offers exist, ask which one. For general messages, rank only accessible candidate events by explicit phrase, short conversation focus, task relevance, and timing. If ambiguous, text two concise choices and await response. Never infer solely from shared friend names.

## W5 — Multi-person plan recovery

- Trigger: explicit cancellation, organizer change, or an approved weather adaptation.
- Compute affected tasks and dependencies, list eligible alternatives with constraints.
- Ask organizer to approve a planner-recommended candidate before contacting them (ADR-011).
- Ask selected replacement to accept; the pending proposal's `expiresAt` is the hold TTL.
- Recheck state, event version and affected task versions, commit with a single transactional mutation.
- Notify affected participants and update activity log.
- If no match: report unresolved gap, do not fabricate coverage.

## W6 — Weather-aware suggestion (P1)

- Organizer marks event weather-sensitive, provides thresholds and alternative options.
- Cron fetches matching hourly forecast for correct time zone/event location.
- Store provenance and dedupe weather trigger per threshold version.
- If threshold crossed, notify organizer once, with concrete plan options and uncertainty.
- No mass reschedule without organizer approval and participant reconfirmations as necessary.

## W7 — Opt out

Use the deterministic command set in [`04-messaging-and-photon.md`](04-messaging-and-photon.md#deterministic-commands). `STOP` sets `users.messagingState=stopped`, cancels that user's queued optional outbound messages and their `pending` proposals. `PAUSE`/`RESUME` toggle `paused`/`active`. `LEAVE <event>` sets membership `left` and cancels pending proposals targeting them in that event. These controls are handled without a model. For service-critical notices, follow messaging and consent rules; for hackathon MVP, err on the side of silence.

## W8 — Close a finished test event

A consented organizer sends `close event <exact event name>` and reviews the event's active assignments, unfinished tasks, pending offers and invitations. Duplicate names require the event ID from STATUS. No domain state changes during review. A subsequent `yes, close it` confirms that exact snapshot within five minutes; `cancel close` discards the review. Changed versions, staffing, access or expired reviews require a fresh review.

Confirmation marks the event canceled, releases active commitments, cancels unfinished tasks and pending offers, and revokes pending invitations in one audited transaction. Only consented event members receive notices. History remains in the app; closed events disappear from active phone STATUS and their released assignments no longer cause overlap warnings. Other events remain unchanged. Existing events are never closed automatically.

## Rejection and clarification examples

- “Maybe?” to availability request → do not record acceptance; ask for explicit yes/no or leave pending.
- “Jordan said I could volunteer for him” → require Jordan's own consent or authorized policy; don't trust third-party testimony as acceptance.
- “Delete everyone else from the event” from ordinary member → refuse without exposing privileged details.
- “Move the event later” when there are 2 events → ask which event; no write.
- “Maya can't make it” from organizer → organizer override per ADR-011 (audited, Maya notified); the same message from a non-organizer member → no state change, ask Maya directly or tell the sender only Maya or the organizer can change it.

## Status vocabulary

Display labels shown in iMessage copy and the app. They are **derived** from the canonical persisted states in [`03-data-model.md`](03-data-model.md#canonical-state-enums); never stored separately.

| Label | Derived from |
|---|---|
| `draft` | `events.status=draft` |
| `waiting_to_join` | `memberships.state=invited` ("Waiting for them to text Rally") |
| `pending_approval` | proposal `pending` with `requiresOrganizerApproval` and no `organizerApprovedAt` |
| `awaiting_participant` | proposal `pending`, organizer approval satisfied, target hasn't replied |
| `confirmed` | `tasks.status=confirmed` |
| `needs_coverage` | `tasks.status=needs_coverage` or `unassigned` with no pending proposal |
| `at_risk` | weather threshold crossed, or a pending proposal expiring within the event's lead time |
| `completed` | `tasks.status=completed` / `events.status=completed` |
| `failed` | latest relevant `outboundMessages.state=failed` (delivery problem, not task failure) |
| `canceled` | `tasks.status=canceled` / `events.status=canceled` |

Agent execution status (`reasoningJobs.status`) is **not** event-task completion status.
