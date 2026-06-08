# Document 2 — Component Specification

Each component is specified as: **Responsibility** (one sentence) · **Public interface** (inputs / outputs / events) · **Internal state** · **Dependencies** · **Error states & surfacing**.

Type names referenced here (`Message`, `ToolCall`, `UsageRecord`, etc.) are defined in Doc 3.

---

## 2.1 `LLMClient` interface + provider adapters

### 2.1.1 `LLMClient` (interface)

- **Responsibility**: Provide a provider-agnostic contract for sending a normalized conversation + tool set to an LLM and receiving a normalized streamed response with tool calls and usage.
- **Public interface**
  - Inputs:
    - `chat(req: LLMRequest, signal: AbortSignal): AsyncIterable<LLMStreamEvent>`
      - `LLMRequest = { model, messages: NormalizedMessage[], tools: ToolSpec[], temperature?, maxTokens?, system? }`
    - `listModels(): Promise<ModelInfo[]>` (may throw `NotSupported` → caller falls back to manual model entry)
    - `capabilities(): ProviderCapabilities` (`{ supportsTools, supportsStreaming, supportsOAuth, nativeUsage, toolFormat: 'openai'|'anthropic' }`)
  - Outputs (`LLMStreamEvent` union): `text-delta`, `tool-call-start`, `tool-call-delta`, `tool-call-end`, `usage`, `done`, `error`.
  - Events emitted: none directly (it is a pull async-iterable); the AgentLoop adapts events to store updates.
- **Internal state**: none beyond the per-call request (adapters are stateless; auth/config injected per call).
- **Dependencies**: AuthManager (for current token/key + base URL), transport (`fetch` or sidecar proxy).
- **Error states**: `AuthError`, `RateLimitError(retryAfter?)`, `NetworkError`, `ProviderError(status, body)`, `MalformedResponseError`, `NotSupported`. All surfaced as a terminal `error` stream event carrying a typed `LLMError`; AgentLoop maps them to UI message bars and retry policy (Doc 6 §error handling).

### 2.1.2 OpenAI adapter

- **Responsibility**: Implement `LLMClient` against the OpenAI Chat Completions (or Responses) API using OpenAI tool format.
- **Interface specifics**: serializes `tools` as `[{type:'function', function:{name, description, parameters}}]`; parses `choices[].delta.tool_calls[]` (index-keyed, argument JSON streamed in fragments → must be reassembled); usage from `usage` (final chunk, requires `stream_options.include_usage=true`).
- **Internal state**: none.
- **Dependencies**: AuthManager (Bearer key or OAuth token), base URL (`https://api.openai.com/v1`).
- **Error states**: maps HTTP 401→`AuthError`, 429→`RateLimitError(retry-after)`, 5xx→`ProviderError`; incomplete tool-call JSON at stream end→`MalformedResponseError`.

### 2.1.3 Anthropic adapter

- **Responsibility**: Implement `LLMClient` against the Anthropic Messages API using Anthropic tool format.
- **Interface specifics**: top-level `system` string (not a message); `tools` as `[{name, description, input_schema}]`; parses `content` blocks of type `tool_use` from SSE events (`content_block_start/_delta(input_json)/_stop`); usage from `message_start.usage.input_tokens` + `message_delta.usage.output_tokens`. Sets `anthropic-version` and (for direct browser) `anthropic-dangerous-direct-browser-access: true`.
- **Internal state**: none.
- **Dependencies**: AuthManager (`x-api-key`), base URL (`https://api.anthropic.com`).
- **Error states**: 401→`AuthError`, 429→`RateLimitError`, `overloaded_error`→`RateLimitError`; malformed `tool_use` JSON→`MalformedResponseError`.

### 2.1.4 Ollama adapter

- **Responsibility**: Implement `LLMClient` against a local Ollama server (OpenAI-compatible `/v1/chat/completions` or native `/api/chat`).
- **Interface specifics**: prefer Ollama's OpenAI-compatible endpoint to reuse OpenAI parsing; `listModels()` via `/api/tags`; **tool support varies by model** (see Risk R1) — `capabilities().supportsTools` is determined per-model where possible, else assumed true with robust fallback parsing.
- **Internal state**: none.
- **Dependencies**: base URL (`http://localhost:11434`), no auth.
- **Error states**: connection refused→`NetworkError("Ollama not running")`; model-not-pulled→`ProviderError` with actionable message; tool calls emitted as text JSON by non-tool models→`MalformedResponseError` handled by lenient parser (Doc 6).

### 2.1.5 Generic OpenAI-compatible adapter

- **Responsibility**: Implement `LLMClient` against any user-supplied OpenAI-compatible base URL (OpenRouter, Groq, LM Studio, etc.).
- **Interface specifics**: identical wire format to OpenAI adapter but with configurable base URL, key header name, and optional extra headers; `listModels()` via `/models` (graceful fallback to manual entry).
- **Internal state**: none.
- **Dependencies**: AuthManager (key), ProviderConfig (base URL, headers).
- **Error states**: CORS failure→`NetworkError("endpoint blocked browser request")` with hint to enable sidecar proxy; otherwise as OpenAI adapter.

---

## 2.2 `AgentLoop`

- **Responsibility**: Orchestrate a single agentic run — assemble context, call the LLM, parse/execute tool calls, enforce the confirmation gate, and decide when to iterate vs. surface a result.
- **Public interface**
  - Inputs: `start(instruction: string, scope: SessionScope): void`; `stop(): void`; `resolveConfirmation(decision: ConfirmDecision): void`; `retryLastStep(): void`.
  - Outputs: drives store mutations (appends `Message`s, updates session status, streams deltas).
  - Events emitted: `session:status-changed`, `message:appended`, `message:delta`, `confirmation:requested`, `usage:recorded`, `run:error`, `run:done`.
- **Internal state (owns the `AgentSession`)**: current run state (`IDLE|BUILDING|CALLING_LLM|PARSING|AWAITING_CONFIRMATION|EXECUTING_TOOL|ERROR|DONE`), iteration counter, pending tool calls, abort controller, token budget accounting, last error.
- **Dependencies**: ContextBuilder, LLMClient (active adapter), ToolExecutor, SnapshotManager (via executor), UsageTracker, WorkbookRegistry, store.
- **Error states**: malformed tool call → repair/re-ask or surface; tool execution error → feed error result back or abort; LLM error → typed retry/backoff or surface; budget exceeded → compaction or stop-with-message. All surfaced via `run:error` event → ChatPanel error bubble + Footer state. (Full matrix in Doc 6.)

---

## 2.3 `ToolExecutor`

- **Responsibility**: Validate, snapshot, dispatch, and normalize the result of every agent tool call against Office.js, scoped to a `workbook_id`.
- **Public interface**
  - Inputs: `execute(call: ToolCall, scope: SessionScope): Promise<ToolResult>`; `readContext(req): Promise<SheetContext>` (read-only fast path for ContextBuilder); `registerTool(def)` / `getToolSpecs(): ToolSpec[]`.
  - Outputs: `ToolResult` (success payload or structured error).
  - Events emitted: `tool:started`, `tool:snapshot-captured`, `tool:requires-confirmation`, `tool:applied`, `tool:failed`.
- **Internal state**: tool registry (name → handler + schema + `mutating` flag), in-flight call guard (serializes Office.js access).
- **Dependencies**: Office.js (`Excel.run`), WorkbookRegistry (resolve `workbook_id`→host object), SnapshotManager (capture before mutating), schema validator.
- **Error states**: `ValidationError` (bad args, returned as tool result so the model can correct), `WorkbookNotFoundError`, `RangeError` (invalid address), `OfficeApiError` (host threw), `PermissionDenied` (write rejected at gate). Validation/Office errors are returned as `ToolResult{ok:false, error}` so the loop can feed them back; fatal host errors raise `run:error`.

---

## 2.4 `WorkbookRegistry`

- **Responsibility**: Enumerate all open workbooks, assign stable session-scoped IDs, track the active workbook, and resolve `workbook_id` to a usable Office handle.
- **Public interface**
  - Inputs: `refresh(): Promise<WorkbookHandle[]>`; `setActive(workbook_id): void`; `resolve(workbook_id): WorkbookRef`; `getManifest(): WorkbookManifest`.
  - Outputs: `WorkbookHandle[]`, active id, manifest (names, sheets, used ranges, selection).
  - Events emitted: `workbooks:changed`, `active:changed`.
- **Internal state**: `Map<workbook_id, WorkbookHandle>`, active id, last refresh timestamp.
- **Dependencies**: Office.js. **Constraint [D8]**: the Excel JS API surface for *multiple* open workbooks is limited on Windows desktop — the add-in is hosted by one workbook and cross-workbook addressing is not fully supported in all builds. The registry must be designed to degrade to **single-workbook scope** if multi-workbook handles are unavailable; multi-workbook is a capability-gated feature.
- **Error states**: `MultiWorkbookUnsupported` (degrade to host workbook only, surface a non-blocking notice in WorkbookSwitcher); `StaleHandle` (workbook closed → refresh + re-scope, warn if active scope vanished — see Risk R5).

---

## 2.5 `AuthManager`

- **Responsibility**: Own per-provider authentication — OAuth/PKCE flows, API-key entry/validation, token storage/refresh — and expose a reactive auth state per provider.
- **Public interface**
  - Inputs: `startOAuth(provider): Promise<void>`; `completeOAuth(code, state): Promise<void>`; `setApiKey(provider, key): Promise<void>`; `signOut(provider): void`; `getToken(provider): Promise<Credential>` (refreshes if expired); `testConnection(provider): Promise<TestResult>`.
  - Outputs: `Credential` (Bearer/x-api-key value), `AuthState` per provider.
  - Events emitted: `auth:state-changed(provider, state)`.
- **Internal state**: per-provider `AuthState` machine (Doc 5 §state machine), in-memory tokens, refresh timers, PKCE verifier (transient).
- **Dependencies**: localStorage/SecretStore (ProviderConfig + tokens), token-exchange transport (browser or sidecar [D1]), Office dialog API for popups.
- **Error states**: `OAuthDenied`, `OAuthStateMismatch` (CSRF guard), `TokenExchangeFailed`, `RefreshFailed`→`token-expired`, `InvalidApiKey`. Surfaced via `auth:state-changed` → SettingsPanel badges + blocking banner when the active provider is unauthenticated.

---

## 2.6 `UsageTracker`

- **Responsibility**: Record per-turn token usage and cost, maintain session totals, and persist a 30-day rolling history for the dashboard.
- **Public interface**
  - Inputs: `recordTurn(input: UsageInput): UsageRecord`; `estimate(req): CostEstimate`; `getSessionTotals(sessionId): Totals`; `query(filter): UsageRecord[]`; `exportCsv(filter): string`; `reset(): void`.
  - Outputs: `UsageRecord`, `CostEstimate`, aggregates.
  - Events emitted: `usage:recorded`, `usage:session-updated`.
- **Internal state**: in-memory current-session aggregate; reference to PricingTable; ring buffer index for the 30-day window.
- **Dependencies**: PricingTable (config), localStorage (history persistence), tokenizer (estimation).
- **Error states**: `PricingUnknown(model)` (cost shown as "—" / estimated-from-default with a flag — Risk R4), `StorageQuotaExceeded` (evict oldest, warn — Risk R7), `MissingUsageFromProvider` (fall back to estimated tokens, flag record `estimated:true`).

---

## 2.7 `ContextBuilder`

- **Responsibility**: Assemble the exact payload (system prompt, workbook manifest, sheet context, trimmed history, tool specs) for each LLM call within the token budget.
- **Public interface**
  - Inputs: `build(session, scope): Promise<LLMRequest>`; `estimateInputTokens(draft): number`; `setContextLimits(limits): void`.
  - Outputs: `LLMRequest` (normalized), token estimate.
  - Events emitted: `context:truncated` (when history/sheet context is trimmed, for UI transparency).
- **Internal state**: context-limit config (max sheet cells to inline, history token cap, manifest verbosity), system-prompt template.
- **Dependencies**: WorkbookRegistry (manifest), ToolExecutor (read-only sheet reads), tokenizer, store (conversation history), ProviderConfig (model context window).
- **Error states**: `ContextOverflow` (even after trimming, minimum payload exceeds window → surface actionable error, suggest smaller scope/model — Risk R10); `SheetReadFailed` (degrade to manifest-only context with a note).

---

## 2.8 `SnapshotManager`

- **Responsibility**: Capture pre-write state of affected ranges/objects before any mutating tool and provide one-click undo.
- **Public interface**
  - Inputs: `capture(workbook_id, sheet, target): Promise<SnapshotEntry>`; `undo(snapshotId): Promise<void>`; `list(sessionId): SnapshotEntry[]`; `prune(policy): void`.
  - Outputs: `SnapshotEntry`, undo result.
  - Events emitted: `snapshot:captured`, `snapshot:restored`, `snapshot:pruned`.
- **Internal state**: in-session snapshot stack; index in localStorage; large payloads in IndexedDB.
- **Dependencies**: ToolExecutor/Office.js (read for capture, write for restore), storage.
- **Error states**: `CaptureFailed` (block the write — no snapshot, no write, unless user overrides), `RestoreFailed` (range moved/deleted → partial restore + warning), `StructuralUndoLimited` (charts/pivots: undo = delete-created or restore-definition, not full fidelity — Risk R6).

---

## 2.9 Task pane UI components

### 2.9.1 `ChatPanel`
- **Responsibility**: Render the conversation (user/assistant/tool-call/tool-result/confirmation messages), the input area with live cost estimate, and send/stop controls.
- **Interface**: props from store (messages, session status, estimate); emits `send(text)`, `stop()`, `undo(snapshotId)`, `retry()`.
- **Internal state**: input draft, scroll/auto-follow flag, expanded/collapsed tool-detail toggles.
- **Dependencies**: store, ContextBuilder.estimate (via store selector).
- **Error states**: renders error bubbles for `run:error`; disabled/stop affordance while loop is mid-iteration; empty state when no messages.

### 2.9.2 `SettingsPanel`
- **Responsibility**: Configure providers — selection, model (dynamic + manual fallback), API key, OAuth sign-in/out, base URL override, context controls, connection test.
- **Interface**: props from ProviderConfig + AuthState; emits `selectProvider`, `setModel`, `setApiKey`, `oauthSignIn/Out`, `setBaseUrl`, `setContextLimits`, `testConnection`.
- **Internal state**: form drafts, masked-key reveal toggle, in-flight test status.
- **Dependencies**: AuthManager, UsageTracker (limits), store.
- **Error states**: inline validation, connection-test failure banner, OAuth error surfaced from AuthManager.

### 2.9.3 `ConfirmationModal`
- **Responsibility**: Present the per-cell before/after diff for a pending write (labelled workbook + sheet) and capture apply/cancel; stronger warning variant for charts/pivots.
- **Interface**: props = `{pendingChange, diff, severity}`; emits `apply()`, `cancel()`, `applyAllThisTurn()` [D6].
- **Internal state**: scroll position in large diffs, "don't ask again this session" toggle.
- **Dependencies**: store (pending change from ToolExecutor gate).
- **Error states**: if diff computation failed, falls back to "cannot preview — proceed with caution" warning variant; blocks Apply if snapshot capture failed.

### 2.9.4 `UsageDashboard`
- **Responsibility**: Show usage totals (today/week/month/all-time), per-provider/model breakdown, session list, CSV export, and history reset.
- **Interface**: props = aggregates from UsageTracker.query; emits `exportCsv(filter)`, `resetHistory()`, `selectSession()`.
- **Internal state**: active filter/time range, sort order.
- **Dependencies**: UsageTracker, PricingTable.
- **Error states**: empty state (no usage yet); "pricing unknown" flags on rows; quota-warning banner.

### 2.9.5 Footer (cross-cutting)
- **Responsibility**: Persistently show current-session token count and estimated cost.
- **Interface**: props from session totals selector.
- **Internal state**: none.
- **Dependencies**: UsageTracker session totals.
- **Error states**: shows "—" cost when pricing unknown.

### 2.9.6 WorkbookSwitcher (cross-cutting)
- **Responsibility**: List open workbooks with an active indicator and let the user scope the session to one.
- **Interface**: props = manifest + active id; emits `setActive(workbook_id)`.
- **Internal state**: none.
- **Dependencies**: WorkbookRegistry.
- **Error states**: single-workbook degrade notice; stale-handle warning when active workbook closed mid-session.
