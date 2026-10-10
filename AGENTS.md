# Agent instructions for Rally

Read **this file first** when operating as a coding agent in this repository. The docs represent proposed product requirements, not existing implementation. Do not claim a feature is implemented without running its test.

## North-star outcome

Build the smallest working end-to-end **human-in-the-loop group coordination** flow across an actual Photon iMessage DM and a shared backend. Keep everyday UX in iMessage. The iOS app is setup/status, not a chat replacement.

## Mandatory reading order

1. `README.md`
2. `docs/01-scope-and-acceptance.md`
3. `docs/02-architecture.md`
4. `docs/03-data-model.md`
5. `docs/04-messaging-and-photon.md`
6. `docs/05-agent-reasoning.md`
7. `docs/06-workflows.md`
8. `docs/10-security-privacy.md`
9. `docs/11-testing-and-demo.md`
10. `docs/14-decisions-and-open-questions.md`

Use `docs/INDEX.md` for the remainder.

## Before editing code

- Inspect existing files and tests. Do not overwrite a partially implemented repository.
- Identify the current vertical-slice milestone and report what is blocked.
- Verify installed SDK versions and public interfaces. Code examples in external docs can change.
- Resolve only immediate blocking decisions; keep alternatives in the decision log.
- Define tests for new state transitions before invoking a model or messaging provider.

## Implementation rules

- TypeScript strict mode; define all message/intent/plan schemas in one shared package with runtime validation (e.g. Zod).
- Every public Convex function must validate identity **and membership/role**. Protect worker operations using server-verified credentials. Use internal functions for privileged orchestration.
- Persist inbound message IDs and deduplicate before any side effect. Use an outbox with unique idempotency keys for sends.
- **LLM output is untrusted data**. Validate, authorize, check event version, and require approvals for consequential actions.
- Never mark a task confirmed based on model text or an outbound request. Only the correct participant's acceptance (or authorized override) changes it.
- Never reveal private schedule/budget/contact information across unrelated events.
- Avoid sending to numbers that have not opted in or established a permitted inbound conversation.
- Handle weather as an external **signal**, not blanket approval to reschedule people.
- Run the core confirmation/status/cancellation paths with no model access.
- Do not put Claude Code shell or filesystem operations under the control of an arbitrary SMS/iMessage sender. Give the runtime model no broad computer tools.
- For all external side effects: distinguish `proposed`, `queued`, `sent`, `delivered` (only with receipt), `confirmed`, `failed`.
- Keep local secrets in environment configuration, never git. Use fixtures and fake recipients for tests.

## Scope guardrails

P0: real inbound/outbound, event membership, event resolution, task proposal, opt-in, approval, verified state updates, fallback tests.
P1: weather watch, replanning on cancellation, small app status view, structured photo extraction if time.
P2: home screen widget, extensive integrations, custom iMessage mini apps, generic project automation.

If behind schedule, cut P2 first, then P1. Do not sacrifice P0 end-to-end operation.

## Working protocol

For each task, state:
- **Goal:** user-visible behavior.
- **Changed files:** precise locations.
- **Acceptance evidence:** commands run, test names, logs/sanitized trace, or why not tested.
- **Risks/open questions:** specifically unanswered SDK/provider details.

Do not silently substitute a mocked provider for real Photon in demo documentation. Every simulated input or alert must be labeled.

## First four coding tasks

1. Setup the repo and deterministic domain/test harness (`participants`, `events`, `memberships`, `tasks`, `pendingActions`).
2. Integrate Photon/Convex to **receive and send a real opted-in DM**; persist and dedupe.
3. Build `propose_reassignment → accept/reject → commit` as a deterministic, idempotent workflow.
4. Add compact-context event resolver and constrained Claude worker behind an adapter.

## Definition of quality

A partial but reliably working product is preferable to a broad set of demo-only flows. If real delivery, auth, and group permissions aren't available, report the blocker openly and keep an honest simulation fixture without labeling it real.
