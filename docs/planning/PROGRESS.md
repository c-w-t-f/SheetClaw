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

> **Next action:** Begin Phase 3 — Anthropic + Ollama adapters + tool-calling harness (Gate G1).
> **Active phase:** Phase 3 — `not started`
> **Last updated:** 2026-06-08 by Claude (Phase 2 done, 6/6 tests pass)

---

## Phase status

| Phase | Status | Completed | What landed |
|-------|--------|-----------|-------------|
| 0 — Spikes & decisions | done | 2026-06-08 | D1/D4/D5/D8 resolved via live CORS probes + OIDC discovery + Office.js analysis |
| 1 — Scaffold + HTTPS + self-test | done | 2026-06-08 | Vite+React+TS scaffold; office-addin-dev-certs trusted cert; manifest.xml shared-folder sideload; StartupSelfTest component; dev server at https://localhost:3000 |
| 2 — Store + LLMClient + OpenAI adapter | done | 2026-06-08 | All types (src/types/); Zustand store (config/auth/session/usage slices + localStorage wrapper); OpenAI/Generic adapter with SSE streaming + tool-call reassembly + usage extraction; 6/6 vitest tests pass |
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
| G0 — Load & self-test | 1 | **PASS** | 2026-06-08 | Pane sideloaded over https://localhost:3000; cert ✅ loopback ✅; Ollama ❌ (not running — expected, not a blocker) |
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

- 2026-06-08 — Phase 2 — All types, Zustand store, OpenAI/Generic adapter, SSE fixture tests. 6/6 tests pass, tsc clean. Phase 3 next.
- 2026-06-08 — Phase 1 — G0 PASSED. Pane sideloads over trusted HTTPS; cert ✅ loopback ✅; Ollama ❌ (not started, not a blocker). Phase 2 next.
- 2026-06-08 — Phase 0 — All four spikes executed (live CORS probes to OpenAI/Anthropic/DeepSeek/OpenRouter, OIDC discovery for OpenAI OAuth, Office.js multi-workbook analysis, Excel/WebView2 version identification). Decisions D1/D4/D5/D8 resolved. DeepSeek and OpenRouter added as named Generic-adapter presets (CORS confirmed both).
