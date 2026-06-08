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

> **Next action:** Confirm D1/D4/D5/D8 decisions, then begin Phase 1 (scaffold + HTTPS + self-test).
> **Active phase:** Phase 0 — `done`; Phase 1 — `not started`
> **Last updated:** 2026-06-08 by Claude (Phase 0 spikes complete)

---

## Phase status

| Phase | Status | Completed | What landed |
|-------|--------|-----------|-------------|
| 0 — Spikes & decisions | done | 2026-06-08 | D1/D4/D5/D8 resolved via live CORS probes + OIDC discovery + Office.js analysis |
| 1 — Scaffold + HTTPS + self-test | in progress | — | Vite+React+TS scaffolded; cert installed; StartupSelfTest built; dev server confirmed at https://localhost:3000 — awaiting G0 sideload test |
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
| D1 | Node sidecar yes/no | **No sidecar** for Phase 1–7 | Claude / 2026-06-08 | OpenAI `access-control-allow-origin: *` confirmed live; Anthropic same with `anthropic-dangerous-direct-browser-access` header; Ollama loopback ok; no OAuth needed. Revisit Phase 8 if OpenRouter PKCE added. |
| D2 | State library | undecided (Zustand recommended) | — | — |
| D3 | Secret storage | undecided | — | — |
| D4 | OpenAI OAuth availability | **No — API-key-only** | Claude / 2026-06-08 | `auth.openai.com` OIDC exists (PKCE S256 supported) but scopes are user-identity only, no API-access scopes. No public client ID for API provisioning. |
| D5 | Pivot scope | **MVP subset** | Claude / 2026-06-08 | Excel 16.0.20026 (M365 current, ExcelApi 1.17+) supports full pivot API; calculated fields permanently unavailable via Office.js. Ship list/get/create/add_field/refresh; gate remove/delete/advanced behind capability detection. |
| D6 | Confirmation granularity | undecided | — | — |
| D7 | Pricing source | undecided (bundled static recommended) | — | — |
| D8 | Multi-workbook scope/persistence | **Host-only** | Claude / 2026-06-08 | Office.js task panes are scoped to host workbook — no cross-workbook enumeration API. WorkbookRegistry returns one workbook. WorkbookSwitcher is N/A for MVP. |

## Session log (newest first)

> One line per working session: date — phase touched — outcome / handoff.

- 2026-06-08 — Phase 0 — All four spikes executed (live CORS probes to OpenAI/Anthropic/DeepSeek/OpenRouter, OIDC discovery for OpenAI OAuth, Office.js multi-workbook analysis, Excel/WebView2 version identification). Decisions D1/D4/D5/D8 resolved. DeepSeek and OpenRouter added as named Generic-adapter presets (CORS confirmed both). Awaiting user confirmation before Phase 1.
