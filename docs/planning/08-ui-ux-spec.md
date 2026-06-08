# Document 8 — UI/UX Specification

Built with Fluent UI React v9. Layout target: a narrow vertical task pane (~320–450 px wide). Primary navigation is a top tab/segmented control: **Chat · Usage · Settings**, with a persistent **Footer** and a **WorkbookSwitcher** strip below the header.

```
┌─────────────────────────────────────┐
│ Header: [Chat][Usage][Settings]  ⚙  │
├─────────────────────────────────────┤
│ WorkbookSwitcher: ▸Budget.xlsx ●  ▾ │
├─────────────────────────────────────┤
│                                     │
│        Active surface (Chat /        │
│        Usage / Settings)             │
│                                     │
├─────────────────────────────────────┤
│ Footer: ◷ 12.4k tok · ~$0.031        │
└─────────────────────────────────────┘
```

## 8.1 ChatPanel

**Layout**: scrollable message list (grows upward, auto-follows newest unless user scrolled up) + bottom input area.

**Message types & rendering:**
| Type | Rendering |
|------|-----------|
| User | right-aligned bubble, plain text |
| Assistant | left-aligned, markdown, streams token-by-token; shows model badge |
| Tool call | collapsible chip: `🔧 write_range → Budget.xlsx!Sheet1!B14` with status dot (pending/applied/failed); expand to see args JSON |
| Tool result | nested under its call; success shows compact summary, error shows red detail |
| Confirmation request | inline marker that a modal is/was shown; records the decision |
| System notice | muted banner (truncation, workbook changed, iteration cap) |

**Input area:**
- Multiline textbox (Enter=send, Shift+Enter=newline).
- **Pre-execution cost estimate** chip next to Send: `~$0.004 / step` (Doc 7 §7.5), updates as the user types (debounced).
- **Send** button (primary) ⇄ **Stop** button (appears while loop runs, wired to AbortController).
- Per-message **Undo** affordance appears on applied-write tool results (calls SnapshotManager.undo).

**States:**
- *Empty*: welcome + 2–3 example prompts ("Sum B2:B13 into B14", "Make a bar chart of A1:B12").
- *Mid-iteration*: input disabled or send replaced by Stop; a thinking indicator ("Calling gpt-4o… step 3") with the current state from the loop machine; tool chips appear live.
- *Awaiting confirmation*: ConfirmationModal overlays; chat shows the pending change inline; the rest of input stays disabled.
- *Error*: red bubble with the typed error + action button (Retry / Re-auth / Open settings).
- *Loading models / no provider ready*: blocking banner with CTA to Settings.

## 8.2 SettingsPanel

**Sections (per active provider + provider switcher):**
1. **Provider selector** — segmented/dropdown: Ollama · OpenAI · Anthropic · Generic. Active provider highlighted; readiness badge (green/amber/red).
2. **Model selector** — dropdown populated by `listModels()`; **manual entry fallback** (free-text) when listing is unsupported or fails (Ollama custom, Generic). "Refresh models" button.
3. **Auth**:
   - API-key input (masked, reveal toggle, shows `sk-…1234` after save).
   - OAuth **Sign in / Sign out** button (only for providers where `capabilities.supportsOAuth`), with state label.
4. **Base URL override** — text field (Generic required; others optional). Validation on blur.
5. **Extra headers** (Generic) — key/value rows.
6. **Context controls** — `maxContextTokens`, `historyTokenCap`, `maxInlineSheetCells`, `maxOutputTokens`, `temperature`.
7. **Connection test** — button runs `testConnection`; shows spinner → ✓ valid / ✗ error detail.
8. **Pricing** (optional [D7]) — view/edit per-model rates; shows `updatedAt`.
9. **Safety** — "Auto-approve writes this session" toggle (default off), "Always elevate charts/pivots" (default on).

**States:** unsaved-changes indicator; invalid field inline errors; OAuth in-progress (dialog open) lock; test-in-flight.

## 8.3 ConfirmationModal

**Layout** (Fluent Dialog, blocking):
- **Header**: "Confirm change" + severity. Labels: **Workbook: Budget.xlsx · Sheet: Sheet1**.
- **Body**: per-cell diff table:
  | Cell | Before | After |
  |------|--------|-------|
  | B14 | (empty) | =SUM(B2:B13) |
  - Long diffs scroll; counts summarized ("+ 240 more cells"); format-only changes show a format chip diff.
- **Elevated variant** (charts/pivots/sheet-delete/large writes): amber/red banner — "This creates/deletes a {chart|pivot table|sheet} and cannot be fully undone (structural undo only)." Different button emphasis; requires an explicit checkbox for destructive deletes.
- **Footer buttons**: **Apply** (primary) · **Cancel**. Optional **Apply all this turn** [D6]. "Don't ask again this session" checkbox (maps to auto-approve).

**States:** diff-unavailable fallback ("cannot preview — proceed with caution"); snapshot-failed → Apply disabled with explanation + override option.

## 8.4 UsageDashboard

**Layout:**
- **Time-range selector**: Today · Week · Month · All-time.
- **Totals cards**: total cost, total tokens, turns, sessions for the range.
- **Breakdowns**: by provider (table), by model (table), by day (simple bar/sparkline).
- **Session list**: rows of `{startTime, model, turns, tokens, cost}`; click → filters/scrolls to that session's records.
- **Estimated flag**: rows using estimated tokens or default pricing are badged.
- **Actions**: **Export CSV** (range-filtered), **Reset history** (confirm dialog).

**States:** empty ("No usage yet — start a chat"); quota-warning banner (Risk R7); pricing-unknown badges.

## 8.5 Footer (persistent)

- Always visible across tabs: **session token count** (`◷ 12.4k`) and **estimated session cost** (`~$0.031`).
- During a run: live-updates per turn; shows a small budget gauge (used/window) when near the limit.
- Cost shows `—` when pricing unknown for the active model.

## 8.6 WorkbookSwitcher

- Horizontal strip under the header listing open workbooks; active one marked with ● and highlighted.
- Click a workbook → `setActive` (re-scopes the session); a toast confirms the new scope.
- **Single-workbook degrade** [D8]: if multi-workbook is unsupported, shows only the host workbook with a small info "(multi-workbook unavailable in this Excel build)".
- **Stale handle**: if the active workbook closes mid-session, shows a warning and auto-rescopes to the host workbook, with a system notice in chat (Risk R5).

## 8.7 Cross-cutting states

| State | Behavior |
|-------|----------|
| Loading | Fluent Spinner with a contextual label; never a blank pane. |
| Error | Inline message bars (non-blocking) for recoverable; blocking banner only for "active provider not ready" / connectivity self-test failure. |
| Empty | Each surface has a purposeful empty state with a next action. |
| Mid-iteration | Inputs that would mutate state (provider switch, workbook re-scope, send) are disabled or guarded with "a run is in progress — stop it first?"; Stop is always available. |
| Offline / provider down | Detected by connectivity self-test and failed calls; banner with retry; Ollama-down shows "start Ollama" hint. |
| First-run | Onboarding card pointing to Settings to pick a provider + enter key. |

## 8.8 Behavior while the agent loop is mid-iteration

- The active loop state (`CALLING_LLM`, `EXECUTING_TOOL`, `AWAITING_CONFIRMATION`, …) is reflected as a status line in ChatPanel.
- Streaming assistant text renders incrementally; tool chips appear as calls are parsed and update status as they execute.
- The only user actions allowed mid-run are **Stop**, **scroll**, expanding chips, and (when prompted) the **ConfirmationModal** decision. Provider/model/workbook changes are blocked until the run ends or is stopped (prevents mid-run scope drift — Risk R5).
- On Stop: the AbortController cancels the in-flight LLM call; any in-progress tool finishes or rolls back via snapshot; session → STOPPED with a notice; partial usage is still recorded.
