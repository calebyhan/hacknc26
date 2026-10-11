# Local AI implementation and development evidence

Checkpoint: October 10, 2026, EDT. Branch: `lane-c/local-ai`, incorporating the latest fetched `origin/main` at `b73fba8`. No branch push or production deployment was performed.

**Goal:** an enrolled person's free-text iMessage reaches a worker on this Mac and produces a validated event-scoped suggestion. A cross-person offer stays pending until the correct target accepts. Member suggestions require organizer approval first.

The integrated backend is deployed to existing `calebhantech:rally:dev/caleb-han`, `calm-jackal-984`. This Mac's Codex worker is online with real subscription inference verified on synthetic inputs. **Actual group coordination remains unverified:** this backend has no events or enrolled memberships yet, so no real free-text queue job or target acceptance was exercised.

## Tasks and changed files

| Task | Files | Acceptance evidence |
|---|---|---|
| Event context/resolution | `packages/shared/context.ts`, `convex/context.ts`, `convex/commands.ts`, shared context tests | Explicit ambiguity, enrolled consent scope, snapshot-valid proposals, no unrelated/private context |
| Durable authenticated queue | `convex/reasoningJobs.ts`, `convex/reasoning.test.ts`, inventory/stub tests | Per-message dedupe; guarded public operations; HMAC-bound 45-second lease; two attempts; 120-second scheduled deadline; stale/invalid/unauthorized output rejected |
| Subscription CLI providers | `worker/src/{claude,codex,provider,prompt,config,index,loop}.ts`, worker tests | Isolated stdin/working directory; minimal environment; no runtime computer tools; 30-second/65,536-byte limits; preflight login/version; abort/cleanup/fallback |
| Actual Domain integration | `tests/integration/{harness,reasoning-domain.test,messaging-domain.test}.ts` | Six signed synthetic DM paths through the actual queue/Domain/outbox, with explicitly fake delivery/scripted inference |
| Synthetic evaluation | `tests/eval/`, `worker/src/eval.ts` | Scripted 20/20 harness; real Codex evaluations described below; optional `--case=17` targeted run |
| Private worker setup/health | `worker/src/{setup,status}.ts`, corresponding tests | Explicit dev target; existing key preserved; absent key privately created/read back; failure leaves local values; sanitized sampled health |
| Authenticated operator login | `worker/src/auth.ts`, `worker/tests/auth.test.ts` | Fresh PKCE/state/nonce; real loopback callback rejection/timeout/cancellation tests; correctly signed and forged JWT cases; private session file |
| Runtime/tooling/docs | Root/worker manifests, lockfile, Vitest config, `.env.example`, `.gitignore`, README, docs `12`/`14`/`16`/`20`/INDEX/this file | Strict checks, command inventory, ignored secrets and documented live limitations |

Frozen function signatures and shared AgentDecision/ContextPacket shapes are retained. `reasoningJobs.expire` is an additive internal registration. Domains and transport statuses remain separate. New root scripts: `worker:configure`, `worker:status`, `auth:login`, `eval:fake`, `eval:live`; `worker` runs the constrained polling loop.

## Local acceptance

```text
npm run check
  strict root/Convex, shared and worker checks pass
  Test Files  22 passed (22)
       Tests  308 passed (308)
npm run contracts:list
  39 registered functions
npm run eval:fake
  20/20 scripted cases (harness only)
git diff --check
  pass
```

Signed full-pipeline integration scenarios in `tests/integration/reasoning-domain.test.ts`:

1. Reassignment is pending while the old assignee remains active; the target's actual synthetic YES commits once; repeated worker completion produces no second effect.
2. A member suggestion waits for organizer approval and does not contact the target early.
3. Self-unavailability resolves to the verified sender, canceling only their commitment.
4. A later invalid reference rolls back an earlier valid action and its scheduled notices.
5. Organizer-reported cancellation releases the current assignee, then offers open coverage; no replacement acceptance is invented.
6. A compound self-volunteer/availability statement records both once; completion replay inserts neither a duplicate availability record nor commitment.

These tests use fake `+1555…` recipients, signed/encrypted fixture traffic, scripted model output and `FakeMessagingAdapter`. They are not Photon delivery or real user consent evidence.

## Actual Codex inference on synthetic inputs

Installed interfaces verified: Claude Code 2.1.263, Codex CLI 0.152.1, Convex 1.46.0, `jose` 6.2.12. Claude is logged out. Codex is authenticated using ChatGPT; no API key was configured. The live read-only model catalogue supplies `gpt-5.6-luna`, supporting low reasoning. A stale cache listed unavailable models and was not used as entitlement evidence.

| Run | Passed | Attempt p50 / p95 | Limitation |
|---|---:|---|---|
| Initial completed evaluation | 11/20 | 4,238 / 7,843 ms | Scope/rejection ambiguity and corpus mismatch |
| Revised corpus/prompt | 19/20 | 3,975 / 6,939 ms | Case 17 omitted the separate availability intent |
| Final compound-intent prompt | 19/20 | 3,989 / 6,809 ms | Case 01 rejected as `INVALID_DECISION`; all other cases, including 17, passed |

Targeted case 17 passed after the compound-intent prompt correction (5,081 ms). A targeted diagnostic retry of final-run case 01 passed runtime schema validation and emitted `REPORT_UNAVAILABILITY` plus `PROPOSE_ASSIGNMENT`. The earlier malformed output was not retained. Do not combine separate runs into a 20/20 claim or assume the retry proves reliability.

The revised corpus includes an existing open speakers item; the earlier fixture expected self-volunteering on a missing item without the required time window. Compound organizer cancellation now expects cancellation followed by a new open-task offer, matching Domain behavior. These are benchmark corrections, so the runs are not an unchanged-corpus accuracy comparison.

The grade checks event scope and action types, not reference correctness, dates, authorization or Domain execution. Synthetic inputs used real model inference but no backend writes or Photon sends. Earlier 0/20 failures came from rejecting the CLI's precise pre-turn disabled-Code-mode notice; the parser now tolerates that exact pinned-version notice once before a turn. All other errors, failed turns, tool activity or duplicate final messages fail closed.

The worker and authenticated CLI run locally; the model weights/inference run on the providers' remote infrastructure. Disabled shell/browser/MCP/filesystem tools remain disabled. Backend/Photon/Auth0 credentials are omitted from the child environment.

## Development deployment and sanitized live trace

The user personally authenticated the Convex CLI. Selection resolves to the existing development deployment used by Photon, not production. A 32-byte random worker credential was created privately on that server and verified before saving the ignored local copy, mode 0600. Existing Photon and messaging encryption keys were preserved.

```text
npx convex dev --once --typecheck enable --tail-logs disable
  [Development] calebhantech:rally:dev/caleb-han
  https://calm-jackal-984.convex.cloud
  Added auditEvents.by_source index
  Convex functions ready at 20:39:51 EDT

npx convex run spectrum:checkRuntime '{}' --deployment calm-jackal-984
  cryptoReady: true
  missingConfiguration: []

Public ConvexHttpClient probes
  anonymous events.myEvents -> UNAUTHORIZED
  incorrect worker credential -> WORKER_UNAUTHORIZED

npm run worker
  Rally codex worker started. Single-job constrained inference.

npm run worker:status
  checkedAt: 2026-10-11T00:54:28.111Z
  worker.online: true
  heartbeatAgeSeconds: 25
  model: gpt-5.6-luna
  errorCategory: null
  reasoning jobs: 0
```

The crypto check is synthetic and write-free. Authentication-denial probes neither enqueue work nor send messages. Read-only aggregate inspection found one active messaging user, zero events, zero memberships and zero reasoning jobs. No fake consent, event seed, real assignment change or new Photon send was performed. The existing live HELP/STATUS transport evidence remains in [19](19-messaging-evidence.md).

## Organizer sign-in and remaining gate

The user chose authenticated CLI setup. Their Convex login is administrator deployment access; the organizer still needs a real Rally Auth0 session. The ID token is issued after Rally sign-in, not copied from an Auth0 application Client Secret or Convex dashboard.

`npm run auth:login -- --check` currently returns `CALLBACK_NOT_ALLOWED`. The Auth0 dashboard was opened in Chrome and requires the user's dashboard login. In the existing Rally Native application's Settings, append `http://127.0.0.1:8765/callback` to Allowed Callback URLs while keeping the iOS callback, save, then run:

```sh
npm run auth:login
npm run domain:setup -- help
```

The helper opens browser login, validates the returned ID token against Auth0 signing keys/issuer/audience/nonce/time, and saves it privately without printing it. It requests no refresh token. Live login/token acceptance is still unverified. The transient callback listener binds only to loopback and closes on success/cancellation/timeout. Sources: Auth0's [PKCE flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce) and [ID-token validation](https://auth0.com/docs/secure/tokens/id-tokens/validate-id-tokens).

Then follow [authenticated event setup](20-domain-evidence.md#auth0-and-manual-event-setup): register; real phone-link JOIN; create a draft/task; confirm; organizer event JOIN; explicitly selected participants JOIN. Keep phone arguments in ignored `*.local.json` files. After enrollment, exercise a real free-text proposal, organizer approval where required, target YES/NO, STATUS, stale/replayed messages and worker-stopped fallback. Record provider acceptance separately from actual receipt.

Open risks: actual two-phone M1 and app M2 acceptance, model malformed-output/rate-limit behavior, actual live context/reference accuracy, delivery receipts and Mac uptime. Weather/P1 remain deferred. Inbound first-event drafting is not implemented merely because the queue supports null scope. Obtain affected-lane review before a shared branch merge.
