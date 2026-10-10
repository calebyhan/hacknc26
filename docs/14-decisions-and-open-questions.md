# Architecture decisions and open questions

**Decision states:** `DECIDED` means user/team direction; `PROPOSED` means recommended but unimplemented; `VERIFY` means provider/account behavior must be tested. **Do not silently turn VERIFY into fact.**

## Decisions

| ID | State | Decision / rationale |
|---|---|---|
| ADR-001 | DECIDED | Required HackNC track: General; required sponsor track: Photon with Spectrum. Other tracks opportunistic. |
| ADR-002 | DECIDED | iMessage is the principal interface; iOS is setup/contact selection/status, not primary chat UI. |
| ADR-003 | DECIDED | Need both structured event and casual friend-group planning eventually; event-first MVP. |
| ADR-004 | DECIDED | Mac (Apple Silicon category, exact model/RAM unknown) and existing Claude Code subscription; no assumed paid inference API. |
| ADR-005 | PROPOSED | Convex + Photon official `@spectrum-ts/convex` integration for durable messaging and serverless state. |
| ADR-006 | PROPOSED | Local Claude worker invoked via permitted subscription access; deterministic fallback for confirmations and status. |
| ADR-007 | PROPOSED | Proposals require affected participant approval; task writes only through validated transactions. |
| ADR-008 | PROPOSED | Weather watch via Open-Meteo is P1; never unilaterally reschedules event. |
| ADR-009 | PROPOSED | Selected contacts → invite state → participant-initiated verified opt-in; avoid contact bulk sync. |
| ADR-010 | PROPOSED | Single-event status view before widget and additional calendar integrations. |

## Blocking questions (resolve in first 2 hours)

1. **Photon account:** Does hackathon promo provide just shared Pro DMs or special dedicated/group permissions? Can newly selected contacts be invited compliantly, and how does participant provisioned number flow work? Record actual test.
2. **Convex component:** Which installed `@spectrum-ts/convex` version, and how do replies, grouping/collapse, outbound IDs, and explicit send capabilities behave? Pin versions.
3. **Claude runtime:** Which Claude account tier/model is accessible? Can local Agent SDK/`claude -p` be used for the intended prototype under current Anthropic terms, and what are real latency/rate limits? Test from Mac with a safe one-turn JSON task.
4. **App authentication:** Which supported iOS/Convex auth provider is fastest for real organizer identity? Do not leave public mutations exposed.
5. **Phone linking:** Exact sender metadata in Photon webhook, canonicalization rules, and proof-of-control enrollment behavior.
6. **Device and test participants:** Exact Mac chip/RAM, team size, number of opted-in test phones and distribution pathway for iOS demo.
7. **Event location:** Are actual coordinates known for weather, or should organizers provide validated location? Avoid fabricating geocodes.

## Non-blocking questions

- Does the team want organizer override to release a pending assignment? If yes, model explicit override and audit.
- Multiple ongoing projects: include as `kind:project` now or wait until after event-first MVP?
- Should “casual mode” have explicit RSVPs or lightweight interest counts?
- Is the iOS widget worth the time after full acceptance gate?
- Which optional calendar integration is most useful if time remains?

## Decision log template

```markdown
### ADR-011 — [Title]
- Date:
- State: DECIDED / PROPOSED / VERIFY / SUPERSEDED
- Context:
- Decision:
- Alternatives:
- Impact on tests/security:
- Evidence / link:
```

A coding agent should update this file when verifying account behavior or choosing an architecture variant.
