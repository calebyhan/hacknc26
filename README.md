# Rally

> An iMessage-first group coordination agent that remembers what people committed to, keeps everyone aligned, and proposes the smallest safe change when plans break.

**Primary interface:** iMessage via Photon Spectrum. **Companion:** SwiftUI iOS app for setup, roster and live status. **Backend:** Convex + TypeScript. **Language understanding:** a constrained local Claude/Codex worker, with a deterministic fallback.

## Status

- **Automated:** `npm run check` passes 572 tests (one optional test skipped) with strict TypeScript. `npm run demo:rehearse` runs the whole coordination flow in simulation, with no phones or credentials. The scripted eval passes 29/29; the real-model eval on synthetic inputs passed 27/29 before a targeted prompt fix (corpus: `tests/eval/corpus.ts`; results: `tests/eval/results/`).
- **Live:** real JOIN, STATUS, guided setup, team staffing, organizer approval, overlap confirmation and assignment acceptance have been observed on real phones.
- **Still unverified:** target NO, message replay, STOP/RESUME, a worker-outage drill, long-lived iOS token refresh, and the final M3 release gate. Weather and other stretch features are cut from the demo.

Details and evidence: [`docs/23-demo-readiness.md`](docs/23-demo-readiness.md). Demo script: [`docs/DEMO.md`](docs/DEMO.md).

## The experience

1. The organizer creates an event and tasks by texting Rally (or in the iOS app) and invites people.
2. Each invitee opts in by texting `join <event name>` from their own phone. Choosing a contact is **not** messaging consent.
3. The organizer texts "Can Yewon also join me on Setup?" Rally sends Yewon an offer and changes nothing yet.
4. Yewon replies `YES Setup`. If it overlaps another commitment, Rally warns her and waits for `CONFIRM OVERLAP Setup`.
5. Rally commits the change exactly once, notifies the people affected and records the decision. `STATUS` over iMessage and the iOS app show the same state.

## Principles

- **iMessage-first:** everyday workflows never require the app.
- **Human-in-the-loop:** requests are proposals until the affected person and/or organizer approves.
- **Never invent commitments:** nothing is "confirmed" without an accepted reply or an authorized update.
- **Minimal context:** each model call gets only the scoped state it needs, never the whole address book or other events.
- **Distinguish** delivery, proposal, committed change and pending response.

Core invariants: phone contact selection ≠ consent; LLM text ≠ authorization; proposed assignment ≠ confirmed assignment; an unverified event reference ≠ permission; a successful HTTP call ≠ user acceptance.

## Stack

| Layer | Implementation |
|---|---|
| iMessage | Photon Spectrum (`@spectrum-ts/convex`) |
| State, scheduler, outbox | Convex tables and auth-checked functions |
| Language interpretation | Worker on an Apple Silicon Mac invoking the Claude or Codex CLI; output validated against Zod schemas |
| Deterministic logic | TypeScript state machines, eligibility and reassignment rules |
| Companion app | SwiftUI, Auth0, Convex Swift client |

**Constraints:** Photon Pro shared numbers are not dedicated lines and may not allow group chats, so the MVP uses separate opted-in 1:1 conversations. A Claude Code subscription is rate-limited and does not run model weights locally. The Mac worker is a single point of failure, so YES/NO, STATUS, JOIN and approvals work without inference.

## Repository layout

```text
convex/             Messaging, domain, auth, reasoning queue and tests
packages/shared/    Zod schemas, fakes, fixtures, deterministic planner
worker/             Claude/Codex adapters, polling loop, eval runner
ios/Rally/          SwiftUI companion (see ios/Rally/README.md)
tests/              Contract, integration and eval suites
scripts/            Contract inventory and setup scripts
prompts/            Agent kickoff prompts per lane/checkpoint
docs/               Design, acceptance criteria, evidence (start at docs/INDEX.md)
```

## Getting started

Requires Node 24 LTS (`.nvmrc`) or 26+, and npm 11+.

```sh
npm ci
npm run check            # typecheck + all tests
npm run contracts:list   # inventory of the 46 registered Convex functions
npm run demo:rehearse    # simulated end-to-end rehearsal
npm run eval:fake        # scripted 29-case harness check
```

### Backend

A human runs `npx convex dev` once in the repo root, signs in and selects the Rally development project. This creates `.env.local` (keep it private) and `convex/_generated/` (committed). Afterwards `npm run convex:codegen` refreshes definitions and `npx convex dev --once` validates and deploys one update.

Configure messaging with `npm run messaging:configure`, then point the Photon webhook at the deployment's `/spectrum/webhook`. See [`docs/19-messaging-evidence.md`](docs/19-messaging-evidence.md).

### Worker

Follow the [setup runbook](docs/12-deployment-and-operations.md#local-worker-implementation-and-setup).

```sh
npm run worker:configure   # create or preserve the matching dev credential
npm run worker             # checks model login and backend auth, then polls
npm run worker:status      # sanitized heartbeat and queue aggregates
npm run eval:live          # real inference on synthetic inputs; no backend writes or sends
```

Real inference needs an explicitly selected, available model (`RALLY_PROVIDER`, `RALLY_MODEL`). `.env.example` contains no usable credentials. Keep the Mac awake while the worker runs.

### Event setup

- **Phone only (P0):** text `create an event` to your Rally conversation, then `add a task` and `invite someone`. Every participant must send their own `join`. See [phone-only setup](docs/12-deployment-and-operations.md#phone-only-event-setup).
- **Authenticated CLI (optional):** `npm run auth:login`, then `npm run domain:setup`. Add `http://127.0.0.1:8765/callback` to the Auth0 Native app's Allowed Callback URLs, keeping the iOS callback. See [the walkthrough](docs/20-domain-evidence.md#auth0-and-manual-event-setup).

## Documentation

Start with [`AGENTS.md`](AGENTS.md) (coding-agent rules) and the full map in [`docs/INDEX.md`](docs/INDEX.md). Most useful for newcomers:

| Topic | File |
|---|---|
| Product vision and users | [`docs/00-product-vision.md`](docs/00-product-vision.md) |
| Scope and acceptance tests | [`docs/01-scope-and-acceptance.md`](docs/01-scope-and-acceptance.md) |
| Architecture and write ownership | [`docs/02-architecture.md`](docs/02-architecture.md) |
| Data model | [`docs/03-data-model.md`](docs/03-data-model.md) |
| Messaging, agent reasoning, workflows | [`docs/04-messaging-and-photon.md`](docs/04-messaging-and-photon.md), [`docs/05-agent-reasoning.md`](docs/05-agent-reasoning.md), [`docs/06-workflows.md`](docs/06-workflows.md) |
| Security and privacy | [`docs/10-security-privacy.md`](docs/10-security-privacy.md) |
| Testing and demo | [`docs/11-testing-and-demo.md`](docs/11-testing-and-demo.md), [`docs/DEMO.md`](docs/DEMO.md) |
| Decisions and open questions | [`docs/14-decisions-and-open-questions.md`](docs/14-decisions-and-open-questions.md) |

Source-of-truth order: explicit user direction > current tests and working code > current ADRs > proposed docs > external examples. Provider behavior and SDK signatures must be checked against pinned versions, not copied from pseudo-interfaces in the docs. Sources and last-check notes are in [`docs/15-sources.md`](docs/15-sources.md).

Never commit production credentials, private contacts or user conversations.
