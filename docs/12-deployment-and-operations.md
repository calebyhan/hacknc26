# Deployment, configuration and operations

Current integrated-source, rehearsal and live-acceptance status is recorded in [the demo handoff](23-demo-readiness.md), October 10, 2026. Earlier branch-specific deployment records remain historical evidence.

## Runtime placement

- **Cloud:** Convex dev deployment hosts event state, HTTP webhook, authorization checks, scheduled jobs and outbox. Weather remains an inactive stub and is cut from the demo scope.
- **Photon:** managed Spectrum project connected through dashboard, with verified inbound/outbound.
- **Mac:** authenticated local TypeScript worker invokes Claude or Codex with subscription access. Runtime polling uses outbound-only requests. The optional operator Auth0 login helper temporarily listens on loopback only; no port forwarding.
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

`main` now integrates A/B, D's account/status continuation and C's phone setup/resolver/queue/worker implementation. The integrated backend and demo hardening deployed successfully to `calm-jackal-984` at **22:35 EDT on October 10, 2026**. Post-deployment checks passed messaging configuration/crypto readiness, anonymous app denial, invalid-worker denial and forged-webhook rejection; the existing worker's sampled heartbeat was online with no error. User-provided phone evidence includes real setup, JOIN, enrolled STATUS, an offer and its expiry. Actual target acceptance/reassignment and the full live M1/M2 gates remain pending. Existing Photon registration targets `https://calm-jackal-984.convex.site/spectrum/webhook`; preserve its registration and encryption key. See [current readiness and deployment evidence](23-demo-readiness.md), [user-reported phone evidence](19-messaging-evidence.md#user-reported-live-setup-and-offer-follow-up) and [historical AI deployment evidence](22-local-ai-evidence.md).

1. Select `RALLY_PROVIDER=codex` or `claude`. For Codex, run `codex login` if needed; this Mac already reports ChatGPT login. For Claude, personally run `claude auth login`; this Mac is currently logged out. Do not paste credentials into chat. API-key environment variables are rejected.
2. Choose `RALLY_MODEL` from the authenticated CLI's current model catalogue. This Mac's Codex `model/list` lists `gpt-5.6-luna` with low reasoning support. A stale local cache listed inaccessible models; do not treat cache entries as account entitlement. The ignored local config uses Codex and this model.
3. Run `npm run eval:fake`, then `npm run eval:live`. The current corpus has 23 cases; a full live sweep makes at most 23 bounded calls using synthetic inputs, with no Convex write or Photon send. Per-case errors are sanitized categories. Record passed cases, errors, actual model and attempt latency. Most grades check scope/action types; the named-person case also checks references. Evaluation does not prove Domain execution or live coordination.
4. Authenticate the local Convex CLI with `npx convex login`. Select `calebhantech:rally:dev/caleb-han`, verify `calm-jackal-984`, and keep `CONVEX_URL=https://calm-jackal-984.convex.cloud`. Run `npm run worker:configure`. It refuses production/mismatched settings, preserves an existing server credential, or creates 32 random bytes through a private temporary file without secret argv. Server writes omit `--force` and are read back before updating local configuration. Both temporary/local files are private and temporary files are removed. Existing messaging secrets are untouched. Safe credential characters are letters, digits and `_.:/+=-`, 32–512 characters; invalid existing values fail without rotation or disclosure.
5. Run `npm run check`, `npm run contracts:list` and `npm run demo:rehearse`; review the integrated app/status and internal expiry contracts. Deploy the reviewed `main` revision to the intended development backend and regenerate types, recording the deployed revision separately. No production deployment is implied. Check `npm run worker:status` before starting a worker so an existing process is not duplicated. For a new process, run `npm run worker`; provider and server-authentication preflight must succeed before polling.
6. Use genuine enrolled/consented phones for free-text request → proposal → target's actual YES. Record provider acceptance and observed receipt separately. Stop the worker and exercise deterministic commands and the queue's 120-second fallback. Do not seed fake consent or present simulation traces as live.

Both providers receive the compact packet on stdin and a fixed prompt, run in a temporary working directory, pass a minimal environment excluding backend/Photon credentials, and cap inference at 30 seconds and input/output at 65,536 bytes. Their models execute remotely; “local” refers to the worker/CLI on this Mac.

Claude Code 2.1.263 uses safe/restricted mode, empty tool/MCP sets, disabled hooks/customization/slash commands/Chrome and no session persistence. Bare mode is unused because it skips subscription OAuth. The Codex adapter supports the inspected CLI versions **0.152.1 and 0.160.1** and disables shell, apps/plugins/MCP, hooks, browser/computer, image, agent and web capabilities. The capability review also verified and disabled separate in-app browser/chat/automation, deferred executor, credential elicitation, dependency installation and permissions-tool gates; host skill discovery is skipped. Installed 0.160.1's restricted request was captured against a local rejecting mock with no tool definitions or authentication header; see [the current runtime audit](23-demo-readiness.md#acceptance-evidence). The documented `suppress_unstable_features_warning=true` prevents that intentionally enabled isolation flag from emitting a generic startup warning; it does not relax decision/error/tool validation. It ignores user configuration/rules, limits project documentation, uses ephemeral execution, a read-only sandbox and never-approve. The exact known pre-turn disabled-host notice is tolerated; other errors, tool activity and failed turns are rejected. Only a validated final decision is accepted; raw process errors and model prose are never sent to participants. The Codex preflight rejects versions other than 0.152.1 and 0.160.1 pending capability review. See the official [configuration reference](https://developers.openai.com/codex/config-reference) and [noninteractive mode](https://developers.openai.com/codex/noninteractive).

Model failures complete with invalid JSON under the frozen completion contract, recording a failed job and one static consent-checked fallback. No invented model action substitutes for failure. Idle polls back off to 30 seconds, backend requests time out after 10 seconds, and heartbeats contain categories only.

`npm run worker:status` requires the operator's Convex CLI login and makes read-only requests against the explicit development target. It prints only heartbeat age, model, bounded error categories and job-state counts. Samples cover up to the latest 1,000 rows per table and label possible truncation; pending age refers to that sample. A heartbeat under 90 seconds is online. This is process/backend health, not evidence that a message or decision succeeded.

The queue revalidates sender, membership/consent, messaging preference, resolution and event/task versions at enqueue, claim and completion. Leases last 45 seconds; at most two attempts fit inside a 120-second lifetime. A scheduled deadline runs while the Mac sleeps. Identical completed retries do not execute Domain again. Member assignment suggestions enter organizer approval before target contact; first-person references resolve to the verified sender. Domain owns acceptance evidence, transactional writes and successful notices. Signed simulations verify these paths with fake delivery and scripted decisions; live worker/backend/provider behavior is a separate gate.

## Phone-only event setup

Auth0 is optional for the companion app and authenticated CLI. P0 setup uses the persisted, signature-verified Photon sender identity; it grants no access to app APIs. All examples below are manual instructions, not evidence of real sends. Use future dates with an explicit offset (`Z` or `-04:00`) and a valid IANA timezone. Pipes separate fields. No natural-language date guessing occurs during setup.

1. Send `CREATE EVENT` in your provisioned Rally conversation for syntax help. Create a draft, for example `CREATE EVENT Picnic | 2026-10-12T14:00:00-04:00 | America/New_York | Park`. Location is optional. A signed sender may have at most ten open drafts; the start must be in the next 366 days.
2. Review the returned title, UTC instant, timezone and location. Nothing is scheduled. Send the returned `JOIN <code>` from the same phone to opt into that event's updates. This code is only for the organizer; each friend needs a separate INVITE. Then `CONFIRM <event ID> <version>` exactly as instructed. Only its owner with organizer membership and genuine JOIN proof can schedule it. A stale version is rejected. JOIN alone never schedules an event.
3. Add a timed task: `TASK Picnic | setup | 2026-10-12T13:00:00-04:00 | 2026-10-12T14:00:00-04:00`. Both timestamps are required. Tasks start unassigned; this command never creates a commitment.
4. Select a person explicitly: `INVITE Picnic | Jordan | <their E.164 phone>`. Keep actual phone values in your private DM. Rally returns a code to the organizer and does not contact the selected person. Hand it to them yourself; they must send `JOIN <code>` from that phone in their provisioned Rally conversation. Codes expire in 24 hours. Event IDs can replace event names; duplicate names require an ID.
5. Request coverage naturally: `Can Jordan cover setup for Picnic?`. The worker can propose it; Jordan's actual YES is required to commit. Member-originated suggestions first require an organizer's `APPROVE <proposal ID>`; that approval is not participant acceptance. The approval notice includes the command.
6. Verify STATUS, duplicate replies, NO, STOP/RESUME and worker-offline behavior. Record provider acceptance and actual phone receipt separately. The Mac must remain awake for free-text reasoning; setup and core commands do not use inference.

Setup writes run in one internal transaction derived from the fresh persisted message, not user-supplied identity. Duplicate provider IDs are ignored. Setup replies are either fixed help/error copy or match an audited SHA-256 content receipt bound to that sender/message. The outbox rechecks this receipt, opt-out, and idempotency at delivery. Invitation codes are not copied into audit records. Creating a draft does not fabricate JOIN consent. App APIs still enforce app identity and membership/role.

## Optional authenticated CLI sign-in

This alternative is unnecessary for phone-only setup. An Auth0 ID token is issued after signing into Rally. It is distinct from Auth0 dashboard administrator access and Convex CLI credentials. `npm run auth:login -- --check` tests the callback configuration without signing in. The existing Native application must allow `http://127.0.0.1:8765/callback`; append it in Application Settings while preserving `dev.rally.companion://YOUR_AUTH0_DOMAIN/ios/dev.rally.companion/callback`. Keep the app's public-client configuration; no client secret is required by this PKCE helper.

Run `npm run auth:login` and personally sign in in the opened browser. The helper reads the backend's public Auth0 domain/client ID through authenticated Convex CLI access, uses fresh state/nonce and S256 PKCE, and listens only on `127.0.0.1` for at most five minutes. Invalid state, host, path and duplicate parameters are rejected. Token exchange does not follow redirects and times out in ten seconds. Pinned `jose` 6.2.12 validates RS256/JWKS signature, issuer, audience/authorized party, required claims, age/expiry and nonce before saving the ID token. It stores no access or refresh token and prints no credentials. `.env.local` is atomically replaced with mode 0600, preserving worker settings. Run login again when the short-lived ID token expires.

Then follow [manual event setup](20-domain-evidence.md#auth0-and-manual-event-setup). Register the organizer, prove phone possession with an actual inbound JOIN, create the event/tasks, and have organizer/selected participants JOIN their own event invitations. Contact selection alone never sends a DM or enrolls a person. Sources: Auth0's [PKCE flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-pkce/add-login-using-the-authorization-code-flow-with-pkce) and [ID-token validation](https://auth0.com/docs/secure/tokens/id-tokens/validate-id-tokens).
