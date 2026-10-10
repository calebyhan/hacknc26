# Parallel workstreams and prompt plan

How a 4-person team builds Rally in parallel. `13-build-plan.md` gives the single-sequence order; this doc splits the same work into lanes that run at the same time against shared contracts. Prompts to hand to coding agents live in [`../prompts/`](../prompts/).

## Principle

Parallel work only holds if every cross-lane interface exists **before** lanes start. Prompt 0 freezes those interfaces as typed stubs and fakes; afterwards each lane builds against fakes and never waits on another lane to start.

Two boundaries matter most (from `02-architecture.md`):

- **Messaging (A)** turns raw inbound into a typed `Command` and calls Domain functions. It never writes proposals/commitments/tasks directly.
- **AI (C)** turns free text into an `AgentDecision`. Domain (B) validates and executes it. The worker never writes domain state directly.

## Timeline

| Time | Bootstrap owner | Lane A — Messaging | Lane B — Domain | Lane C — AI | Lane D — iOS |
|---|---|---|---|---|---|
| 0–1.5h | **Prompt 0** | Photon sign-up (try `HACKNC` and `HACKWITHPHOTON`), connect iMessage, ask Photon Discord about group chat (ADR-012) | (is usually the bootstrap owner) | `claude -p` / Agent SDK spike: one-turn JSON latency, rate limits, model (blocking Q3) | Create Xcode project, choose auth provider (blocking Q4), contact-picker spike |
| 1.5–8h | — | `prompts/lane-a-messaging.md` | `prompts/lane-b-domain.md` | `prompts/lane-c-ai.md` | `prompts/lane-d-ios.md` |
| ~8h | — | **M1** (A+B pair): `prompts/m1-messaging-domain.md` | ← | continue | continue |
| 8–12h | — | continue | continue | continue | continue |
| ~12h | — | — | **M2** (B+C pair, D joins): `prompts/m2-ai-and-app.md` | ← | ← |
| 12–18h | — | P1 support, copy polish | W5 recovery (T7 planner) | Weather (T7 weather half) | App polish; widget only if ahead |
| ~18h | **M3** feature freeze (everyone): `prompts/m3-freeze.md` | | | | |
| 21–24h | **T8** hardening, led by A: `prompts/t8-demo-hardening.md` | | | | |

The bootstrap owner is normally the Lane B person, since B owns the shared contract afterwards.

### Checkpoints

| ID | When | Exit criterion |
|---|---|---|
| M0 | ~2h | Prompt 0 merged, `npm run check` green on `main`; Photon smoke test (one real inbound + reply) recorded in `14` |
| M1 | ~8h | A real Photon `YES` commits a reassignment once (A1/A2 live); ST-04–ST-07 pass under fakes |
| M2 | ~12h | “Can Jordan cover setup?” works end to end through the worker; ambiguous message asks; worker killed → ST-11 passes; iOS reads real queries |
| M3 | ~18h | P0 demo gate (`01`) met; P1 items either done or cut per `01` cut order; no new features after this |

If M1 slips past hour 10, Lane C and D pause and pair on M1. P0 end-to-end beats any lane's own progress.

## Contract frozen by Prompt 0

Names below are the contract. Prompt 0 creates them as stubs that throw `NOT_IMPLEMENTED(<lane>)`; the owning lane replaces the body without changing the signature. Changing a signature is a **contract PR** (see Merge protocol).

### `packages/shared` (pure TypeScript + Zod, no Convex imports)

| File | Contents | Implemented by |
|---|---|---|
| `enums.ts` | Every enum in `03-data-model.md#canonical-state-enums` as `as const` arrays + Zod enums | Prompt 0 |
| `agentDecision.ts` | `AgentDecision` Zod schema and action union from `05` (incl. forbidden-action rejection) | Prompt 0 |
| `contextPacket.ts` | Context packet Zod schema from `05` | Prompt 0 |
| `commands.ts` | `Command` union (`JOIN`, `YES`, `NO`, `STATUS`, `HELP`, `STOP`, `PAUSE`, `RESUME`, `LEAVE`, `UNKNOWN`) and `parseCommand(text)` | type: Prompt 0; parser: A |
| `adapters.ts` | `MessagingAdapter`, `InferenceProvider` interfaces; `FakeMessagingAdapter` (records sends), `FakeInferenceProvider` (scripted responses) | Prompt 0 |
| `copy.ts` | Outbound message templates (from `04` examples); input is structured state, never model text | A |
| `planner.ts`, `assignment.ts` | Candidate filter/score (`08`) | B |
| `context.ts` | Event resolver + packet builder logic (`02`, `05`) | C |
| `fixtures.ts` | Charity 5K / Hack Night seed data from `03#minimal-seed-fixture` | Prompt 0 |
| `domain.ts`, `primitives.ts` | Strict plain-record and primitive schemas supporting fixtures and lane-owned pure-function inputs | Prompt 0 |

### `convex/` (function names; `internal.*` = not callable by clients)

| Function | Kind | Owner | Purpose |
|---|---|---|---|
| `lib/auth.ts`: `requireUser`, `requireMember`, `requireOrganizer` | helpers | B | Identity + membership/role checks used by every public function |
| `events.myEvents`, `events.detail` | query | B | Read models for iOS and `STATUS` |
| `events.create`, `events.confirmDraft`, `tasks.create` | mutation | B | Organizer writes (iOS / W2 draft) |
| `seed.bootstrap` | internal mutation | B | Labeled ADR-013 bootstrap from `fixtures.ts` |
| `proposals.create`, `proposals.respond`, `proposals.organizerApprove`, `proposals.cancelForUser` | internal mutation | B | Proposal lifecycle, ADR-011 |
| `commitments.reportUnavailable` | internal mutation | B | Self-cancel / organizer override (ADR-011) |
| `domain.statusFor` | internal query | B | Structured status for a user (R9) |
| `domain.executeDecision` | internal mutation | B | Validate + execute an `AgentDecision` against current versions |
| `inbound.ingest` | internal mutation | A | Persist + dedupe by provider message ID |
| `commands.route` | internal mutation | A | `Command` → domain call or reasoning job |
| `invitations.createForContacts` | mutation | A | Organizer creates invitations for selected contacts (no send) |
| `invitations.redeem` | internal mutation | A | `JOIN <code>` → membership `enrolled`, consent recorded |
| `identity.setMessagingState` | internal mutation | A | `STOP`/`PAUSE`/`RESUME`; calls `proposals.cancelForUser` on STOP |
| `outbox.enqueue` | internal mutation | A | Single path for every outbound message; consent check + idempotency key |
| `reasoningJobs.enqueue` | internal mutation | C | Queue a job for a non-command message |
| `reasoningJobs.claim`, `reasoningJobs.complete`, `reasoningJobs.heartbeat` | public mutation, worker-token-guarded when implemented | C | Leased worker queue (`02`); stubs currently reject every call |
| `context.buildPacket` | internal query | C | Minimal scoped packet for a job |
| `weather.check` + `crons.ts` | internal action | C | P1 weather watch (`09`) |

Prompt 0's concrete argument/return validators live with each function; the accompanying [bootstrap contract](18-bootstrap-contract.md) documents wire shapes and secure implementation requirements. The table above describes the frozen base contract. Lane A messaging and Lane B domain/auth implementations now have test evidence; Lane C remains stubbed. Additive Lane B contracts and review boundaries are recorded in [domain evidence](20-domain-evidence.md). `weather.check` exists, but `crons.ts` registers no jobs until Lane C implements P1. `seed.bootstrap` remains internal and preserves ADR-013's organizer authorization; internal visibility alone is not permission or participant consent.

## File ownership

| Path | Owner | Others may |
|---|---|---|
| `packages/shared/{enums,agentDecision,contextPacket,adapters,fixtures,domain,primitives}.ts`, `convex/schema.ts` | B (after Prompt 0) | Propose via contract PR only |
| `convex/http.ts`, `convex/convex.config.ts`, `convex/{spectrum,inbound,outbox,invitations,identity,commands}.ts`, `packages/shared/{commands,copy}.ts` | A | Read |
| `convex/{events,tasks,proposals,commitments,domain,seed}.ts`, `convex/lib/auth.ts`, `packages/shared/{planner,assignment}.ts` | B | Read; call public/internal functions |
| `worker/`, `convex/{reasoningJobs,context,weather,crons}.ts`, `packages/shared/context.ts`, `tests/eval/` | C | Read |
| `ios/` | D | — |
| `tests/fixtures/`, `tests/integration/` | Shared; add files, don't rewrite others' | — |
| `docs/` | Anyone; decisions go in `14` | — |

Membership writes: A owns `invited → enrolled → left` and `users.messagingState`; B owns everything about events, tasks, commitments, proposals, availability.

## Merge protocol

- One branch per lane (`lane-a/<topic>` …); agents on the same machine use separate git worktrees.
- Small PRs into `main`; `npm run check` (typecheck + unit + Convex tests) must pass before merge. iOS builds are checked locally by D.
- **Contract PR:** any change to a file in the first ownership row or to a function signature in the contract table. Title prefix `contract:`, B reviews, every affected lane acknowledges before merge. Additive changes (new optional field, new function) are fine; renames and removals wait for a checkpoint.
- Record provider/SDK findings and new decisions in `14-decisions-and-open-questions.md` in the same PR.

## Smaller teams

| Team | Lanes |
|---|---|
| 3 | A, B, C as above; C also takes iOS (T6 status screen only, ADR-013 keeps it off P0); widget cut |
| 2 | Backend = A+B; AI+app = C then a single iOS status screen; weather only after M2 |
| 1 | Follow `13-build-plan.md` sequentially; run lane prompts one after another |

## Prompt index

| File | Run by | When |
|---|---|---|
| `prompts/00-bootstrap.md` | Bootstrap owner | Hour 0 |
| `prompts/lane-a-messaging.md` | Lane A | After M0 (step 0 at hour 0) |
| `prompts/lane-b-domain.md` | Lane B | After M0 |
| `prompts/lane-c-ai.md` | Lane C | After M0 (step 0 at hour 0) |
| `prompts/lane-d-ios.md` | Lane D | Hour 0 (Xcode work doesn't need M0) |
| `prompts/m1-messaging-domain.md` | A + B | ~8h |
| `prompts/m2-ai-and-app.md` | B + C, D | ~12h |
| `prompts/m3-freeze.md` | Everyone | ~18h |
| `prompts/t8-demo-hardening.md` | A leads | 21h |
