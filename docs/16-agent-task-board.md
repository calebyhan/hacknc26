# Coding tickets for handoff

Each ticket should be implemented independently where possible and closed only after its test evidence exists. Start with T0, not with optional weather or widget work.

## T0 — Bootstrap provider smoke test

**Files anticipated:** `package.json`, `convex/convex.config.ts`, `convex/http.ts`, `convex/spectrum.ts`, `convex/schema.ts`.  
**Input:** Photon project credentials in local/server secrets; Convex dev deployment.  
**Deliverable:** real user-initiated inbound DM saved and one real reply sent via Spectrum.  
**Tests:** signed webhook accepted, bad signature rejected, duplicate provider ID no side effects (ST-07).  
**Blocker:** actual account/SDK capability.

## T1 — Domain schema and authorization

**Files:** `convex/schema.ts`, `convex/events.ts`, `convex/memberships.ts`, `convex/tasks.ts`, `packages/shared/domain.ts`.  
**Deliverable:** seeded event with memberships, tasks and access-controlled reads/mutations.  
**Tests:** stranger cannot read event; duplicate member prevented; authenticated organizer can create (including via the labeled bootstrap path, ADR-013); member cannot perform organizer-only mutation (ST-10).

## T2 — Invitation, phone link and command router

**Files:** `convex/invitations.ts`, `convex/identity.ts`, `convex/commands.ts`.  
**Deliverable:** contact selected → invitation created → participant-initiated `JOIN <code>` verifies number → membership enrolled. Deterministic router for every command in `04-messaging-and-photon.md#deterministic-commands`, including scoped `STATUS` and unknown-sender onboarding.  
**Tests:** ST-01 (A6), ST-02 (A9), ST-17 (R9 `STATUS`); replay, expired code, wrong sender, unselected contact, `STOP`/`PAUSE`/`RESUME`/`LEAVE`.  
**Note:** no cold messaging.

## T3 — Pure action engine

**Files:** `packages/shared/intent.ts`, `packages/shared/planner.ts`, `convex/proposals.ts`.  
**Deliverable:** `PROPOSE_REASSIGNMENT` creates pending offer, YES commits, NO declines; event version, task version and TTL rechecked atomically.  
**Tests:** ST-04, ST-05, ST-06, ST-07, ST-08, ST-09, ST-13, ST-18; ST-11 (worker absent).

## T4 — Conversation context

**Files:** `packages/shared/context.ts`, `convex/conversations.ts`.  
**Deliverable:** event resolution based on exact pending proposal, explicit context, focus, task relevance, time.  
**Tests:** ST-03 (shared task names trigger clarification), unrelated event never leaked.

## T5 — Claude adapter

**Files:** `worker/index.ts`, `worker/claude.ts`, `worker/schema.ts`, `convex/reasoningJobs.ts`.  
**Deliverable:** authenticated leased queue; bounded Claude inference returning validated `AgentDecision`; fallback rules when unavailable.  
**Tests:** invalid JSON, unauthorized action, stale job, worker timeout, duplicate completion, ST-12 (prompt injection).

## T6 — SwiftUI companion

**Files:** `ios/Rally/...` after creating Xcode project.  
**Deliverable:** onboarding/phone-link screen, event list/create, contact picker (replaces the ADR-013 bootstrap path), invitation state, event status with verified app auth.  
**Tests:** selected contacts only; pending/confirmed distinction; forbidden access blocked; ST-15.

## T7 — Recovery and weather (P1)

**Files:** `packages/shared/assignment.ts`, `convex/weather.ts`, `convex/crons.ts`.  
**Deliverable:** suggest candidate after cancellation; weather threshold triggers proposal without automatically changing plan.  
**Tests:** candidate conflict, no-match, repeated threshold, unsupported location, external API failure, ST-14.

## T8 — Demo hardening

**Files:** `tests/fixtures/*`, `tests/integration/*`, `docs/11-testing-and-demo.md`.  
**Deliverable:** reproducible anonymized trace, real phones, fallback clip.  
**Tests:** P0 scenario matrix (ST-01–ST-13, ST-16–ST-18) fully run; report failures truthfully.

## Cross-team merging contracts

- Share runtime type definitions and source-of-truth schema before UI work.
- UI cannot invent event statuses; must render Convex statuses exactly.
- Model cannot bypass proposal workflow; returns only action schema.
- Messaging adapter cannot send direct notifications without outbox idempotency and consent checks.
- Log external API versions in `14-decisions-and-open-questions.md`.
