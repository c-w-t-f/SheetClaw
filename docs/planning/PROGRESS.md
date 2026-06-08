# Project Progress Tracker

**Durable cross-session state.** Every model session reads this FIRST to learn where the project
is, and updates it at the END of each phase (and whenever a decision is made or a gate passes).
The per-phase TODO lists are ephemeral (in-session); THIS file is the source of truth for
project-level progress.

- Status values: `not started` | `in progress` | `blocked` | `done`
- When you finish a phase: set its status to `done`, fill in the date and a one-line "what landed"
  note, and set the next phase to `in progress`.
- When a gate passes/fails: record it in the Gate log.
- When a decision is made: record the answer in the Decision log and stop guessing it thereafter.

---

## Current position

> **Next action:** Retry G2 chat verification in Excel WebView2 after OpenRouter model auto-selection fix; complete a tool call using the stored OAuth credential.
> **Active phase:** Phase 8 - `in progress`
> **Last updated:** 2026-06-08 by Codex (OAuth completes; OpenRouter empty-model 404 fixed; G2 chat retry pending; 78/78 tests pass)

---

## Phase status

| Phase | Status | Completed | What landed |
|-------|--------|-----------|-------------|
| 0 - Spikes & decisions | done | 2026-06-08 | D1/D4/D5/D8 resolved via live CORS probes + OIDC discovery + Office.js analysis |
| 1 - Scaffold + HTTPS + self-test | done | 2026-06-08 | Vite+React+TS scaffold; office-addin-dev-certs trusted cert; manifest.xml shared-folder sideload; StartupSelfTest component; dev server at https://localhost:3000 |
| 2 - Store + LLMClient + OpenAI adapter | done | 2026-06-08 | All types (src/types/); Zustand store (config/auth/session/usage slices + localStorage wrapper); OpenAI/Generic adapter with SSE streaming + tool-call reassembly + usage extraction; 6/6 vitest tests pass |
| 3 - Anthropic + Ollama + harness | done | 2026-06-08 | Anthropic/Ollama adapters + adapter factory + harness + HarnessPanel; 14/14 tests; G1 PASS (Ollama llama3.1, OpenRouter qwen3.7-max) |
| 4 - Registry + ToolExecutor + read tools | done | 2026-06-08 | WorkbookRegistry (D8 host-only, injectable runner), ToolExecutor (arg validation, error mapping), 8 read-only tool specs + handlers; 28/28 tests |
| 5 - Loop + context + snapshot + write tools + gate | done | 2026-06-08 | AgentLoop + ContextBuilder + SnapshotManager + write_range + clear_range + ChatPanel; 46/46 tests, tsc clean |
| 6 - Usage + pricing + dashboard | done | 2026-06-08 | Bundled pricing.json (D7 resolved), findPricing/computeCost, 30-day rolling storage, UsageDashboard + Footer + tab nav, loop wired to recordUsage; 56/56 tests |
| 7 - Charts + pivots | done | 2026-06-08 | 5 chart tools + 5 pivot tools; ToolUnsupportedError; captureStructural snapshots; ExcelApi 1.8+ capability gating; 73/73 tests, tsc clean |
| 8 - Auth / OAuth (+ optional sidecar) | in progress | - | OpenRouter PKCE Office Dialog flow, same-origin localhost start/callback pages, OAuth credential storage, adapter auth resolution; G2 manual Excel verify pending |
| 9 - Polish + acceptance | not started | - | - |

## Gate log

| Gate | Phase | Result | Date | Notes |
|------|-------|--------|------|-------|
| G0 - Load & self-test | 1 | **PASS** | 2026-06-08 | Pane sideloaded over https://localhost:3000; cert ok; loopback ok; Ollama not running, expected and not a blocker |
| G1 - Tool-calling harness | 3 | **PASS** | 2026-06-08 | Ollama llama3.1:latest ok; OpenRouter qwen/qwen3.7-max ok; OpenRouter duplicate-finish_reason bug found and fixed in openai.ts |
| G2 - OAuth popup in Edge WebView | 8 | pending | - | OAuth dialog/callback now completes in Excel WebView2. First chat attempt hit OpenRouter HTTP 404 because Generic/OpenRouter had no selected model. Config migration and auto-select now choose `openai/gpt-4o-mini`; chat/tool-call retry pending. |
| G3 - Acceptance | 9 | pending | - | - |

## Decision log

| ID | Decision | Answer | Decided by / date | Notes |
|----|----------|--------|-------------------|-------|
| D1 | Node sidecar yes/no | **No sidecar** for Phase 1-8 MVP | Codex / 2026-06-08 | Phases 1-7 direct browser calls remain. Phase 8 uses the existing trusted Vite HTTPS origin as the loopback callback listener (`/oauth-callback.html`) and exchanges the OpenRouter code directly from the pane. Revisit only if Excel WebView2 blocks popup/callback or OpenRouter exchange CORS fails during G2. |
| D2 | State library | undecided (Zustand recommended) | - | - |
| D3 | Secret storage | undecided | - | - |
| D4 | OpenAI OAuth availability | **No - API-key-only** | Claude / 2026-06-08 | `auth.openai.com` OIDC exists (PKCE S256 supported) but scopes are user-identity only, no API-access scopes. No public client ID for API provisioning. |
| D5 | Pivot scope | **MVP subset** | Claude / 2026-06-08 | Excel 16.0.20026 (M365 current, ExcelApi 1.17+) supports full pivot API; calculated fields permanently unavailable via Office.js. Ship list/get/create/add_field/refresh; gate remove/delete/advanced behind capability detection. |
| D6 | Confirmation granularity | undecided | - | - |
| D7 | Pricing source | **Bundled static pricing.json** | Claude / 2026-06-08 | Personal use; `updatedAt` visible in Settings; user can edit rates in-app later. |
| D8 | Multi-workbook scope/persistence | **Host-only** | Claude / 2026-06-08 | Office.js task panes are scoped to host workbook; no cross-workbook enumeration API. WorkbookRegistry returns one workbook. WorkbookSwitcher is N/A for MVP. |

## Session log (newest first)

> One line per working session: date - phase touched - outcome / handoff.

- 2026-06-08 - Phase 8 - OAuth completed in Excel, but chat returned OpenRouter HTTP 404 due to empty Generic model. Added OpenRouter default model + stored-config migration, auto-select preferred model after model fetch, and ChatPanel model-ready guard. 78/78 tests, build clean; G2 chat retry pending.
- 2026-06-08 - Phase 8 - Fixed Excel WebView2 popup blocker by replacing raw `window.open()` primary path with Office Dialog API; added `/oauth-start.html`, Office.js `messageParent` callback, and retained popup fallback for browser/dev. 78/78 tests, build clean; G2 retry pending.
- 2026-06-08 - Phase 8 - OpenRouter PKCE OAuth implementation landed: `src/auth` flow helpers + callback page, OAuth credential fields/storage, Settings sign-in button, adapter factory consumes AuthState; 77/77 tests, build clean. G2 manual Excel WebView2 authorization still pending.
- 2026-06-08 - Phase 7 - 5 chart tools (list/create/modify/delete/set_data) + 5 pivot tools (list/get/create/add_field/refresh); ToolUnsupportedError (separate module to avoid Vitest JS-shadow bug); captureStructural undo; ExcelApi 1.8 capability gating; 73/73 tests, tsc clean.
- 2026-06-08 - Phase 6 - Bundled pricing (D7), findPricing/computeCost, loop->recordUsage wiring, 30-day rolling window, UsageDashboard + Footer + tab nav (Chat/Usage). 56/56 tests, tsc clean.
- 2026-06-08 - Phase 5 - AgentLoop + ContextBuilder + SnapshotManager + write_range/clear_range handlers + system prompt + ChatPanel. 46/46 tests, tsc clean. Manual end-to-end verify pending.
- 2026-06-08 - Phase 4 - WorkbookRegistry + ToolExecutor + 8 read-only tools (read_range, list_sheets, get_sheet_context, get_selection, list_workbooks, get_active_workbook, set_scope_workbook, get_named_ranges). 28/28 tests, tsc clean.
- 2026-06-08 - Phase 3 - Anthropic/Ollama adapters, adapter factory, harness.ts, HarnessPanel.tsx. 14/14 tests, tsc clean. G1 PASS: Ollama llama3.1:latest ok; OpenRouter qwen/qwen3.7-max ok. Fixed OpenRouter duplicate finish_reason bug.
- 2026-06-08 - Phase 2 - All types, Zustand store, OpenAI/Generic adapter, SSE fixture tests. 6/6 tests pass, tsc clean. Phase 3 next.
- 2026-06-08 - Phase 1 - G0 PASSED. Pane sideloads over trusted HTTPS; cert ok; loopback ok; Ollama not started, not a blocker. Phase 2 next.
- 2026-06-08 - Phase 0 - All four spikes executed (live CORS probes to OpenAI/Anthropic/DeepSeek/OpenRouter, OIDC discovery for OpenAI OAuth, Office.js multi-workbook analysis, Excel/WebView2 version identification). Decisions D1/D4/D5/D8 resolved. DeepSeek and OpenRouter added as named Generic-adapter presets (CORS confirmed both).
