# Document 6 — Agentic Loop Specification

## 6.1 Single-run state machine

States: `IDLE`, `BUILDING_CONTEXT`, `CALLING_LLM`, `STREAMING`, `PARSING_TOOLCALLS`, `EXECUTING_TOOL`, `AWAITING_CONFIRMATION`, `FEEDING_RESULT`, `ERROR`, `DONE`, `STOPPED`.

```
IDLE
 │ start(instruction, scope)
 ▼
BUILDING_CONTEXT ──(ContextOverflow)──► ERROR
 │ request ready
 ▼
CALLING_LLM ──(auth/network/rate-limit)──► ERROR(retryable?)
 │ stream opens
 ▼
STREAMING  ◄───────────────┐
 │ stream complete         │ deltas
 ▼                         │
PARSING_TOOLCALLS          │
 │                         │
 ├─ no tool calls ─────────┼──► DONE (surface assistant text)
 │                         │
 └─ has tool calls         │
     │ for each call       │
     ▼                     │
   (mutating?) ── no ──► EXECUTING_TOOL ──► FEEDING_RESULT ──► CALLING_LLM
     │ yes                                                         ▲
     ▼                                                             │
   capture snapshot ─(CaptureFailed)─► ERROR                       │
     │                                                             │
     ▼                                                             │
   AWAITING_CONFIRMATION                                           │
     │ apply        │ cancel                                       │
     ▼              ▼                                              │
   EXECUTING_TOOL   FEEDING_RESULT(cancelled result) ─────────────┘
     │ ok │ OfficeApiError
     ▼    ▼
   FEEDING_RESULT (ok | error result) ──────────────────────────► CALLING_LLM

any state: stop() ──► STOPPED ;  maxIterations reached ──► DONE(with notice)
ERROR ── retry ──► (re-enter failed state) | abort ──► STOPPED
```

### Exit conditions
1. **Natural completion** — model returns assistant text with no tool calls (`finishReason: stop`).
2. **Max iterations** — `iteration >= maxIterations` (default 25) → DONE with a "stopped at iteration cap" system notice.
3. **User stop** — AbortController fires → STOPPED.
4. **Unrecoverable error** — ERROR with no viable retry → STOPPED.
5. **Token budget exhausted** beyond compaction floor → DONE with notice (§6.8).

## 6.2 Context assembly (before each LLM call)

ContextBuilder produces the request in this order:

1. **System prompt** (template):
   - Role & objective (agent that edits Excel via tools).
   - Hard rules: always read before writing; never fabricate cell addresses; one logical change per write where practical; respect the active workbook scope; writes require user confirmation (don't promise a write is done before the tool result returns).
   - Output expectations: explain intended change briefly before calling a mutating tool.
   - Capability notes: available tools are provided separately; do not invent tools.
2. **Workbook manifest** — from WorkbookRegistry: active workbook id+name, list of open workbooks (id, name), and for the active workbook each sheet's name + used-range dims. Compact JSON.
3. **Active sheet context** — for the active workbook's active sheet: used-range address, header row sample, current selection, and a bounded sample of values (capped at `maxInlineSheetCells`). Larger reads are left to the `read_range` tool.
4. **Conversation history** — prior messages, trimmed to `historyTokenCap` (oldest user/assistant pairs dropped first; tool results summarized/dropped before user text — §6.8).
5. **Tool definitions** — serialized per provider by the adapter (Doc 4 §4.6).

`estimateInputTokens()` runs the same assembly (sans live sheet read where cached) to drive the pre-execution cost estimate in ChatPanel.

## 6.3 Tool-call parsing (provider-normalized)

The adapter emits normalized `LLMStreamEvent`s; AgentLoop consumes only those. Parsing rules inside adapters:

- **OpenAI/Generic/Ollama**: accumulate `choices[].delta.tool_calls[]` by `index`; each has `id`, `function.name`, and `function.arguments` streamed as string fragments. On stream end, `JSON.parse` the concatenated arguments per call. Parse failure → `MalformedResponseError` for that call.
- **Anthropic**: read `content_block_start{type:tool_use, id, name}`, accumulate `input_json_delta.partial_json`, finalize on `content_block_stop`; the assembled JSON is the `input` object.
- **Ollama non-tool models**: some emit a tool call as plain text/JSON in the assistant content. A **lenient fallback parser** scans assistant text for a fenced JSON tool-call object matching a known tool name; if found, it is promoted to a tool call. If ambiguous, the loop asks the model to re-emit using the tool interface (one repair attempt).

Each normalized tool call is validated against the tool's JSON Schema (ToolExecutor). Invalid args do **not** crash the run — they become an error `ToolResult` fed back so the model can self-correct (§6.7).

## 6.4 Feeding tool results back

- Append a `ToolResultMessage` to history with `toolCallId` and the `ToolResult`.
- Adapter serialization on the next call:
  - OpenAI/Generic/Ollama → `{role:"tool", tool_call_id, content: JSON.stringify(result.ok ? result.data : result.error)}`.
  - Anthropic → user message with `{type:"tool_result", tool_use_id, content, is_error: !result.ok}`.
- Results are size-bounded: large `read_range` payloads are truncated with a marker (`"…N more rows"`) and the model is told the full size, to protect the context budget.

## 6.5 Continue vs. surface

- **Continue (loop)** when the latest assistant turn contains ≥1 tool call and none are terminal-blocking. After executing all calls in a turn (sequentially, to serialize Office.js), feed all results back and call the LLM again.
- **Surface to user** when: no tool calls in the latest turn; or a confirmation is pending (UI surfaces the modal but the *run* is paused, not ended); or an exit condition (§6.1) is met.
- **Parallel tool calls in one turn** are supported at the model level but **executed sequentially** by ToolExecutor (Office.js requires serialized `Excel.run`). Mutating calls in a multi-call turn each pass through the confirmation gate in order [D6].

## 6.6 Confirmation gate — exactly when and how

- The gate triggers in `EXECUTING_TOOL` **only for tools flagged `mutating`** (Doc 4 🔒), and only **after** SnapshotManager has captured the pre-state and ToolExecutor has computed the diff.
- Sequence: `tool:requires-confirmation` event → store sets `session.pendingChange` and `status=AWAITING_CONFIRMATION` → ConfirmationModal renders the labelled diff → user `apply | cancel | applyAllThisTurn` [D6].
  - **apply** → perform the write, emit `tool:applied`, FEEDING_RESULT with success.
  - **cancel** → no write; FEEDING_RESULT with `{ok:false, error:{code:'PermissionDenied', message:'User cancelled the write'}}` so the model can revise or stop.
  - **applyAllThisTurn** (optional [D6]) → applies remaining mutating calls in the current turn without re-prompting (still snapshotted). Session-scoped "auto-approve" toggle behaves the same across turns until cleared.
- **Severity**: chart/pivot/sheet-delete/large-range diffs render the **elevated** warning variant.
- The model is never told a write succeeded until the actual `tool:applied` result is fed back, preventing premature "done" claims.

## 6.7 Error handling matrix

| Failure | Detection | Loop behavior |
|---------|-----------|---------------|
| Malformed tool call (bad/partial JSON) | adapter parse / schema validate | Return error `ToolResult` to model with the parse error; allow **1 repair iteration**; if still bad, surface error + stop. |
| Unknown tool name | validate against registry | Error result "unknown tool", list valid tools; model retries. |
| Invalid args (schema) | ToolExecutor validate | Error result with validation detail; model corrects. |
| Office.js throws | `Excel.run` catch | Map to `OfficeApiError` result, feed back (model may adapt) unless fatal host error → ERROR. Snapshot rolled back if write partially applied. |
| Snapshot capture fails | SnapshotManager | **Block the write**; offer user override in modal; otherwise cancelled result. |
| Provider rate limit (429) | adapter | `RateLimitError(retryAfter)`; exponential backoff with jitter, max N retries; surface countdown in UI; respect `Retry-After`. |
| Network failure | fetch reject | `NetworkError`; retry with backoff (max N); then ERROR with retry button. |
| Auth 401 / token expired | adapter | Trigger AuthManager refresh; if fail → pause run, surface re-auth; resume after re-auth. |
| Context overflow | ContextBuilder | Run compaction (§6.8); if still over → ERROR with actionable message (reduce scope / switch model). |
| Max iterations | loop counter | DONE with notice; offer "continue" to extend the cap. |

All retries are bounded and visible; nothing retries silently forever. Each ERROR carries a typed code and a user-facing action (retry / re-auth / edit settings / stop).

## 6.8 Token budget management

- **Budget window** = `ProviderConfig.contextLimits.maxContextTokens` minus a reserve for `maxOutputTokens`.
- Before each call, ContextBuilder estimates the assembled request size. If over budget, it compacts in this order:
  1. Truncate large tool-result payloads in history to summaries (keep addresses + dims, drop bulk values).
  2. Drop oldest tool-call/tool-result pairs (keep their existence as a one-line note).
  3. Drop oldest user/assistant exchanges, preserving the original instruction and the last K turns.
  4. Reduce inline sheet sample (`maxInlineSheetCells`) — rely on `read_range` instead.
  5. Emit `context:truncated` → a `SystemNoticeMessage` so the user sees what was dropped.
- **Floor**: system prompt + tool defs + original instruction + last turn. If the floor exceeds the window → `ContextOverflow` ERROR (suggest a larger-context model or smaller scope — Risk R10).
- **Long-session strategy**: maintain a running, model-generated **session summary** (optional enhancement) that replaces dropped history, regenerated every M turns, to preserve continuity cheaply.
- UsageTracker's per-turn counts feed a live budget gauge in the Footer so the user sees headroom shrinking.
