# Prompts

Kickoff prompts for coding agents (Claude Code), one per lane and checkpoint. The plan, contract and file-ownership map they rely on are in [`../docs/17-workstreams.md`](../docs/17-workstreams.md).

Usage: open a session in the lane's branch/worktree and paste the file's contents (or say "follow `prompts/<file>`"). Each prompt is self-contained but assumes the agent also follows `AGENTS.md`.

| Order | File | Who |
|---|---|---|
| 0 | `00-bootstrap.md` | Bootstrap owner (usually Lane B) |
| 1 | `lane-a-messaging.md`, `lane-b-domain.md`, `lane-c-ai.md`, `lane-d-ios.md` | One per lane, in parallel |
| 1a | `lane-d-ios-remaining.md` | Lane D continuation after the initial app slice; includes A/B integration dependencies |
| 2 | `m1-messaging-domain.md` | A + B at ~8h |
| 3 | `m2-ai-and-app.md` | B + C (+ D) at ~12h |
| 4 | `m3-freeze.md` | Everyone at ~18h |
| 5 | `t8-demo-hardening.md` | A leads at 21h |

Every prompt ends with the same report format (from `AGENTS.md`): **Goal / Changed files / Acceptance evidence / Risks and open questions**. Paste that report into the team channel when a lane hits a milestone.
