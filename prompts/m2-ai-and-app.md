# M2 — Plug in the AI worker (C) and the live app (D)

Run by the Lane B and Lane C owners together, with Lane D joining for the app part (~hour 12). Goal: natural-language requests go through the worker end to end, the deterministic paths survive with the worker off, and the app shows the same truth as iMessage.

Current automated evidence: [the combined rehearsal](../docs/23-demo-readiness.md) passes the real backend/worker-loop/app-query path with explicitly simulated identities, delivery and inference. A separate real Codex run passes 23 synthetic inputs. The current demo provider is Codex; Claude remains an adapter option. These results do not complete the live steps below.

## Preconditions

- M1 passed.
- Lane C: resolver, queue, worker, eval corpus merged; fake-provider eval passes in CI.
- Lane B: `domain.executeDecision` merged.
- Lane D: app runs on a device against the mock client with real sign-in.

## Steps

1. **AI path.** Check `npm run worker:status`; start a worker only if none is already running. A new process needs `RALLY_PROVIDER`, `RALLY_WORKER_TOKEN` and `RALLY_MODEL` configured and authenticated subscription access, without API-key variables. From Alex's real phone: “Can Jordan cover Maya's 10 AM setup?” Use the real enrolled display names, task time and selected event. Expected: one truthful acknowledgement at most, then a pending proposal and exactly one request to Jordan. Jordan replies `YES` before its deadline → commit as in M1.
2. **Ambiguity (A4/ST-03).** With a second actual authorized event and no unique current focus: “move setup to 9” → Rally asks which event, no writes. Create any needed event through real setup and JOIN; do not seed fake participant consent into the live backend.
3. **Self-commitment (R4).** From Jordan: “I can bring speakers” with Charity 5K in focus → resolves to Charity 5K; organizer notified.
4. **ADR-011 (ST-18).** “Maya can't make it” from Alex → Maya `released`, task `needs_coverage`; same text from Jordan → no write.
5. **Worker down (A8/ST-11).** Stop the worker. Pending `YES`, `NO`, `STATUS`, `STOP` still work; a new free-text request gets one honest delay/fallback reply, not a fake answer. A job left beyond its 120-second deadline expires with one fallback; restarting must not revive it. Separately restart before the deadline to verify that a still-valid queued job is processed once.
6. **Injection (ST-12).** Send the prompt-injection message from the eval corpus; confirm no data disclosure and no unexpected outbound.
7. **App (ST-15).** Lane D switches to the live Convex client. During step 1, the app shows `awaiting_participant` then `confirmed` for setup, matching the iMessage trace.
8. Record one full live eval (`npm run eval:live`) with latency; the current 23-case run is already saved in `tests/eval/results/2026-10-10-m2-live.json`. Rerun only if model/prompt/runtime changes require it. Save the actual phone/app acceptance trace separately to `tests/integration/traces/m2.md`.

## Done when

Steps 1–7 pass live; `npm run check` green; eval results recorded with measured latency. Any failure is reported with the exact output, not retried silently.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.**
