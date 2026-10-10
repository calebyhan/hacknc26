# T8 — Demo hardening and rehearsal (hour 21–24)

Led by Lane A (owns live Photon); everyone helps. Ticket **T8**. No new features.

## Read first

`docs/11-testing-and-demo.md` (storyboard, judge questions, evidence checklist), `docs/12-deployment-and-operations.md` (launch checklist, failure matrix), `docs/10-security-privacy.md` (misbehavior to avoid during demo).

## Steps

1. **Full matrix.** Run every ST test that applies (ST-01–ST-13, ST-16–ST-18, plus ST-14/ST-15 if P1 shipped). Report failures exactly; fix only what's on the demo path.
2. **ST-16 secrets/privacy scan.** After a full scenario run, search Convex logs, worker logs and saved traces for: env var values, `+1` phone patterns other than `+1555…`, message bodies outside the demo text, other events' data in worker prompts. Also grep the repo and git history for secrets.
3. **Launch checklist** in `docs/12`: tick each item only after doing it.
4. **Failure drills** from the `docs/12` failure matrix, at least: worker stopped, Photon send failing (fake adapter), app offline. Each must give a truthful user-facing message.
5. **Rehearse** the 90-second storyboard in `docs/11` three times on the real phones, timing each run. Use the pitch structure in `docs/13` (about 2:15 total).
6. **Backup.** Record a full run as video, and save the annotated sanitized trace to `tests/integration/traces/demo.md`. Label every simulated part (bootstrap seed, simulated weather).
7. **Evidence pack** per `docs/11` evidence checklist: commands and results, framework versions, smoke test timestamp, before/after task state, duplicate test, one negative response, one failure simulation.
8. **Freeze.** Tag the commit used for the demo (`git tag demo`), and don't change `main` after rehearsal unless a demo-blocking bug appears.

## Done when

Matrix run recorded, launch checklist complete, three timed rehearsals done, backup video and trace saved, demo commit tagged.

## Report

**Goal / Changed files / Acceptance evidence / Risks and open questions**, plus the list of what's live vs simulated in the demo.
