# Prompt 0 — contract and verification

Goal: give lanes A–D a shared, testable interface before they implement Rally's coordination flow. This is scaffolding: all backend handlers, auth helpers, command parsing, copy, context and planning functions throw `NOT_IMPLEMENTED(<lane>)`. The only working runtime behavior is schema validation, explicit simulation adapters, fixture data, and worker configuration checks.

## Toolchain

Verified on 2026-10-10 using `node --version`, `npm --version`, npm registry metadata and installed package interfaces:

| Tool/package | Version |
|---|---|
| Local Node | 26.0.0 |
| Local npm | 11.12.1 |
| CI Node | 24 LTS, selected by `.nvmrc` |
| Convex package/CLI | 1.46.0 |
| Zod | 4.6.5 |
| TypeScript | 7.0.2 |
| Vitest | 5.0.3 |
| convex-test | 0.0.61 |
| Edge runtime test VM | 5.0.0 |

The lockfile pins dependencies; `npm ci` is the reproducible install command. Spectrum, Claude SDK, and Convex Swift are intentionally absent. They remain owning-lane verification work.

Setup references checked: [Convex CLI](https://docs.convex.dev/cli/overview), [Convex argument/return validation](https://docs.convex.dev/functions/validation), [convex-test](https://docs.convex.dev/testing/convex-test), [Zod](https://zod.dev/), [Vitest](https://vitest.dev/guide/), [TypeScript installation](https://www.typescriptlang.org/download/) and [strict mode](https://www.typescriptlang.org/tsconfig/strict.html). Installed CLI `--help`, registration types and test interfaces were inspected as well.

## Shared contract

`@rally/shared` exports the full package; `@rally/shared/<file>` permits narrow imports. It contains no Convex imports.

- `enums.ts`: every canonical persisted state/category from `03`, as constant arrays, Zod enums and inferred types. Convex builds literal unions from the same arrays.
- `agentDecision.ts`: eleven action types; strict nested objects; unknown actions/fields rejected; one to eight actions; `needsClarification` must exactly match ambiguous confidence; ambiguous decisions can only ask for clarification.
- `contextPacket.ts`: bounded, strict minimized packet matching `05`; no phone/contact-list fields. Membership scoping is future trusted backend logic, not something Zod can prove.
- `commands.ts`: all nine deterministic commands plus `UNKNOWN`; `parseCommand(text)` is Lane A's stub.
- `adapters.ts`: `send(SendRequest) -> Promise<SendResult>` and `decide(ContextPacket) -> Promise<AgentDecision>`. Send requests contain an idempotency key, user ID, phone, content and optional event/proposal IDs. Send results are `sent`, `failed`, or `unknown`, with optional provider ID/error code; they cannot claim `delivered`. The fake records every attempt, including repeats, and can simulate failure or uncertain timeout. The inference fake returns validated scripts keyed by exact incoming text.
- `domain.ts`, `primitives.ts`, `fixtures.ts`: typed plain fixture records and validation, using `id` rather than Convex `_id`. Fixtures are explicitly simulated and use fake `+1555…` recipients and fake consent references. They do not authorize real outreach.
- `copy.ts`: `renderMessage(input)` is Lane A's stub.
- `planner.ts`, `assignment.ts`: `filterEligibleCandidates`, `scoreCandidate`, `rankCandidates`, `planAssignment`, `findAffectedTasks` are Lane B's stubs.
- `context.ts`: `resolveEvent(input)` and `buildContextPacket(input)` are Lane C's stubs.

Model packet/action dates use ISO timestamps; persisted domain dates use Unix milliseconds. Lane B/C own the validated conversion. These distinct representations must not be cast directly into each other.

## Backend contract

All 16 tables and indexes from `03` are declared. Indexes are not unique constraints; future mutations must enforce uniqueness atomically. No table contains a direct task assignee field: assignees come from active commitments.

Each function declares argument and return validators. Typed source signatures are the precise contract; the following table summarizes the cross-lane inputs/results. `?` means optional. IDs are Convex table IDs, and names such as `EventDetail` refer to read validators in `convex/lib/validators.ts`.

| Function | Arguments → result |
|---|---|
| `events.myEvents` | `{}` → `EventSummary[]` |
| `events.detail` | `{eventId}` → `EventDetail` |
| `events.create` | `{title,kind,startsAt,timezone,location?,weatherPolicy?,idempotencyKey}` → event ID |
| `events.confirmDraft` | `{eventId,expectedVersion}` → event ID |
| `tasks.create` | `{eventId,title,location?,windowStart?,windowEnd?,requiredSkills?,capacity?,dependsOnTaskIds?,expectedEventVersion,idempotencyKey}` → task ID |
| `seed.bootstrap` | `{}` → `{eventIds,taskIds,invitationIds}` |
| `proposals.create` | `{eventId,originatorId,sourceMessageId,type,subjectId?,targetTaskId?,targetUserId?,taskChangeJson?,expectedEventVersion,expectedTaskVersion?,expiresAt,idempotencyKey}` → proposal ID |
| `proposals.respond` | `{proposalId,actorId,sourceMessageId,response:accept\|decline}` → proposal state |
| `proposals.organizerApprove` | `{proposalId,actorId,sourceMessageId}` → null |
| `proposals.cancelForUser` | `{userId,eventId?,sourceMessageId,reason:stopped\|left}` → proposal IDs |
| `commitments.reportUnavailable` | `{eventId,actorId,participantId,taskId?,window?:{startsAt,endsAt},sourceMessageId,expectedEventVersion}` → commitment IDs |
| `domain.statusFor` | `{userId,eventId?}` → `{events:EventDetail[]}` |
| `domain.executeDecision` | `{jobId,decisionJson}` → `{proposalIds,commitmentIds,needsClarification}` |
| `inbound.ingest` | `{provider,providerMessageId,senderPhone,receivedAt,contentType,bodyRedactedOrEncrypted?}` → `{messageId,duplicate}` |
| `commands.route` | `{messageId}` → null |
| `invitations.createForContacts` | `{eventId,contacts:[{displayName,phoneE164}],idempotencyKey}` → `[{invitationId,contactSelectionId,code,expiresAt}]` |
| `invitations.redeem` | `{messageId,code}` → `{redeemed:false}` or `{redeemed:true,userId,eventId?}` |
| `identity.setMessagingState` | `{messageId,state}` → null |
| `outbox.enqueue` | `{idempotencyKey,recipientUserId,eventId?,proposalId?,content,directReplyToMessageId?}` → outbound ID |
| `reasoningJobs.enqueue` | `{messageId,eventId,contextVersion,taskVersions:[{taskId,version}]}` → job ID; event/version explicitly nullable for unscoped drafting/clarification |
| `reasoningJobs.claim` | `{workerToken,workerId}` → null or `{jobId,leaseToken,leaseUntil,contextVersion,taskVersions,packetJson}` |
| `reasoningJobs.complete` | `{workerToken,workerId,jobId,leaseToken,decisionJson}` → null |
| `reasoningJobs.heartbeat` | `{workerToken,workerId,modelId?,lastError?}` → null |
| `context.buildPacket` | `{jobId}` → `{packetJson}` |
| `weather.check` | `{eventId}` → null |

Auth helpers: `requireUser(ctx)` returns a user document; `requireMember(ctx,eventId)` and `requireOrganizer(ctx,eventId)` return `{user,membership}`. All three currently throw.

Implementation rules for owning lanes:

- Public app operations must derive identity from `ctx.auth` and verify membership/role. Internal actor IDs are evidence references, never independent proof of identity.
- Public worker mutations must verify the server-side credential before data access, then verify claim ownership, lease token/expiry, sender membership and stored versions. The bootstrap's token arguments are not implemented authentication.
- `decisionJson`, `packetJson` and `taskChangeJson` must pass the shared Zod schemas after JSON parsing. Their Convex string validators are wire-format checks only.
- Job event scope, event/task versions and unique lease token persist independently of model output. Explicit null-scope jobs permit only first-event draft, clarification or no action, and contain no task-version snapshot. They cannot change existing events.
- Direct-reply outbox evidence persists so the dispatcher can recheck the narrowly permitted onboarding/STOP reply at send time.
- `seed.bootstrap` remains internal. Lane B must require authenticated organizer identity and reuse authorized domain creation helpers. Administrative CLI access and simulated consent are not substitutes for those checks or real `JOIN` messages.
- `convex/http.ts` has no routes. `convex/crons.ts` registers no jobs. The weather stub is never scheduled by Prompt 0.

## Verification status

Prompt 0's local and deployment gates passed on 2026-10-10. Human setup created the private `.env.local` configuration and official generated bindings. A subsequent `npx convex dev --once --typecheck enable --tail-logs disable` successfully deployed the current schema and stubs to the configured **cloud development deployment**. Generated bindings are included in the source handoff; `.env.local` remains gitignored.

Completed locally:

```text
npm ci
added 51 packages, and audited 54 packages in 1s
found 0 vulnerabilities

npm run check
> npm run typecheck && vitest run
> tsc --noEmit -p tsconfig.json && npm run typecheck --workspaces
@rally/shared: typecheck passed
@rally/worker: typecheck passed
Test Files  5 passed (5)
Tests       64 passed (64)

npx --no-install convex dev --once --typecheck enable --tail-logs disable
✔ 14:36:39 Convex functions ready! (1.48s)

npm ls --depth=0
All pinned dependencies and both workspaces resolved.

git diff --check
Passed.
```

The function inventory below comes from `npm run contracts:list`, which reads exported registrations from source. The passing runtime inventory test independently checked all 25 registrations, visibility/kind, argument/return validators and explicit worker-token arguments. The other tests cover shared strict schemas/fakes/fixtures, worker configuration and exit behavior, actual in-memory Convex schema validation, and inert public/internal/auth stubs. These are bootstrap tests: no P0 acceptance scenario, real delivery, app authentication or live worker behavior is marked complete. GitHub Actions is configured but has not been run remotely in this task.

## Generated function inventory

```text
commands.route	internal mutation
commitments.reportUnavailable	internal mutation
context.buildPacket	internal query
domain.statusFor	internal query
domain.executeDecision	internal mutation
events.myEvents	public query
events.detail	public query
events.create	public mutation
events.confirmDraft	public mutation
identity.setMessagingState	internal mutation
inbound.ingest	internal mutation
invitations.createForContacts	public mutation
invitations.redeem	internal mutation
outbox.enqueue	internal mutation
proposals.create	internal mutation
proposals.respond	internal mutation
proposals.organizerApprove	internal mutation
proposals.cancelForUser	internal mutation
reasoningJobs.enqueue	internal mutation
reasoningJobs.claim	public mutation
reasoningJobs.complete	public mutation
reasoningJobs.heartbeat	public mutation
seed.bootstrap	internal mutation
tasks.create	public mutation
weather.check	internal action
lib/auth.requireUser	helper
lib/auth.requireMember	helper
lib/auth.requireOrganizer	helper

25 registered Convex functions (from source).
```
