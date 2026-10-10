# Coding tickets for handoff

Each ticket should be implemented independently where possible and closed only after its test evidence exists. Start with T0, not with optional weather or widget work.

## T0 — Bootstrap provider smoke test

**Files anticipated:** `package.json`, `convex/convex.config.ts`, `convex/http.ts`, `convex/spectrum.ts`, `convex/schema.ts`.  
**Input:** Photon project credentials in local/server secrets; Convex dev deployment.  
**Deliverable:** real user-initiated inbound DM saved and one real reply sent via Spectrum.  
**Tests:** signed webhook accepted, bad signature rejected, duplicate provider ID no side effects.  
**Blocker:** actual account/SDK capability.

## T1 — Domain schema and authorization

**Files:** `convex/schema.ts`, `convex/events.ts`, `convex/memberships.ts`, `convex/tasks.ts`, `packages/shared/domain.ts`.  
**Deliverable:** seeded event with memberships, tasks and access-controlled reads/mutations.  
**Tests:** stranger cannot read event; duplicate member prevented; authenticated organizer can create; member cannot perform organizer-only mutation.

## T2 — Invitation and phone link

**Files:** `convex/invitations.ts`, `convex/identity.ts`, iOS onboarding components.  
**Deliverable:** contact selected → invitation created → participant-initiated `JOIN <code>` verifies number → membership enrolled.  
**Tests:** replay, expired code, wrong sender, unselected contact, STOP.  
**Note:** no cold messaging.

## T3 — Pure action engine

**Files:** `packages/shared/intent.ts`, `packages/shared/planner.ts`, `convex/proposals.ts`.  
**Deliverable:** `PROPOSE_REASSIGNMENT` creates pending offer, YES commits, NO declines; event version and TTL rechecked atomically.  
**Tests:** A1/A2/A3/A5/A7/A10, worker absent.

## T4 — Conversation context

**Files:** `packages/shared/context.ts`, `convex/conversations.ts`.  
**Deliverable:** event resolution based on exact pending proposal, explicit context, focus, task relevance, time.  
**Tests:** shared task names trigger clarification, unrelated event never leaked.

## T5 — Claude adapter

**Files:** `worker/index.ts`, `worker/claude.ts`, `worker/schema.ts`, `convex/reasoningJobs.ts`.  
**Deliverable:** authenticated leased queue; bounded Claude inference returning validated `AgentDecision`; fallback rules when unavailable.  
**Tests:** invalid JSON, unauthorized action, stale job, worker timeout, duplicate completion.

## T6 — SwiftUI companion

**Files:** `ios/Rally/...` after creating Xcode project.  
**Deliverable:** event list/create, contact picker, invitation state, event status with verified app auth.  
**Tests:** selected contacts only; pending/confirmed distinction; forbidden access blocked.

## T7 — Recovery and weather (P1)

**Files:** `packages/shared/assignment.ts`, `convex/weather.ts`, `convex/crons.ts`.  
**Deliverable:** suggest candidate after cancellation; weather threshold triggers proposal without automatically changing plan.  
**Tests:** candidate conflict, no-match, repeated threshold, unsupported location, external API failure.

## T8 — Demo hardening

**Files:** `tests/fixtures/*`, `tests/integration/*`, `docs/11-testing-and-demo.md`.  
**Deliverable:** reproducible anonymized trace, real phones, fallback clip.  
**Tests:** P0 scenario matrix fully run; report failures truthfully.

## Cross-team merging contracts

- Share runtime type definitions and source-of-truth schema before UI work.
- UI cannot invent event statuses; must render Convex statuses exactly.
- Model cannot bypass proposal workflow; returns only action schema.
- Messaging adapter cannot send direct notifications without outbox idempotency and consent checks.
- Log external API versions in `14-decisions-and-open-questions.md`.
