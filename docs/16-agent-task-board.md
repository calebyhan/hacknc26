# Coding tickets for handoff

Each ticket should be implemented independently where possible and closed only after its test evidence exists. Start with T0, not with optional weather or widget work.

## Current AI implementation checkpoint — 2026-10-10

**Goal:** an enrolled participant's free-text DM reaches a constrained worker on this Mac and produces a validated proposal. The target's actual YES remains necessary to commit a cross-person assignment.

| Task | Result | Remaining acceptance |
|---|---|---|
| Remote integration | `lane-c/local-ai` includes `origin/main` at `b73fba8`; integrated backend deployed to existing `calm-jackal-984` development | Branch is not pushed; affected-lane review before shared merge |
| T4 resolver/context | Router and queue share the enrolled/consented resolver; only current snapshot-valid approved offers supply pending context; private data omitted | Real enrolled-event context |
| T5 queue | Credential guard, dedupe, 45-second lease, two attempts, 120-second durable expiry; rechecks consent, role and versions; development deployment/auth denials verified | Actual enrolled free-text DM |
| T5 Mac worker | Codex/ChatGPT worker online; private matching server credential; isolated process, bounded time/output, minimal environment; sanitized operator health command | Claude remains logged out; no real queue job processed yet |
| Domain integration | Signed synthetic DM → queue → actual Domain → pending offer → target YES; member suggestion waits for organizer approval; self-cancellation uses verified sender | Live opted-in phones; fake delivery and scripted decisions are labeled simulations |
| Evaluation | 20-case synthetic harness and real Codex evaluation | See the latest evaluation record below |
| Phone organizer setup | Signed inbound draft → JOIN → owner CONFIRM; deterministic TASK/INVITE/APPROVE with consent/role checks; optional Auth0 app/CLI retained | Actual phone setup/JOIN and two-phone acceptance |

**Changed files:** `packages/shared/context.ts` and its tests; `convex/{context,commands,reasoningJobs,reasoning.test,stubs.test}.ts`; `worker/src/{config,index,claude,codex,provider,loop,prompt,eval,setup,status,auth}.ts` and worker tests; `tests/eval/`; `tests/integration/{harness,reasoning-domain.test,messaging-domain.test,phone-setup.test}.ts`; `packages/shared/phoneSetup.ts`, `convex/phoneSetup.ts`, shared invitation helpers; contract inventory, Vitest configuration, manifests/lockfile, `.env.example`, `.gitignore`, README and docs `12`, `14`, `16`, `22`/INDEX.

**Acceptance evidence:** `npm run check` passes strict checks and 316 tests in 24 files. Actual Domain simulations cover pending offers until target YES, member organizer approval, verified self-cancellation, rollback, compound cancellation/coverage and compound self-volunteer/availability with completion replay. CLI security tests cover private credential preservation/creation/failure, Auth0 PKCE/state/nonce, actual loopback rejection/cancellation/timeout, cryptographically signed token validation and privacy-safe status. `npm run eval:fake`: 20/20 scripted cases, not model accuracy. `npm run contracts:list`: 40 registered functions; additive internal `reasoningJobs.expire` and `phoneSetup.execute`, existing signatures preserved. Fake child-process tests cover isolated stdin, cleanup, termination and output caps. Development deploy, crypto/config check, anonymous app and invalid worker denials, and live heartbeat pass. Full details: [AI evidence](22-local-ai-evidence.md).

**Local provider evidence:** Claude Code 2.1.263 and Codex CLI 0.152.1 interfaces inspected. Codex preflight verifies the supported CLI version and ChatGPT login. Live `model/list` supplied `gpt-5.6-luna`; stale cache entries were inaccessible. After the initial 11/20 run, the revised corpus supplies an existing open speakers task and compound organizer cancellation plus a new offer, matching actual Domain tests. Revised evaluation passed 19/20 (p50 3,975 ms; p95 6,939 ms), missing the second intent in case 17. A prompt correction and Domain regression fix this; its targeted live test passes. The final sweep passed 19/20 (p50 3,989 ms; p95 6,809 ms), with case 01 rejected as `INVALID_DECISION`; a targeted diagnostic retry passed schema validation and the expected two action types. Those retries do not establish a 20/20 run. A later complete sweep with expanded capability restrictions and the documented startup-warning setting passed 20/20 (p50 4,007 ms; p95 6,829 ms), still only on synthetic scope/action-type grading. The grade covers event scope/action types, not Domain execution/reference accuracy. Earlier 0/20 was caused by the exact pre-turn disabled-host notice, now narrowly tolerated; other errors/tool activity fail closed. No API key, fake cloud consent, or new Photon send was introduced.

**Risks/open questions:** The integrated phone-setup backend is deployed to `calm-jackal-984` and the final restricted Codex worker is online. `.env.local` remains ignored and mode 0600. Auth0 callback rejection affects only optional app/CLI setup; no Auth0 session is required for phone setup. Read-only live inspection still finds zero events, memberships and reasoning jobs. Actual enrolled Photon traffic/receipts, subscription limits and M1/M2 remain unverified. Natural-language first-event drafting, draft edits/invitation refresh and weather/P1 remain deferred; the explicit deterministic phone draft flow passes its tests.

The earlier local T0 work and pre-update Lane C work are preserved in separate named Git stashes. The latest remote merge and both documentation conflict resolutions retain the team's changes.

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

## Phone setup follow-up — ADR-020

Goal: create and confirm the first real event through iMessage without Auth0. The deterministic phone setup flow passes eight new tests, including signed simulated DMs through draft/JOIN/CONFIRM/task/invitation/worker proposal/actual fixture target YES. STOP/RESUME before enrollment, no cold invite send, anonymous app denial, replay, foreign/stale confirmation and unauthorized member task/approval are covered. Auth0 callback rejection applies only to the optional app/CLI route. Live two-phone M1 remains the gate; see [phone setup](12-deployment-and-operations.md#phone-only-event-setup).
