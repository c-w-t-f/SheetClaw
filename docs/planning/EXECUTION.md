# Execution Runbook

How to drive implementation from this planning suite. The ten numbered docs are **reference**,
not a script. The execution spine is [`10-build-sequencing.md`](10-build-sequencing.md); you work
through it **one phase at a time**, generating a phase-scoped TODO list as you enter each phase
and stopping at each phase's verify step / gate.

**Where are we right now?** → [`PROGRESS.md`](PROGRESS.md). That file is the durable, cross-session
source of truth for project progress. **Read it first every session** to learn the active phase,
decisions already made, and gates already passed. The phase-scoped TODO lists are ephemeral
(in-session); PROGRESS.md is what survives between sessions.

## The loop

```
read PROGRESS.md → pick the active phase → read phase + its primary refs →
build a TODO for THAT phase only → implement → verify step → check gate (if any) →
UPDATE PROGRESS.md → confirm → next phase
```

- **Always start by reading PROGRESS.md; always end a phase by updating it** (status, gate result,
  any decision made, a session-log line).
- Don't generate one giant upfront TODO — it goes stale. Build the task list per phase.
- Don't cross a gate (G0–G3) until it passes. G1 (tool-calling harness) and G2 (OAuth popup in
  Edge WebView) can force design changes.
- Resolve the Phase 0 decisions (D1/D4/D5/D8) **before** building Phase 1+.

## Phase 0 kickoff prompt (spikes & decisions — investigation, not feature code)

> Read `docs/planning/00-index.md`, then `01-architecture-overview.md` (§1.5),
> `04-tool-schema-reference.md` (§4.5), `05-auth-oauth-spec.md`, and
> `10-build-sequencing.md` (Phase 0).
>
> Execute **Phase 0 (Spikes & decisions)**. This phase is investigation, not feature code — its
> job is to resolve decisions **D1, D4, D5, D8** with evidence. For each spike (0.1–0.4):
> - Determine the answer for my environment (Excel on Windows 11 desktop, Edge WebView2,
>   sideloaded). Write throwaway probe code if needed, but keep it isolated.
> - Record a written yes/no with the evidence behind it.
>
> When done, record your findings in `PROGRESS.md` (Decision log + session-log line), give me a
> findings summary and your **recommendation for each of D1/D4/D5/D8**, then **stop and ask me to
> confirm** before starting Phase 1. Do not assume the answers or begin Phase 1 scaffolding yet.

**Expect a handoff:** spikes 0.2 (OpenAI OAuth) and 0.3 (browser CORS reach) can only be fully
confirmed with real authenticated calls, which need your API keys. The model can get partway on
docs/static analysis but will likely hand live-call verification back to you.

## Phase N kickoff prompt (N ≥ 1 — actual build phases)

> Read `docs/planning/PROGRESS.md`, then `10-build-sequencing.md` Phase N and its primary refs
> (see §10.4). Build a task list for **Phase N only**, then implement it. Stop at the phase's
> **verify** step, update `PROGRESS.md` (phase status, gate result, session-log line), and walk me
> through gate **G#** (if the phase has one) before continuing.

Differences from the Phase 0 prompt: this one asks for a **phase-scoped TODO list** and stops at
the **gate**, not at a decision.

## Primary reference per phase (from §10.4)

| Phase | Primary docs |
|-------|--------------|
| 0 spikes | 1 (§1.5), 4, 5 |
| 1 scaffold+HTTPS | 1 (§1.2, 1.5), 9 (R8/R9) |
| 2 store+first adapter | 2, 3, 4 (§4.6), 7 (§7.2) |
| 3 adapters+harness | 4, 6 (§6.3–6.4), 9 (R1/R2) |
| 4 registry+executor+reads | 2 (§2.3/2.4), 4 (§4.1–4.4) |
| 5 loop+writes+gate | 6, 2 (§2.2/2.7/2.8), 3, 4 |
| 6 usage+dashboard | 7, 3 (§3.2), 8 (§8.4/8.5) |
| 7 charts+pivots | 4 (§4.4/4.5), 9 (R6) |
| 8 auth/OAuth | 5, 9 (R3/R12) |
| 9 polish+acceptance | 8, 9 (all) |

## Gates — do not cross until green

| Gate | When | Pass criteria |
|------|------|---------------|
| **G0** | end Phase 1 | Pane sideloads over trusted HTTPS; cert/loopback/Ollama self-test green |
| **G1** | end Phase 3 | Every tool-capable model returns a well-formed normalized tool call + round-trips a result; OpenAI↔Anthropic conformance |
| **G2** | Phase 8 | Full PKCE round-trip completes inside Excel's Edge WebView |
| **G3** | Phase 9 | All canonical scenarios pass incl. undo + multi-workbook |

## Decisions to confirm (owner: you)

| ID | Decision | Resolve by |
|----|----------|-----------|
| D1 | Node sidecar yes/no | Phase 0.3 (chat) / Phase 8 (OAuth) |
| D2 | State library (Zustand recommended) | Phase 2 start |
| D3 | Secret storage (localStorage vs OS vault) | Phase 8 |
| D4 | OpenAI OAuth availability | Phase 0.2 |
| D5 | Pivot scope (MVP subset recommended) | Phase 0.4 / Phase 7 |
| D6 | Confirmation granularity | Phase 5 |
| D7 | Pricing source (bundled static recommended) | Phase 6 |
| D8 | Multi-workbook scope/persistence | Phase 0.1 / Phase 4 |
