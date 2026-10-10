# Deployment, configuration and operations

## Runtime placement

- **Cloud:** Convex dev deployment hosts event state, HTTP webhook, authorization checks, scheduled jobs, outbox, weather fetches.
- **Photon:** managed Spectrum project connected through dashboard, with verified inbound/outbound.
- **Mac:** authenticated local TypeScript worker invokes Claude with subscription access. It performs outbound-only polling/requests; no inbound port forwarding or exposed laptop endpoint.
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
