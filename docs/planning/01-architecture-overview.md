# Document 1 — Architecture Overview

## 1.1 System diagram

```
                          EXCEL (Windows desktop, Edge WebView2 host)
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │                                                                                 │
 │   ┌──────────────────────────── TASK PANE (iframe, HTTPS) ─────────────────┐    │
 │   │                                                                        │    │
 │   │   React UI layer                                                       │    │
 │   │   ┌──────────┬──────────────┬───────────────────┬──────────────────┐   │    │
 │   │   │ ChatPanel│ SettingsPanel│ ConfirmationModal │ UsageDashboard    │   │    │
 │   │   │  Footer  │ WorkbookSwitcher                                    │   │    │
 │   │   └────┬─────┴──────┬───────┴─────────┬─────────┴────────┬─────────┘   │    │
 │   │        │            │                 │                  │             │    │
 │   │        ▼            ▼                 ▼                  ▼             │    │
 │   │   ┌──────────────────────── APP STATE (store) ─────────────────────┐   │    │
 │   │   └───┬───────┬──────────┬──────────┬──────────┬──────────┬────────┘   │    │
 │   │       │       │          │          │          │          │            │    │
 │   │  ┌────▼───┐ ┌─▼────────┐ ┌▼────────┐ ┌▼────────┐ ┌▼───────┐ ┌▼────────┐ │    │
 │   │  │ Agent  │ │ Context  │ │ Usage   │ │ Auth    │ │Workbook│ │Snapshot │ │    │
 │   │  │ Loop   │ │ Builder  │ │ Tracker │ │ Manager │ │Registry│ │Manager  │ │    │
 │   │  └──┬──┬──┘ └────┬─────┘ └────┬────┘ └───┬─────┘ └───┬────┘ └────┬────┘ │    │
 │   │     │  │         │            │          │           │           │      │    │
 │   │     │  │         │            │          │           │           │      │    │
 │   │     │  └─────────┴────────────┴──────────┘           │           │      │    │
 │   │     │                    │                           │           │      │    │
 │   │  ┌──▼───────────────┐    │                    ┌──────▼───────────▼────┐ │    │
 │   │  │  LLM PROVIDER     │    │                    │   TOOL EXECUTOR        │ │    │
 │   │  │  LAYER            │    │                    │  (dispatch + validate) │ │    │
 │   │  │ ┌──────────────┐  │    │                    └──────────┬─────────────┘ │    │
 │   │  │ │LLMClient IFC │  │    │                               │               │    │
 │   │  │ ├──────────────┤  │    │                               ▼               │    │
 │   │  │ │Ollama adapter│  │    │                    ┌────────────────────────┐ │    │
 │   │  │ │OpenAI adapter│  │    │                    │   Office.js (Excel API)│ │    │
 │   │  │ │Anthropic ad. │  │    │                    │   Excel.run(ctx => ...)│ │    │
 │   │  │ │Generic ad.   │  │    │                    └───────────┬────────────┘ │    │
 │   │  │ └──────────────┘  │    │                                │              │    │
 │   │  └────────┬──────────┘    │                                │              │    │
 │   │           │ fetch()       │ persist                        │ host bridge  │    │
 │   └───────────┼───────────────┼────────────────────────────────┼─────────────┘    │
 │               │               │                                │                  │
 └───────────────┼───────────────┼────────────────────────────────┼──────────────────┘
                 │               │                                ▼
                 │               ▼                         Excel document model
                 │        ┌──────────────┐                 (workbooks / sheets /
                 │        │ localStorage  │                  ranges / charts /
                 │        │  (per-origin) │                  pivot tables)
                 │        └──────────────┘
                 │
                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  EXTERNAL / LOCAL ENDPOINTS                                  │
   │  • Ollama         http://localhost:11434  (loopback)        │
   │  • OpenAI         https://api.openai.com                    │
   │  • Anthropic      https://api.anthropic.com                 │
   │  • Generic        https://<any-openai-compatible-base-url>  │
   │                                                             │
   │  OPTIONAL Node sidecar (loopback HTTPS) — see §1.5 [D1]     │
   │  • OAuth token exchange / refresh                           │
   │  • CORS-restricted provider proxy                           │
   │  • OS credential-vault bridge                               │
   └─────────────────────────────────────────────────────────────┘
```

### Interaction summary
- **UI → store → services**: UI never calls Office.js or `fetch` directly; it dispatches intents into the store, which drives the service layer (AgentLoop, AuthManager, etc.).
- **AgentLoop is the orchestrator**: it pulls context from ContextBuilder, calls the active LLMClient, parses tool calls, routes them to ToolExecutor, records usage via UsageTracker, and pauses at the ConfirmationModal gate before writes.
- **ToolExecutor is the only component that touches Office.js.** Everything else treats Excel through the WorkbookRegistry and tool results.
- **SnapshotManager** is invoked by ToolExecutor immediately before any mutating tool runs, enabling one-click undo.

## 1.2 Technology choices and justification

| Concern | Choice | Justification | Alternatives rejected |
|---------|--------|---------------|-----------------------|
| UI framework | **React 18 + TypeScript** | Office Add-in Yeoman generator and Fluent UI React target React; component model fits stateful chat + modal + dashboard; strong typing critical for tool schemas and provider response shapes. | Vanilla JS (too much hand-rolled state for a chat+agent UI); Svelte/Vue (smaller Office ecosystem, fewer Fluent components). |
| Component library | **Fluent UI React v9** | Native Office look, accessible primitives (Dialog, Spinner, message bars), theming aligned to Excel. | Hand-rolled CSS (slower, less accessible); MUI (visually foreign to Office). |
| State management | **Zustand** (single store, sliced) **[DECISION REQUIRED D2]** | Minimal boilerplate, works outside React (services can read/write store without hooks), easy transient/agent-loop state, selective subscriptions avoid re-render storms during streaming. | Redux Toolkit (more ceremony, but acceptable if team prefers devtools/time-travel); React Context+reducer (re-render scaling problems with high-frequency streaming updates). |
| Async/streaming | **Native `fetch` + ReadableStream / SSE parsing**; AbortController for stop | All four providers expose HTTP streaming; no SDK needed; avoids bundling provider SDKs that assume Node. | Provider SDKs (Anthropic/OpenAI JS SDKs assume Node or add bundle weight; some block browser CORS by design). |
| Build tooling | **Webpack 5** (Office generator default) or **Vite** with the office-addin HTTPS plugin | Office tooling (`office-addin-debugging`, `office-addin-dev-certs`) integrates cleanly. | — |
| Local persistence | **localStorage** for config/usage/snapshots-index; **in-memory + IndexedDB** for large snapshot payloads if needed | Per-origin, synchronous, simple; usage history and config are small. Snapshots of large ranges can exceed localStorage's ~5 MB, so payloads spill to IndexedDB. | Cookies (size limits, sent to server); pure in-memory (lost on pane reload — Office reloads the iframe frequently). |
| HTTPS / certs | **`office-addin-dev-certs` (mkcert under the hood)** to mint a locally-trusted cert for `https://localhost:<port>` | Office requires HTTPS for task panes; the dev-certs tool installs a trusted root so WebView2 accepts it without warnings. | Self-signed without trust store install (WebView2 rejects); ngrok/tunnels (unnecessary for local-only). |
| Tokenizer (estimation) | **`gpt-tokenizer` (o200k/cl100k) for OpenAI-family; heuristic char/4 for others** | Pre-execution estimates only need to be approximate; bundling one BPE tokenizer covers OpenAI/Generic; Anthropic/Ollama use ratio heuristics or the provider's count endpoint when available. | Bundling every tokenizer (bundle bloat for marginal accuracy in a personal tool). |
| OAuth | **PKCE (public client), token exchange in-browser if provider CORS allows, else via sidecar [D1]** | Personal add-in has no confidential backend; PKCE is the correct public-client flow. | Implicit flow (deprecated/insecure); client-secret flow (no safe place to store a secret in a sideloaded add-in). |

## 1.3 Data flow narrative — one instruction, end to end

User types *"In Budget.xlsx, set the Q3 total in B14 to the sum of B2:B13"* and presses Send.

1. **ChatPanel** captures the text. Before send, it calls `ContextBuilder.estimateInputTokens()` to show a live pre-execution cost estimate next to the Send button. User clicks **Send**.
2. **ChatPanel** dispatches `agent.start(instruction)` to the store. The store sets session state → `RUNNING` and instantiates/locks an **AgentSession**.
3. **AgentLoop** asks **WorkbookRegistry** for the active scope. The session is scoped to the workbook the user last selected in **WorkbookSwitcher** (here, `Budget.xlsx → wb_01H...`). Registry returns the manifest of open workbooks and the active `workbook_id`.
4. **AgentLoop → ContextBuilder.build()**: assembles the system prompt, the workbook manifest (names, sheets, used ranges, active selection), trimmed conversation history, and the tool definitions. ContextBuilder reads lightweight sheet context (used range address, headers, selection) via **ToolExecutor**'s read path (read-only Office.js calls).
5. **AgentLoop → LLMClient (active adapter, e.g. OpenAI).** The adapter serializes messages + tools into provider format and streams the response. Tokens stream into ChatPanel as an assistant message.
6. The model responds with a tool call: `read_range(workbook_id, "Sheet1", "B2:B13")`. **AgentLoop** parses the tool call (provider-specific parser), appends an assistant turn containing the tool call to history.
7. **AgentLoop → ToolExecutor.execute(toolCall).** ToolExecutor validates args against the tool schema, confirms `read_range` is non-mutating (no snapshot/confirmation needed), runs `Excel.run` against `wb_01H...`, returns `{values: [...], address: "B2:B13"}`.
8. **UsageTracker** records the turn's token counts (from step 5's response) into a UsageRecord and updates the session/footer totals.
9. **AgentLoop** feeds the tool result back as a tool message and calls the LLMClient again. The model now responds with `write_range(workbook_id, "Sheet1", "B14", [[<sum>]])` (or chooses to write a formula `=SUM(B2:B13)`).
10. ToolExecutor recognizes `write_range` as **mutating**. Before executing, it:
    a. Calls **SnapshotManager.capture(workbook_id, "Sheet1", "B14")** to record the pre-write value/format → a **SnapshotEntry**.
    b. Computes a **per-cell diff** (before vs proposed after).
    c. Signals the loop to **pause** and surfaces the diff to **ConfirmationModal** (gate, §1.1).
11. **ConfirmationModal** shows: workbook = Budget.xlsx, sheet = Sheet1, cell B14: `<empty>` → `=SUM(B2:B13)` (preview value). User clicks **Apply**.
12. ToolExecutor performs the write via `Excel.run`, returns the result; SnapshotManager links the snapshot to the applied change so **Undo** is available in ChatPanel/Footer.
13. **AgentLoop** feeds the write result back. The model returns a final natural-language confirmation ("Set B14 to =SUM(B2:B13), which evaluates to 12,480."). No further tool calls → loop **exit condition met**.
14. Session state → `DONE`. **UsageTracker** finalizes the session aggregate; **Footer** shows updated session token count + estimated cost. The snapshot remains available for undo until evicted.

## 1.4 Key architectural decisions and tradeoffs

1. **Single orchestrator (AgentLoop) owns the control flow; everything else is a service.**
   *Tradeoff*: centralizes complexity in one place (risk of a god-object) vs. clear, testable control flow and one place to enforce the confirmation gate. Mitigation: AgentLoop delegates all real work to services and holds only run state.

2. **ToolExecutor is the sole Office.js boundary.**
   *Tradeoff*: an extra indirection vs. consistent error mapping, uniform `Excel.run` batching, single point for snapshotting and workbook scoping, and the ability to unit-test the loop with a mock executor. Chosen for safety and testability.

3. **Provider differences isolated behind `LLMClient`; the loop is provider-agnostic.**
   *Tradeoff*: adapters must normalize tool-call formats and usage shapes (real work) vs. the loop and UI never branch on provider. Normalization layer is the right place for the OpenAI↔Anthropic schema divergence (see Risk R2, Doc 4 §serialization).

4. **Browser-first; sidecar only where the browser genuinely cannot comply (§1.5).**
   *Tradeoff*: a sidecar adds a process to run and trust vs. some providers' CORS and OAuth token endpoints are browser-hostile. Decision deferred per [D1]; architecture keeps the sidecar optional and pluggable behind AuthManager/LLMClient.

5. **Confirmation gate is mandatory and lives below the loop, in ToolExecutor's mutating path.**
   *Tradeoff*: cannot be bypassed even by a misbehaving model (safety) vs. adds latency/UX friction for every write. Mitigated by batching options [D6] and an explicit "auto-approve this session" toggle (still snapshotted).

6. **Snapshot-before-write always, undo is best-effort by range restore.**
   *Tradeoff*: storage cost and complexity for charts/pivots (structural, not just values) vs. a safety net for a tool that edits user data. Charts/pivots get a coarser undo (delete-created / restore-definition) — see Doc 4 safety notes.

7. **Usage history capped to a 30-day rolling window in localStorage.**
   *Tradeoff*: loses long-term history vs. bounded storage and no backend. Acceptable for personal use; CSV export covers archival.

## 1.5 Browser context vs Node sidecar  **[DECISION REQUIRED D1]**

**Default position: run everything in the browser (task pane WebView). Introduce a sidecar only if the following blockers are confirmed during the spike phase (Doc 10, Phase 0/3).**

What runs in the browser:
- All UI, store, AgentLoop, ContextBuilder, ToolExecutor, WorkbookRegistry, SnapshotManager, UsageTracker.
- All Office.js calls (only possible here).
- `fetch`-based calls to **Ollama** (loopback, CORS-permissive when `OLLAMA_ORIGINS` set), **Anthropic** (supports `anthropic-dangerous-direct-browser-access` header for direct browser calls), **OpenAI** (allows browser calls with an API key; CORS permitted), and **Generic** OpenAI-compatible endpoints (CORS varies).
- PKCE code generation, popup launch, redirect capture (via `Office.context.ui.displayDialogAsync` or a same-origin redirect page).

What may require a **sidecar** (loopback HTTPS Node process):
- **OAuth token exchange / refresh** where the provider's `/token` endpoint does not send CORS headers (common). The browser can obtain the auth `code` but cannot POST to a non-CORS token endpoint; a tiny local proxy performs the exchange. [D1]
- **Generic endpoints that block browser CORS** (some self-hosted gateways) — a pass-through proxy.
- **Secret-at-rest hardening**: storing tokens/keys in the OS credential vault (DPAPI / Windows Credential Manager) instead of localStorage. [D3]

Why keep it optional: a sidecar means another process to launch, an extra trusted loopback cert, and lifecycle management. For a personal tool, API-key mode + Ollama + Anthropic direct-browser may fully avoid it. The architecture isolates all three sidecar use-cases behind interfaces (`AuthManager.tokenExchange`, `LLMClient` transport, `SecretStore`) so a sidecar can be added without touching the loop or UI.

**Recommendation**: Build browser-only first (API-key auth for all four providers + Ollama). Add the sidecar in a later phase *only if* OpenAI consumer OAuth (or a CORS-blocked generic endpoint) is required. See Doc 5 and Doc 10 Phase 8.
