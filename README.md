# Rally

**Status:** Real Photon HELP and onboarding STATUS replies passed with user-confirmed phone receipt. The merged messaging/Domain backend plus scoped AI queue is deployed to the existing `calm-jackal-984` development backend. This Mac's constrained Codex worker is online, with real synthetic inference and simulated full-pipeline acceptance tests. **Live event coordination remains pending: the backend has no events or enrolled memberships yet.** Phone-only draft/JOIN/CONFIRM/task/invitation setup passes simulated signed-DM tests; Auth0 is optional for the companion app and authenticated CLI. See [AI evidence and setup](docs/22-local-ai-evidence.md), [messaging evidence](docs/19-messaging-evidence.md) and [domain setup](docs/20-domain-evidence.md).


**Primary experience:** iMessage via Photon Spectrum.  
**Companion experience:** lightweight SwiftUI iOS app for project/event setup, explicit contact selection, membership, and live status.  
**Backend recommendation:** Convex + TypeScript action engine.  
**Inference:** constrained Claude or Codex worker on an Apple Silicon Mac; deterministic fallback if unavailable.

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
| Language interpretation | Worker on this Mac invoking authenticated Claude or Codex CLI; runtime-validated JSON decisions |
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

## Workspace

```text
Rally/
  README.md                 # Setup and product specification
  AGENTS.md                 # Mandatory agent guidance
  CLAUDE.md                 # Claude Code entrypoint
  docs/                     # Design and acceptance criteria
  prompts/                  # Agent kickoff prompts per lane/checkpoint (docs/17)
  convex/                   # Messaging/domain functions, auth, reasoning queue and tests
  packages/shared/          # Zod schemas, fakes, fixtures, deterministic planner
  worker/                   # Local Claude/Codex adapters and polling loop
  tests/contracts/          # Cross-lane function inventory checks
  scripts/                  # Contract inventory command
  .github/workflows/        # npm ci + npm run check on PRs to main
```

The P1 [`ios/Rally/`](ios/Rally/README.md) companion is present with a tested local demo and Convex/Auth0 adapter. Live account provisioning, phone linking and the M2/ST-15 app acceptance flow remain incomplete.

## Local bootstrap checks

Use Node 24 LTS (`.nvmrc`) or Node 26+, and npm 11+. Dependencies are pinned in `package-lock.json`. The first bootstrap run needs the human-run Convex initialization below to produce `_generated` before the full check can pass; later checkouts use the committed generated files.

```sh
npm ci
npm run check
npm run contracts:list
```

`check` typechecks the root/Convex code and both workspaces, then runs contract, messaging, domain, planner and worker tests. Domain/messaging acceptance tests use explicit simulations; they do not prove real multi-phone coordination or live delivery.

For the required first development deployment, a human runs this in the repository root, signs in, and selects/creates the Rally development project:

```sh
npx convex dev
```

The CLI creates `.env.local` with `CONVEX_DEPLOYMENT`, generates `convex/_generated/`, and deploys the backend. Keep the generated files in version control. Keep `.env.local` private. Once configured, `npm run convex:codegen` refreshes generated definitions and `npx convex dev --once` validates/deploys one development update. Convex 1.46.0 code generation also requires deployment configuration.

For the worker, follow the [setup runbook](docs/12-deployment-and-operations.md#local-worker-implementation-and-setup). `npm run worker:configure` preserves or privately creates the matching development credential; `npm run worker` checks model login and backend authentication before polling. `npm run worker:status` prints sanitized heartbeat/queue aggregates using the operator's Convex CLI login. `npm run eval:fake` checks 20 scripted cases; `npm run eval:live` measures real inference on synthetic inputs without backend writes or sends. Real inference requires an explicitly selected available model. `.env.example` contains no usable credentials.

For P0, use [phone-only event setup](docs/12-deployment-and-operations.md#phone-only-event-setup): send `CREATE EVENT` to your provisioned Rally conversation for instructions, then create a draft, JOIN, and CONFIRM. Tasks, selected-contact invitations, and organizer approvals also work through deterministic iMessage commands. No Auth0 login or token copying is required.

For optional authenticated CLI event setup, `npm run auth:login` opens Rally's existing Auth0 Native application login, validates its returned ID token, and saves it in private `.env.local`. Append `http://127.0.0.1:8765/callback` to that application's Allowed Callback URLs, preserving the iOS callback. Then use `npm run domain:setup`; [the walkthrough](docs/20-domain-evidence.md#auth0-and-manual-event-setup) includes real phone proof and participant JOIN. An Auth0 dashboard login or Convex CLI login alone is not an app session.

Prompt 0 is complete only after local checks pass, the contract inventory is verified, and the first human-run development schema deployment succeeds. See [bootstrap contract and evidence](docs/18-bootstrap-contract.md) for decisions and current verification status.

## Next implementation steps

1. Join the existing Convex team and authenticate locally; confirm the development deployment used for Photon. Run `npm run messaging:configure` to check server configuration and create the server-only messaging key if absent.
2. Deploy with `npx convex dev --once`; configure the native Photon webhook at that deployment's `/spectrum/webhook`. Verify a real inbound and outbound DM before building AI. See [the runbook](docs/19-messaging-evidence.md).
3. Use [phone-only event setup](docs/12-deployment-and-operations.md#phone-only-event-setup) to create a draft, JOIN and CONFIRM, add timed tasks, and prepare invitations. Every recipient must send their own JOIN; setup never invents consent. Authenticated app/CLI setup remains an alternative.
4. Run `prompts/m1-messaging-domain.md`: verify genuine event JOIN/STATUS and a second participant's real YES committing one reassignment. The deterministic protocol already passes under `FakeMessagingAdapter`.
5. The integrated development backend and this Mac's Codex worker are configured. Complete phone event setup and actual opted-in JOIN before testing free-text requests and participant acceptance. Check `npm run worker:status`; the Mac must remain awake.
6. Finish the existing SwiftUI companion's live integration; add weather only after core flow is robust.

Do not copy pseudo-interfaces from these docs directly as if they are real SDK signatures; external APIs must be checked against pinned versions.

## Source of truth & decision tracking

- This is a **proposed implementation**, based on user-provided project requirements and the linked provider docs.
- Unknown provider behavior and outstanding decisions live in [`docs/14-decisions-and-open-questions.md`](docs/14-decisions-and-open-questions.md).
- External reference links and last-check notes live in [`docs/15-sources.md`](docs/15-sources.md).
- No production credentials, private contacts, or user conversations should be committed.
