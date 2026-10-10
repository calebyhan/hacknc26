# Scope, priorities and acceptance criteria

**Product mode:** proposed 24-hour hackathon MVP. These are target criteria; mark them passing only after tests actually run.

## P0 — ship or don't demo

- [ ] **R1: Spectrum integration.** A user-initiated real iMessage reaches Rally, is durably stored with provider message ID, and receives a real reply via Spectrum. Repeat delivery produces no duplicate side effects.
- [ ] **R2: Identity and consent.** Being added as an invitee (P0: labeled bootstrap path per ADR-013; P1: iOS contact picker returning only chosen contacts) never triggers outbound contact. Participant must text `JOIN <code>` from their own phone before any automated DM.
- [ ] **R3: Event state.** An authenticated organizer can create one event with title, time, location, timezone, members, and tasks, via the iMessage draft flow (W2) or the labeled bootstrap path (ADR-013); the iOS create screen is P1. Only authorized actors can read/update it.
- [ ] **R4: Context resolution.** With a recent unambiguous event in focus, “I can bring speakers” resolves to that event. When two equally plausible events exist, Rally asks for clarification and makes no write.
- [ ] **R5: Proposal/acceptance.** Organizer requests task reassignment. Rally validates, asks eligible participant, and only commits when that participant responds affirmatively and the offer is still valid.
- [ ] **R6: Negative response.** Decline leaves the task's committed state untouched (`confirmed` stays with the current assignee; `needs_coverage` stays uncovered); organizer gets accurate status.
- [ ] **R7: Replays and races.** Duplicate webhook, repeated “yes,” stale acceptance, and two simultaneous acceptances produce no unauthorized or duplicate assignment.
- [ ] **R8: Inference downtime.** Known “yes/no/status” flows function when Claude is unavailable; complex unparsed requests safely queue or return a truthful fallback.
- [ ] **R9: Audit/status.** Organizer and participant can get accurate “what's happening?” status through iMessage. Optional companion app reads the same state.
- [ ] **R10: Demo safety.** No secrets in logs, no private unrelated event context in prompts, no unsolicited bulk messages.

## P1 — high-value extensions

- [ ] One actual iOS create/select/invite/status screen with authenticated authorization checks.
- [ ] Cancellation automatically produces valid replacement candidates, with approval loop.
- [ ] Configured weather-sensitive event checked by Open-Meteo; threshold crossing prompts authorized organizer and offers alternatives.
- [ ] Photo of event flyer → extracted fields → **explicit confirmation** before event creation.
- [ ] Lightweight agent activity timeline/status.

## P2 — only if P0 and P1 are stable

- [ ] Home Screen widget; extra providers, rich interactive iMessage GUI, multiple third-party integrations, complex personal preference learning, general project-management functionality, autonomous group chat creation.

## P0 acceptance scenarios

| ID | Given | When | Then |
|---|---|---|---|
| A1 | Enrolled organizer, one Charity 5K event, Maya assigned setup | Organizer texts “Can Jordan cover setup?” | Pending proposal exists, Maya remains assignee, Jordan gets one request |
| A2 | A1 with pending offer to Jordan | Jordan says yes | Jordan's commitment `active`, Maya's `released` (ADR-011), one confirmation each to organizer and Jordan, one notice to Maya, audit appended |
| A3 | A1 | Jordan says no | Existing assignment remains; organizer notified; pending offer closed |
| A4 | Two active events both have “setup” | Organizer says “move setup to 9” | No writes; Rally asks which event |
| A5 | Offer expired, or event version or target task version changed | Jordan says yes | No stale write; Rally requests reconfirmation or explains expired proposal |
| A6 | An unknown phone texts “list our events” | Message received | No protected event data disclosed; onboarding message returned |
| A7 | Same provider message ID delivered twice | Ingested | Stored once; no duplicate action/outbound notification |
| A8 | Local worker offline | Participant replies yes to pending invitation | Deterministic acceptance succeeds |
| A9 | Person selected from Contacts but not opted in | Organizer creates event | No automatic outbound cold contact |
| A10 | Two participants race for one exclusive task | Both accept offers | Single assignment with conflict-safe resolution; loser informed accurately |

## P0 demo-ready gate

Before implementing P1, demonstrate A1–A9 with a fake provider harness, and at minimum A1/A2 with actual Photon traffic. Have an on-record test for A10. Save an anonymized trace from the working demo.

## Scope-cut order

Widget → calendar integration → visual dashboards beyond one status screen → casual-mode UX → flyer image understanding → multi-slot matching (keep single-replacement ranking) → weather. Weather is the first external integration (README, `09`), so it is cut last among P1 items. **Do not cut**: signed inbound, consent, event scoping, actual approval, durable state, failure messages.
