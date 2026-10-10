# Domain workflows and state machines

## W1 — Enroll a participant

1. Organizer selects **specific** device contact in app.
2. Create membership `invited` and an `invitations` row (`pending`) with an expiring one-time code.
3. Human-controlled invite handoff and participant **inbound** message `JOIN <code>` establishes opt-in and proof of phone access.
4. Match code to only that invitation, mark it `redeemed`, mark member `enrolled`, record `consentAt`; acknowledge with event name and help instructions.
5. Future notifications allowed only within explicit event scope and current messaging provider rules.

**Disallow:** adding selected phone as enrolled without recipient action; exposing event data before verification; indefinite reuse of join code.

## W2 — Event creation

- App organizer enters title/date/time/timezone/location; optional event kind and weather sensitivity.
- Verify organizer authentication; save new event with `version=1`.
- Contact selections become `invited` memberships only; no cold send.
- iMessage user says “Set up a charity run Saturday”; create an event with `status=draft`, ask organizer to confirm details/timezone before moving it to `scheduled`.
- **P0 without the iOS app (ADR-013):** events, tasks and invited memberships may be created by a labeled seed/bootstrap script run by an authenticated organizer before the demo, or via the iMessage draft flow above. Neither path sends invitations automatically.

## W3 — Assigning a task

Task status reflects **committed** state only; pending offers are `proposals` (see [`03-data-model.md`](03-data-model.md#canonical-state-enums)). Reassignment policy is ADR-011.

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

- **Organizer suggests a replacement** (“Can Jordan cover setup?”): Maya stays `active` until Jordan accepts; on accept Maya's commitment becomes `released` and Maya gets one notification.
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
