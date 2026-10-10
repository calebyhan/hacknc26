# Prompt 0 — Repository bootstrap and shared contract

You are bootstrapping the Rally repository so four lanes can work in parallel. Your output is the **contract**: typed schemas, interfaces, fakes, stubs and a test gate. You do **not** implement product behavior.

## Read first

1. `AGENTS.md`
2. `docs/17-workstreams.md` — the contract table and file-ownership map are your spec.
3. `docs/03-data-model.md` — entities, canonical enums, seed fixture.
4. `docs/05-agent-reasoning.md` — context packet, `AgentDecision`, action union.
5. `docs/04-messaging-and-photon.md#deterministic-commands`.

## Steps

1. **Toolchain check.** Record Node, npm and Convex CLI versions. Use current stable versions of `convex`, `zod`, `typescript`, `vitest`, and `convex-test`; verify each package exists and check its current docs for setup before using it. Do not install `@spectrum-ts/convex` (Lane A does).
2. **Workspace.** npm workspaces at the repo root: `packages/shared`, `worker`. `convex/` stays at the root (Convex expects it there). TypeScript `strict: true` everywhere.
3. **Convex project.** Initialize `convex/`. Creating the dev deployment (`npx convex dev`) needs an interactive login: **stop and ask the human to run it**, then continue once `CONVEX_DEPLOYMENT` exists in `.env.local`. Confirm `.env.local` is gitignored.
4. **`packages/shared`:**
   - `enums.ts`: every enum in `03#canonical-state-enums` as `as const` arrays plus matching Zod enums. Export them so `convex/schema.ts` can build `v.union(v.literal(...))` from the same arrays (one source of truth).
   - `agentDecision.ts`: Zod schema for `AgentDecision` and the full action union in `05`. Unknown action types and extra fields fail. `needsClarification` must equal `confidenceClass === "ambiguous"`.
   - `contextPacket.ts`: Zod schema for the packet in `05`.
   - `commands.ts`: the `Command` discriminated union. `parseCommand` is a stub throwing `NOT_IMPLEMENTED(lane-a)`.
   - `adapters.ts`: `MessagingAdapter` (`send(request) → { state, providerMessageId? }`) and `InferenceProvider` (`decide(packet) → AgentDecision`). Implement `FakeMessagingAdapter` (records every send, can be told to fail/timeout) and `FakeInferenceProvider` (returns scripted decisions keyed by text).
   - `fixtures.ts`: the seed fixture from `03#minimal-seed-fixture` as plain data (Alex, Maya, Jordan, Taylor; Charity 5K with `setup` and Maya active on it; Hack Night with its own `setup`). Use obviously fake phone numbers (`+1555…`).
   - `planner.ts`, `assignment.ts`, `context.ts`, `copy.ts`: exported function stubs throwing `NOT_IMPLEMENTED(<lane>)` per the ownership map.
5. **`convex/schema.ts`:** every table, field and index in `03`, using the shared enum arrays. Optional fields as `v.optional`.
6. **Convex stubs:** create every function in the `docs/17` contract table with its final name, argument validators and return type, body `throw new Error("NOT_IMPLEMENTED(<lane>)")`. Public vs internal exactly as the table says. `convex/lib/auth.ts` helpers are stubs too (Lane B implements first).
7. **Worker skeleton:** `worker/src/index.ts` that loads config from env (`CONVEX_URL`, `RALLY_WORKER_TOKEN`, `RALLY_MODEL`) and exits with a clear message if missing. No Claude calls.
8. **Test gate:** root `npm run check` = typecheck all workspaces + `vitest run`. Add a vitest config that can run Convex function tests with `convex-test`.
9. **Contract tests** (so the gate isn't empty):
   - The example `AgentDecision` in `05` parses.
   - Each forbidden action type (`RAW_HTTP`, `EXECUTE_CODE`, `SEND_ANY_MESSAGE`, `MARK_CONFIRMED`, `UPDATE_ANY_DB_ROW`) is rejected.
   - `needsClarification` / `confidenceClass` mismatch is rejected.
   - Fixture data validates against the shared enums.
   - `FakeMessagingAdapter` records sends; `FakeInferenceProvider` returns scripted output.
10. **CI:** a GitHub Actions workflow running `npm ci && npm run check` on PRs to `main`.
11. **Repo hygiene:** extend `.gitignore` (`.env*`, `node_modules`, Xcode user data, `worker/.sessions`). Update the workspace tree in `README.md` if it differs.

## Do not

- Implement any product behavior beyond the fakes and schemas.
- Invent Spectrum, Convex Swift or Claude SDK signatures; leave those to the owning lane.
- Commit secrets or real phone numbers.

## Done when

- `npm run check` passes locally (paste the output).
- Every function in the `docs/17` contract table exists with the stated name and kind (paste a list generated from the code, not from memory).
- A human has run `npx convex dev` once and the schema deployed without errors.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions** (per `AGENTS.md`). List any contract names you had to change and why; those need a `docs/17` update in the same PR.
