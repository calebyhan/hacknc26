# M3 — Feature freeze and P1 decision (~hour 18)

Everyone. After this checkpoint, no new features: only fixes on the end-to-end path (`docs/13` kill switch at hour 18).

## Steps

1. **P0 gate (`docs/01`).** Run the full fake-provider suite: ST-01–ST-13 and ST-16–ST-18. Confirm A1/A2 have passed live (M1) and A10 has an on-record test. Paste the output.
2. **P1 status, one line each:** cancellation recovery (Lane B, W5), weather (Lane C, ST-14), iOS status screen (Lane D, ST-15), flyer parsing (only if weather done). Mark each `done`, `demo-only with label`, or `cut`.
3. **Cut per `docs/01` order** anything not done: widget → calendar → extra dashboards → casual mode → flyer → multi-slot matching → weather. Never cut signed inbound, consent, event scoping, real approval, durable state, failure messages.
4. **Demo path pick.** Choose the storyboard step 5 variant in `docs/11` (simulated weather vs second cancellation recovery) based on what is actually done.
5. **Docs sync.** Update `docs/14` with every VERIFY item now known (Photon tier, Spectrum version, Claude runtime, auth provider), and tick the P0/P1 checkboxes in `docs/01` **only** for tests that ran.
6. **Branch cleanup.** Merge or close every lane branch; `main` is the only demo source from now on.

## Done when

`main` passes `npm run check`, the P0 gate is met, every P1 item has a status, and the demo path is chosen. If the P0 gate fails, all lanes work on that until it passes.

## Report

One combined report: **Goal / Changed files / Acceptance evidence / Risks and open questions**, plus the P1 status list.
