# M2 — Plug in the AI worker (C) and the live app (D)

Run by the Lane B and Lane C owners together, with Lane D joining for the app part (~hour 12). Goal: natural-language requests go through the worker end to end, the deterministic paths survive with the worker off, and the app shows the same truth as iMessage.

## Preconditions

- M1 passed.
- Lane C: resolver, queue, worker, eval corpus merged; fake-provider eval passes in CI.
- Lane B: `domain.executeDecision` merged.
- Lane D: app runs on a device against the mock client with real sign-in.

## Steps

1. **AI path.** Start the worker on the Mac with `RALLY_WORKER_TOKEN` and `RALLY_MODEL` set (no `ANTHROPIC_API_KEY`). From Alex's real phone: “Can Jordan cover Maya's 10 AM setup?” Expected: one truthful acknowledgement at most, then a pending proposal and exactly one request to Jordan. Jordan replies `YES` → commit as in M1.
2. **Ambiguity (A4/ST-03).** With Hack Night seeded: “move setup to 9” → Rally asks which event, no writes.
3. **Self-commitment (R4).** From Jordan: “I can bring speakers” with Charity 5K in focus → resolves to Charity 5K; organizer notified.
4. **ADR-011 (ST-18).** “Maya can't make it” from Alex → Maya `released`, task `needs_coverage`; same text from Jordan → no write.
5. **Worker down (A8/ST-11).** Stop the worker. Pending `YES`, `NO`, `STATUS`, `STOP` still work; a new free-text request gets one honest delay/fallback reply, not a fake answer. Restart the worker; queued job is processed once.
6. **Injection (ST-12).** Send the prompt-injection message from the eval corpus; confirm no data disclosure and no unexpected outbound.
7. **App (ST-15).** Lane D switches to the live Convex client. During step 1, the app shows `awaiting_participant` then `confirmed` for setup, matching the iMessage trace.
8. Run the live eval once (`npm run eval:live`) and commit the results table. Save a sanitized trace to `tests/integration/traces/m2.md`.

## Done when

Steps 1–7 pass live; `npm run check` green; eval results recorded with measured latency. Any failure is reported with the exact output, not retried silently.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions.**
