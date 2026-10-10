# Lane B — Domain engine (auth, events, proposals, commitments, planner)

You own the deterministic core: authorization, event/task state, the proposal → acceptance → commit protocol, ADR-011 policy, versioning, and later the replacement planner. Tickets **T1**, **T3**, then the planner half of **T7**. You also own the shared contract after Prompt 0.

Everything you build must work with **no Photon and no Claude**. Use `FakeMessagingAdapter` and assert on `outbox` rows.

## Read first

1. `AGENTS.md`
2. `docs/03-data-model.md` (all of it, especially canonical enums and invariants 3–7, 11)
3. `docs/06-workflows.md` — W2, W3, W5, status vocabulary
4. `docs/14-decisions-and-open-questions.md` — ADR-011, ADR-013, ADR-015
5. `docs/08-planning-and-reassignment.md` (for the planner, later)
6. `docs/17-workstreams.md` — contract, ownership, merge protocol

## You own

`convex/{events,tasks,proposals,commitments,domain,seed}.ts`, `convex/lib/auth.ts`, `packages/shared/{planner,assignment}.ts`, and the contract files (`packages/shared/{enums,agentDecision,contextPacket,adapters,fixtures}.ts`, `convex/schema.ts`). You review every `contract:` PR.

## Tasks, in order

1. **`lib/auth.ts` first** (A and D depend on it). `requireUser` from the Convex auth identity; `requireMember(eventId)` and `requireOrganizer(eventId)` via `memberships.by_event_user`. Unauthorized callers get the same error whether or not the event exists (invariant 8).
2. **`seed.bootstrap`.** Labeled ADR-013 bootstrap from `fixtures.ts`, running through the same validation as real mutations. Idempotent.
3. **Events/tasks (T1).** `events.create`, `events.confirmDraft` (`draft → scheduled`), `tasks.create`, `events.myEvents`, `events.detail`. `detail` returns display labels derived per `06#status-vocabulary`, never stored labels. Version bumps per ADR-015: event-level fields bump `events.version`; task changes bump that task's `version`.
4. **Proposals (T3).**
   - `proposals.create`: stores `eventVersionAtCreation`, `taskVersionAtCreation`, `expiresAt`, `requiresOrganizerApproval` per ADR-011, `idempotencyKey`. Enqueues exactly one request via `internal.outbox.enqueue` (Lane A; stub until merged).
   - `proposals.respond`: only the target (or authorized override) can respond. In one mutation, recheck `pending`, TTL, event + task version, capacity against `active` commitments, and conflicts. `YES` → new commitment `active`, prior commitment `released` when it's a replacement, task `confirmed`, audit, outbox notices (organizer, new assignee, released person). `NO`/expiry → no change to committed state (W3 table).
   - Repeated `YES` is a no-op with one truthful reply. A competing acceptance → `superseded` and a truthful message (A10).
   - `proposals.organizerApprove`, `proposals.cancelForUser` (used by A on STOP/LEAVE).
5. **`commitments.reportUnavailable`.** The three ADR-011 cases: self-cancel → `canceled_by_participant`; organizer report → `released` (audited override); non-organizer about someone else → no write.
6. **`domain.statusFor`.** Structured status scoped to the user's memberships (R9). No data from events they're not in.
7. **`domain.executeDecision`.** Validate an `AgentDecision` (Zod), resolve refs against **that event's** members/tasks only, recheck versions, map each action to the functions above. Consequential cross-person actions become proposals, never direct commits. Fail closed on anything unresolved.
8. **After M1: planner (T7, `08`).** Hard-constraint filter, documented score, deterministic tie-break by ID, `NO_ELIGIBLE_CANDIDATE` reason code. W5: planner-recommended candidate needs organizer approval before contacting them.

## Tests you must make pass

ST-04, ST-05, ST-06, ST-08, ST-09, ST-10, ST-13, ST-18 and ST-11 (worker absent) under fakes; T1/T3 ticket tests in `docs/16`; planner tests listed in `08`. Use `convex-test` for mutation-level tests. Include a race test for ST-13 (two `respond` calls for one capacity-1 task).

## Done when (for M1)

All tests above pass with `FakeMessagingAdapter`; outbox rows show exactly one notification per business action. Paste the test output.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.** List any contract changes you made and which lanes acknowledged them.
