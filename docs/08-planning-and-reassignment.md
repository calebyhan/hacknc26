# Deterministic planning and reassignment

## Purpose

The model turns speech into candidate intents; a deterministic planner evaluates **feasibility** and proposes the smallest disruption. The code should be readable enough to explain at judging.

## Planning inputs

Event/task state: time windows, task capacity, required skills/equipment, dependencies, location, participant availability and roles, confirmed commitments, proposed offers, organizer policy. Unknown constraints stay `unknown`; do not invent free time.

## MVP constraint checks

Hard constraints: participant enrolled + opted in, required skill/equipment (if recorded), no overlapping confirmed obligations in same event, valid task time, not opted out, permitted to perform task. Optionally add events-wide conflict checks only with explicit shared availability consent; Rally cannot read calendars without integration permission.

Soft ranking among feasible participants: lower disruption to existing commitments, lower workload, availability confidence based on explicit replies, organizer's role preference, fewer new confirmations, lower risk of no response.

Example score for demos (tune, don't call probability):

```
score(candidate) = 3 * availableExplicitly
                 + 2 * hasRequiredSkill
                 - 2 * existingTaskCount
                 - 4 * newConflicts
                 - 1 * expectedNumberOfChanges
```

Hard constraint violation removes candidate, even if score is high. Use stable deterministic tie-breaking by ID to avoid inconsistent repeated proposals. This is a heuristic, not a predictive AI confidence score.

## Core algorithms

- For **one replacement**, filter candidates then score/rank O(P × T) for P participants and T existing tasks—sufficient for a small club.
- For **several slots**, construct a bipartite matching / minimum-cost assignment model between uncovered slots and eligible participants. A tiny backtracking solver with pruning is enough for a 3–10 person demo. Do not introduce a complex constraint solver library just to look sophisticated.
- On each change, compute affected dependencies only, not a full event replan.

## Example

`Maya drops setup 10:00–11:00` → event has `Jordan available 10:00–11:00`, no conflict; `Alex busy`; `Taylor not enrolled`. Candidate list contains Jordan only. Rally proposes Jordan, asks organizer where required and Jordan for acceptance; commits **after** acceptance.

## Concurrency and correctness

Use event version+proposal id; on acceptance, atomically recheck task assignee, availability, role, proposal `pending` state, TTL, and version. If a competing acceptance already won, reply truthfully; never overwrite another valid confirmation accidentally.

## Tests

- Same candidate with overlapping shifts → reject.
- One unconfirmed availability entry → ask, not auto-assign.
- Optimizer returns no candidate → status `unfilled`, with reason codes.
- Two equal candidates → deterministic order.
- A task with 2-person capacity → accept 2 and reject 3rd.
- State changes during reasoning → stale plan rejected and recomputed.

## General Track narrative

What the team built is a task dependency/commitment model, a constraint-based candidate generator, a transactional approval protocol, and reactive coordination—not just calling an LLM to write a schedule.
