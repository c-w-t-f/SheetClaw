# Project Progress Tracker

**Durable cross-session state.** Every model session reads this FIRST to learn where the project
is, and updates it at the END of each phase (and whenever a decision is made or a gate passes).
The per-phase TODO lists are ephemeral (in-session); THIS file is the source of truth for
project-level progress.

- Status values: `not started` · `in progress` · `blocked` · `done`
- When you finish a phase: set its status to `done`, fill in the date and a one-line "what landed"
  note, and set the next phase to `in progress`.
- When a gate passes/fails: record it in the Gate log.
- When a decision is made: record the answer in the Decision log and stop guessing it thereafter.

---

## Current position

> **Next action:** Execute Phase 0 (spikes & decisions). Nothing built yet.
> **Active phase:** Phase 0 — `not started`
> **Last updated:** (unset) by (unset)

---

## Phase status

| Phase | Status | Completed | What landed |
|-------|--------|-----------|-------------|
| 0 — Spikes & decisions | not started | — | — |
| 1 — Scaffold + HTTPS + self-test | not started | — | — |
| 2 — Store + LLMClient + OpenAI adapter | not started | — | — |
| 3 — Anthropic + Ollama + harness | not started | — | — |
| 4 — Registry + ToolExecutor + read tools | not started | — | — |
| 5 — Loop + context + snapshot + write tools + gate | not started | — | — |
| 6 — Usage + pricing + dashboard | not started | — | — |
| 7 — Charts + pivots | not started | — | — |
| 8 — Auth / OAuth (+ optional sidecar) | not started | — | — |
| 9 — Polish + acceptance | not started | — | — |

## Gate log

| Gate | Phase | Result | Date | Notes |
|------|-------|--------|------|-------|
| G0 — Load & self-test | 1 | pending | — | — |
| G1 — Tool-calling harness | 3 | pending | — | per-model pass/fail recorded here |
| G2 — OAuth popup in Edge WebView | 8 | pending | — | — |
| G3 — Acceptance | 9 | pending | — | — |

## Decision log

| ID | Decision | Answer | Decided by / date | Notes |
|----|----------|--------|-------------------|-------|
| D1 | Node sidecar yes/no | undecided | — | — |
| D2 | State library | undecided (Zustand recommended) | — | — |
| D3 | Secret storage | undecided | — | — |
| D4 | OpenAI OAuth availability | undecided | — | — |
| D5 | Pivot scope | undecided (MVP subset recommended) | — | — |
| D6 | Confirmation granularity | undecided | — | — |
| D7 | Pricing source | undecided (bundled static recommended) | — | — |
| D8 | Multi-workbook scope/persistence | undecided | — | — |

## Session log (newest first)

> One line per working session: date — phase touched — outcome / handoff.

- (none yet)
