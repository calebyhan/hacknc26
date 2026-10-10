# Claude Code entrypoint — Rally

Follow `AGENTS.md` as the primary agent guidance and `docs/INDEX.md` as the map. Do not reinterpret this as a request to run unrestricted autonomous tooling in response to external messages.

**Session start:**
1. Inspect repository state and identify which acceptance criteria are already implemented.
2. Review open decisions in `docs/14-decisions-and-open-questions.md`.
3. Propose a small task with tests. Avoid unrelated refactors.
4. Implement, run checks, report exact results, and record new decisions.

**Core invariants:** Phone contact selection != consent; LLM text != authorization; proposed assignment != confirmed assignment; an unverified event reference != permission; a successful HTTP call != user acceptance.

**Implementation order:** Photon + durable inbox/outbox → event/task state → opt-in and approval → deterministic resolution and replanning → Claude worker → SwiftUI → weather → polish.

**Default constraints:** iMessage primary; no group-chat requirement on shared Photon Pro; local Claude subscription is rate-limited and the worker may go offline; avoid large prompts and unnecessary LLM calls; preserve privacy boundaries across events.

**Acceptance baseline:** `docs/01-scope-and-acceptance.md` and `docs/11-testing-and-demo.md`. A test is not passing until executed.
