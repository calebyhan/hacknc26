# Deployment, configuration and operations

## Runtime placement

- **Cloud:** Convex dev deployment hosts event state, HTTP webhook, authorization checks, scheduled jobs, outbox, weather fetches.
- **Photon:** managed Spectrum project connected through dashboard, with verified inbound/outbound.
- **Mac:** authenticated local TypeScript worker invokes Claude or Codex with subscription access. Runtime polling uses outbound-only requests. The separate operator Auth0 login helper temporarily listens on loopback only; no port forwarding.
- **iOS:** SwiftUI app uses authenticated Convex integration; do not embed admin secrets.

## Secrets and configuration (names illustrative unless external SDK requires exact)

| Variable | Location | Notes |
|---|---|---|
| `SPECTRUM_WEBHOOK_SECRET` | Convex server | Required by official integration; verify current package |
| `SPECTRUM_PROJECT_ID` | Convex server | Spectrum Cloud project |
| `SPECTRUM_PROJECT_SECRET` | Convex server | Spectrum Cloud secret |
| `CONVEX_URL` | worker, app non-secret config | Cloud deployment URL |
| `RALLY_WORKER_TOKEN` | Worker + secure server verifier | Rotate; never in iOS/app repo |
| `RALLY_MODEL` | local worker | Model validated from subscription access |
| `RALLY_PROVIDER` | local worker | Explicit `claude` (default) or `codex`; no automatic provider switching |
| `RALLY_AUTH0_ID_TOKEN` | operator's private `.env.local` only | Short-lived organizer session for CLI setup; never passed to inference |
| `RALLY_DEMO_MODE` | server/test only | False by default; label simulations |
| `RALLY_PHONE_HASH_KEY` | Convex server | Only if phone numbers are encrypted at rest; keyed hash for lookups (`03-data-model.md`) |

Never commit `.env.local`, tokens, serialized Claude sessions, conversation logs with phone numbers, or screenshots of secret dashboards.

## Setup order

1. Xcode and recent Node LTS available; create repository and install Convex.
2. Create Convex dev deployment (`npx convex dev`) and record deployment URL.
3. Sign up at `app.photon.codes/dashboard` with the hackathon promo code (briefs list both `HACKNC` and `HACKWITHPHOTON`; record which worked and the free-Pro expiry); confirm actual account plan/line settings.
4. Install/pin `@spectrum-ts/convex`; configure component and its environment secrets using official docs; register routes.
5. Verify inbound/real outbound DM before LLM integration.
6. Define Convex schema and access-controlled core mutations. Add fake provider tests.
7. Set worker credentials securely and run worker from Mac after `claude` login / entitlements check.
8. Build iOS app, configure auth and Convex endpoint. Test contact selection, participant verification, live update.
9. Add weather integration only if core tests pass.

## Worker runbook

- Start worker in a process manager or dedicated terminal with auto-restart; do not let Mac sleep during demo.
- Health check: `workerLastHeartbeat`, oldest pending job age, recent errors, Claude invocation result.
- Backoff on subscription rate limits; queue jobs; tell user if delayed; no repeated costly retries.
- A worker should claim at most one leased job at a time initially; renew lease if needed and cap total attempts.
- Check task state and event version **after** model completion before any commitment.

## Failure matrix

| Failure | Expected behavior |
|---|---|
| Claude quota/rate limit | Rule-based YES/NO/STATUS works; new complex jobs delayed or clear fallback |
| Mac asleep/offline | Convex webhook remains durable; keep job pending with bounded TTL |
| Photon outbound fails | Outbox failure/unknown; no false “sent”; reconciliation or cautious retry |
| Convex unavailable | No fake confirmation; surface outage and retry user interaction later |
| Weather API fails | Preserve existing event; no weather-derived action |
| Conflicting task updates | Reject stale mutation; recompute or ask organizer |
| App loses network | Show cached/stale status; do not pretend latest confirmation is current |

## Launch and demo checklist

- [ ] Live Photon inbound/outbound smoke test.
- [ ] Two opted-in numbers/participants linked to correct users.
- [ ] Authenticated organizer and event membership verified.
- [ ] Local worker running, model available, no subscription limit warning.
- [ ] `YES`, `NO`, `STATUS` fallback works with worker stopped.
- [ ] Test tasks and prepared demo phones available.
- [ ] Duplicate webhook replay test and privacy leak test pass.
- [ ] Screenshots/screenshare hide real phone numbers and secrets.
- [ ] Clear simulated-weather label and video backup.
- [ ] Open decisions updated to actual account/API behavior.

## Cost caveats

Target zero *incremental* cost with promotional Photon Pro, Convex Free, preexisting Claude subscription, Mac hardware and free noncommercial weather access. This is a target, not a guarantee: tier limitations, plan caps, Apple distribution costs, and subscription/SDK policies must be checked at build time.

## Local worker implementation and setup

The AI branch includes the messaging/Domain/iOS code merged into `origin/main` at `b73fba8` and is deployed to the existing development backend. This Mac's Codex worker has a verified server heartbeat. Simulated tests use the actual Domain engine. Live M1/M2 remain pending; this backend has no events or enrolled memberships yet. Existing Photon registration targets `https://calm-jackal-984.convex.site/spectrum/webhook`. Preserve its registration and encryption key. See [current evidence](22-local-ai-evidence.md).

1. Select `RALLY_PROVIDER=codex` or `claude`. For Codex, run `codex login` if needed; this Mac already reports ChatGPT login. For Claude, personally run `claude auth login`; this Mac is currently logged out. Do not paste credentials into chat. API-key environment variables are rejected.
2. Choose `RALLY_MODEL` from the authenticated CLI's current model catalogue. This Mac's Codex `model/list` lists `gpt-5.6-luna` with low reasoning support. A stale local cache listed inaccessible models; do not treat cache entries as account entitlement. The ignored local config uses Codex and this model.
3. Run `npm run eval:fake`, then `npm run eval:live`. The latter makes at most 20 bounded calls using synthetic inputs, with no Convex write or Photon send. Per-case errors are sanitized categories. Record passed cases, errors, actual model and attempt latency. The grade checks scope/action types, not reference correctness or Domain execution.
4. Authenticate the local Convex CLI with `npx convex login`. Select `calebhantech:rally:dev/caleb-han`, verify `calm-jackal-984`, and keep `CONVEX_URL=https://calm-jackal-984.convex.cloud`. Run `npm run worker:configure`. It refuses production/mismatched settings, preserves an existing server credential, or creates 32 random bytes through a private temporary file without secret argv. Server writes omit `--force` and are read back before updating local configuration. Both temporary/local files are private and temporary files are removed. Existing messaging secrets are untouched. Safe credential characters are letters, digits and `_.:/+=-`, 32–512 characters; invalid existing values fail without rotation or disclosure.
5. Run `npm run check` and `npm run contracts:list`; review the additive internal expiry registration. Deploy the integrated branch to the intended development backend and regenerate types. No production deployment is implied. Run `npm run worker`; provider and server-authentication preflight must succeed before polling.
6. Use genuine enrolled/consented phones for free-text request → proposal → target's actual YES. Record provider acceptance and observed receipt separately. Stop the worker and exercise deterministic commands and the queue's 120-second fallback. Do not seed fake consent or present simulation traces as live.

Both providers receive the compact packet on stdin and a fixed prompt, run in a temporary working directory, pass a minimal environment excluding backend/Photon credentials, and cap inference at 30 seconds and input/output at 65,536 bytes. Their models execute remotely; “local” refers to the worker/CLI on this Mac.

Claude Code 2.1.263 uses safe/restricted mode, empty tool/MCP sets, disabled hooks/customization/slash commands/Chrome and no session persistence. Bare mode is unused because it skips subscription OAuth. Codex CLI 0.152.1 disables shell, apps/plugins/MCP, hooks, browser/computer, image, agent and web capabilities; it ignores user configuration/rules, limits project documentation, uses ephemeral execution, a read-only sandbox and never-approve. The exact pre-turn 0.152.1 disabled-host notice is tolerated; other errors, tool activity and failed turns are rejected. Only a validated final decision is accepted; raw process errors and model prose are never sent to participants. The Codex preflight rejects other CLI versions pending capability review. See the official [configuration reference](https://developers.openai.com/codex/config-reference) and [noninteractive mode](https://developers.openai.com/codex/noninteractive).

Model failures complete with invalid JSON under the frozen completion contract, recording a failed job and one static consent-checked fallback. No invented model action substitutes for failure. Idle polls back off to 30 seconds, backend requests time out after 10 seconds, and heartbeats contain categories only.

`npm run worker:status` requires the operator's Convex CLI login and makes read-only requests against the explicit development target. It prints only heartbeat age, model, bounded error categories and job-state counts. Samples cover up to the latest 1,000 rows per table and label possible truncation; pending age refers to that sample. A heartbeat under 90 seconds is online. This is process/backend health, not evidence that a message or decision succeeded.

The queue revalidates sender, membership/consent, messaging preference, resolution and event/task versions at enqueue, claim and completion. Leases last 45 seconds; at most two attempts fit inside a 120-second lifetime. A scheduled deadline runs while the Mac sleeps. Identical completed retries do not execute Domain again. Member assignment suggestions enter organizer approval before target contact; first-person references resolve to the verified sender. Domain owns acceptance evidence, transactional writes and successful notices. Signed simulations verify these paths with fake delivery and scripted decisions; live worker/backend/provider behavior is a separate gate.

## Authenticated CLI sign-in

An Auth0 ID token is issued after signing into Rally. It is distinct from Auth0 dashboard administrator access and Convex CLI credentials. `npm run auth:login -- --check` tests the callback configuration without signing in. The existing Native application must allow `http://127.0.0.1:8765/callback`; append it in Application Settings while preserving `dev.rally.companion://YOUR_AUTH0_DOMAIN/ios/dev.rally.companion/callback`. Keep the app's public-client configuration; no client secret is required by this PKCE helper.

Run `npm run auth:login` and personally sign in in the opened browser. The helper reads the backend's public Auth0 domain/client ID through authenticated Convex CLI access, uses fresh state/nonce and S256 PKCE, and listens only on `127.0.0.1` for at most five minutes. Invalid state, host, path and duplicate parameters are rejected. Token exchange does not follow redirects and times out in ten seconds. Pinned `jose` 6.2.12 validates RS256/JWKS signature, issuer, audience/authorized party, required claims, age/expiry and nonce before saving the ID token. It stores no access or refresh token and prints no credentials. `.env.local` is atomically replaced with mode 0600, preserving worker settings. Run login again when the short-lived ID token expires.

Then follow [manual event setup](20-domain-evidence.md#auth0-and-manual-event-setup). Register the organizer, prove phone possession with an actual inbound JOIN, create the event/tasks, and have organizer/selected participants JOIN their own event invitations. Contact selection alone never sends a DM or enrolls a person. Sources: Auth0's [PKCE flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce) and [ID-token validation](https://auth0.com/docs/secure/tokens/id-tokens/validate-id-tokens).
