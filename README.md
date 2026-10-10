# Rally

**Status:** implementation specification / hackathon prototype; **no functioning product is implied by this repository's documentation**.  
**Primary experience:** iMessage via Photon Spectrum.  
**Companion experience:** lightweight SwiftUI iOS app for project/event setup, explicit contact selection, membership, and live status.  
**Backend recommendation:** Convex + TypeScript action engine.  
**Inference:** constrained Claude worker on an Apple Silicon Mac; deterministic fallback if unavailable.

> **One-sentence pitch:** Rally is an iMessage-first group coordination agent that remembers what people committed to, keeps everyone aligned, and proposes the smallest safe change when plans break.

## The experience we are building

1. Organizer creates a **Charity 5K** event in the iOS companion app and selects participants from Contacts. *(App is P1; for P0 the event is created via iMessage draft or a labeled bootstrap script — ADR-013.)*
2. Selected contacts receive an invitation *through a compliant, user-initiated channel*; each participant opts in by texting Rally before receiving automated DMs. A contact selection alone is **not** messaging consent.
3. Organizer texts, “Can Jordan take over setup? Maya can't make it.” Rally knows the sender's relevant event(s), resolves ambiguity or asks which event, checks obligations, and requests Jordan's consent.
4. Jordan replies “yes.” Rally commits the change exactly once, notifies relevant participants, and records the decision.
5. A weather change can later prompt Rally to **propose**, not silently enact, an event adjustment.
6. The app (P1) reflects verified state; `STATUS` over iMessage gives the same answer. iMessage remains the default day-to-day interface.

## Core product principles

- **iMessage-first:** do not make everyday workflows require opening the app.
- **Human-in-the-loop:** requests are *proposals* until the affected person and/or organizer approves.
- **Never invent commitments:** no “confirmed” status without an actual accepted reply or an authorized update.
- **Minimal context, minimal latency:** retrieve relevant state; don't send an entire address book or every message to Claude.
- **A plan is live state:** track responsibilities, dependencies, availability, consent, and changes—not just an itinerary.
- **Always distinguish actual delivery, proposed action, committed change, and pending response.**

## Stack and deployment shape

| Layer | Proposed implementation |
|---|---|
| iMessage | Photon Spectrum, preferably official `@spectrum-ts/convex` adapter if verified in the selected version |
| Persisted state + scheduler | Convex functions/tables, auth-checked queries and mutations |
| Language interpretation | Local worker on Mac invoking Claude Agent SDK / `claude -p` within subscription entitlements; JSON-only constrained output |
| Deterministic logic | TypeScript schemas, state machines, eligibility and reassignment scoring |
| Companion app | SwiftUI; Convex Swift client or authenticated server endpoints |
| Weather (stretch/high-priority) | Open-Meteo noncommercial API; saved snapshots and explicit trigger rules |

**Critical product constraints:** Photon Pro shared numbers are not a dedicated line and may not allow group chat management. Design an MVP around separate, opted-in 1:1 conversations. A Claude Code subscription is **not** unlimited model capacity and does **not** run Claude weights locally. The Mac worker is a single point of failure; known actions must continue without inference.

## First milestone: the vertical slice

A **real** Photon message from a verified participant refers to an existing event; Rally identifies it, seeks a second participant's approval, processes that person's **actual** reply, changes the task assignment in Convex, and sends a confirmation. Duplicate webhooks and repeat replies do not duplicate the assignment or outbound notifications.

**Definition of done:** all acceptance scenarios in [`docs/01-scope-and-acceptance.md`](docs/01-scope-and-acceptance.md) pass; the live scenario in [`docs/11-testing-and-demo.md`](docs/11-testing-and-demo.md) works without manually editing Convex data during the flow.

## Read the documentation in this order

1. [`AGENTS.md`](AGENTS.md) — coding-agent rules and start sequence.
2. [`docs/00-product-vision.md`](docs/00-product-vision.md) — product semantics and judges' expectations.
3. [`docs/01-scope-and-acceptance.md`](docs/01-scope-and-acceptance.md) — P0/P1/P2 boundaries and acceptance tests.
4. [`docs/02-architecture.md`](docs/02-architecture.md) — architecture and ownership of writes.
5. [`docs/03-data-model.md`](docs/03-data-model.md) — entities and invariants.
6. [`docs/04-messaging-and-photon.md`](docs/04-messaging-and-photon.md), [`docs/05-agent-reasoning.md`](docs/05-agent-reasoning.md) — inbound/outbound and inference.
7. [`docs/06-workflows.md`](docs/06-workflows.md) — behavior and state machines.
8. [`docs/10-security-privacy.md`](docs/10-security-privacy.md) — trust boundaries, consent and abuse rules.
9. [`docs/11-testing-and-demo.md`](docs/11-testing-and-demo.md) — exact tests and demo.
10. [`docs/14-decisions-and-open-questions.md`](docs/14-decisions-and-open-questions.md) — ADRs and unverified provider behavior.

Full index: [`docs/INDEX.md`](docs/INDEX.md).

## Suggested workspace (not yet implemented)

```text
Rally/
  README.md                 # This spec bundle
  AGENTS.md                 # Mandatory agent guidance
  CLAUDE.md                 # Claude Code entrypoint
  docs/                     # Design and acceptance criteria
  convex/                   # Convex schema, routes, functions, tasks
  packages/shared/          # Zod schemas, pure planners, typed contracts
  worker/                   # Local Claude inference worker
  ios/Rally/                # SwiftUI application
  tests/                    # Fixtures, unit & integration tests
```

## Getting started: implementation, not pretend commands

1. Verify toolchain: Xcode, Node.js LTS, npm, Convex CLI, Photon dashboard access, Claude Code login.
2. Create development Convex deployment, register Spectrum integration following **current** package docs; verify a real inbound and outbound message **before** building AI.
3. Create the minimal tables, roles, and invitation/phone-linking workflow.
4. Implement deterministic task assignment / confirmations using a fake messaging adapter first, then wire Photon.
5. Add the local model worker only after the deterministic vertical slice is passing.
6. Add SwiftUI setup and status; add weather only after core flow is robust.

Do not copy pseudo-interfaces from these docs directly as if they are real SDK signatures; external APIs must be checked against pinned versions.

## Source of truth & decision tracking

- This is a **proposed implementation**, based on user-provided project requirements and the linked provider docs.
- Unknown provider behavior and outstanding decisions live in [`docs/14-decisions-and-open-questions.md`](docs/14-decisions-and-open-questions.md).
- External reference links and last-check notes live in [`docs/15-sources.md`](docs/15-sources.md).
- No production credentials, private contacts, or user conversations should be committed.
