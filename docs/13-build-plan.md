# 24-hour implementation plan

Avoid building five disconnected impressive components. Ship one complete iMessage→approval→state-change loop first.

## Milestones

| Time | Team focus | Exit criterion |
|---|---|---|
| 0–2h | SDK/provider spike + repository scaffold | Real Photon inbound/outbound DM works |
| 2–5h | Convex schema, auth/opt-in + seeded event | Event/member/task state and authorization tests |
| 5–8h | Deterministic approval workflow + fake provider | Proposed→accepted/rejected cases pass without Claude |
| 8–12h | Event context + local Claude worker | Structured intent parsed safely; ambiguous request asks |
| 12–16h | SwiftUI setup/status + selected contacts | One event created and status synced with real DB |
| 16–19h | Reassignment heuristic + cancellation | Real replacement accepted and committed once |
| 19–21h | Weather OR flyer parsing, not both if behind | One authentic or labeled simulated proactive flow |
| 21–24h | Security, integration tests, rehearsal | P0 demo gate and backup video |

These are **parallel team workstreams**, not guarantees for a single developer.

## Suggested task split

- **Messaging/backend:** Photon + Convex component, durable inbox/outbox, worker queue, auth, tests.
- **Domain/AI:** event resolver, structured schema, Claude worker, safe action executor, replanning.
- **iOS:** SwiftUI app with authentication, selected contacts, event creation/status; shared fixture contract.
- **Demo/integration:** smoke tests, sample events, telemetry, weather conditional work, slide/pitch.

## Kill switches

At **hour 5**, if real Photon traffic fails: escalate to Photon Discord/help and build core tests with fake provider while blocking claims of live success. At **hour 12**, if auth/onboarding or deterministic approval workflow fails: stop work on weather and widget. At **hour 18**, freeze new integrations; only fix end-to-end path. At **hour 21**, freeze features and rehearse.

## The order of value

1. Credible real Photon messaging.
2. Correctly scoped event memory.
3. Correct human approvals and transactional updates.
4. Comfortable natural language handling.
5. Visual app setup/status.
6. Proactive weather/replanning.
7. Widget/polish.

## Pitch structure

Problem (10s), two-person live coordination (45s), disruption resolved (25s), engineering depth (20s), track relevance and future plans (15s). Adjust to actual judge time constraints; do not misrepresent mocked integrations.
