# Document 12 — OpenClaw Bridge Spec (delegation tool)

Optional integration with a locally-running [OpenClaw](https://openclaw.ai) gateway: a `delegate_web_task` tool that hands a research task to the user's OpenClaw agent (which has a real browser, web tools, and skills, all running in Node where CORS does not apply) and returns its final answer for SheetClaw to work into the workbook.

Relationship to Doc 11: this complements `web_search`/`fetch_url`, it does not replace them. Direct fetch stays the cheap path for CORS-friendly URLs; delegation is for multi-step research and CORS-blocked sources. Doc 11's open question 2 (reader fallback privacy) gains a future third option — OpenClaw as a local reader — recorded here as out of scope for v1 (§12.9).

## 12.1 Goals and non-goals

**Goals**
- G1. A `delegate_web_task` tool the model can call when direct web access is insufficient (blocked hosts, multi-page research, tasks needing skills).
- G2. AppSource-safe by construction: invisible and inert until the user configures it; zero marketplace-visible surface change (§12.2).
- G3. Same mechanical guardrails as Doc 11: bounded results, classified errors, no fabrication, single code path.

**Non-goals (v1)**
- No bundling, installing, or auto-discovering OpenClaw. No network calls to any gateway until the user has explicitly configured one *and* the tool is invoked.
- No OpenClaw-as-reader-fallback for `fetch_url` (future, §12.9).
- No remote gateways: loopback addresses only (§12.3 B2).
- No SheetClaw-side orchestration of OpenClaw internals (skill selection, tool choice) — the task prompt is the whole interface.

## 12.2 AppSource acceptance constraints (governing requirement)

The add-in must remain certifiable with this feature present. These mirror the already-established Ollama-on-localhost pattern:

- **A1 — Inert by default.** No OpenClaw UI hints in Chat, no gateway traffic, no tool exposure until a gateway URL + token are saved in Settings. A validator who never opens the section never encounters the feature.
- **A2 — Core functionality independent.** Everything in the listing description works with only a cloud LLM key (or local Ollama). Delegation is an optional power-user capability and is never required to complete any advertised flow.
- **A3 — Disclosure.** `public/privacy.html` gains a sentence: when the user enables the bridge, task text (which may include workbook-derived content) is sent to the user's own locally-running OpenClaw instance, which may access the web on their behalf. Ships in the same PR as the feature.
- **A4 — Validation notes.** The submission's testing notes state: "Optional integrations with locally-installed software (Ollama, SearXNG, OpenClaw) are off by default and clearly labeled; all core functionality is testable with a cloud API key." Keep listing copy focused on the core BYOK flows.
- **A5 — No suspicious behavior.** No port scanning, no automatic localhost probing on startup, no background connections. The Settings "Test connection" button is the only unprompted gateway call, and it is user-initiated.

## 12.3 Hard constraints

- **B1 — API instability.** OpenClaw is pre-1.0 and moves fast; every endpoint, port, auth, and payload detail in this document is a placeholder until the Phase 0 spike (§12.4) pins it against the user's installed version. Do not write feature code from memory of OpenClaw's API.
- **B2 — Loopback only.** The gateway URL must validate to `127.0.0.1`, `::1`, or `localhost`. This is the inverse of `fetch_url`'s SSRF guard and intentional: the privacy story is "nothing leaves your machine except what your own agent fetches." Remote/tailnet gateways are a future opt-in with their own disclosure.
- **B3 — Restricted agent profile.** Delegated tasks ingest adversarial web content into an agent that may have shell/file tools. The Settings section must (a) instruct the user to point the bridge at a dedicated OpenClaw agent/profile with browse-only tools, and (b) show a persistent caution note. SheetClaw cannot enforce the profile's tool list, but the spec requires the UI to say so plainly. Returned answers are treated as untrusted data (same as `fetch_url` results); the existing write-confirmation gate remains the integrity boundary for the workbook.
- **B4 — Context budget.** The returned answer is capped (default 16 000 chars, `max_chars` param clamped 1 000–20 000, clean-boundary truncation reused from `fetch.ts`) with `truncated` flagged. A delegation can do unbounded work; its *transcript footprint* cannot.
- **B5 — Genericity (Doc 11 C4).** The gateway is configured by the user; the only OpenClaw-related literals in `src/` are the Settings defaults and labels. No task templates, no domain-specific prompt fragments.
- **B6 — Cost honesty.** Delegated runs consume the user's OpenClaw model/key outside SheetClaw's usage tracker. The tool result includes `costNote: 'Executed by OpenClaw on its own model; not included in SheetClaw usage totals.'` once per session in the transcript meta row, and the Settings section says the same.

## 12.4 Phase 0 — gateway verification spike (gate for everything else)

Run against the user's actual OpenClaw install, from a sideloaded taskpane. Record results in Appendix A.

| Check | Record |
|---|---|
| OpenClaw version (`openclaw --version` or equivalent) | version string |
| Invocation surface: HTTP webhook/REST vs WebSocket control protocol | chosen surface + why |
| Reachability from the taskpane webview (https origin → `http://127.0.0.1:<port>` fetch or `ws://127.0.0.1:<port>`) | pass/fail; note that WS is exempt from CORS preflight if plain fetch fails |
| CORS headers on HTTP endpoints (if HTTP chosen) | pass/fail |
| Auth mechanism (token header/query/first-frame) and where the token lives in OpenClaw config | mechanism |
| Submit a prompt to a *specific agent/profile* and correlate the final answer (run id? blocking response? event stream?) | request/response shapes |
| Mid-run cancellation support | yes/no + mechanism |
| Typical end-to-end latency for a one-page research task | seconds |

**Gate:** a prompt can be submitted and its final answer retrieved, with correlation, from the taskpane. If only the WS surface works, the client in §12.5 is a WS client; the tool contract is unchanged.

## 12.5 Architecture

```
src/bridge/
  openclaw-client.ts   # transport: connect, authenticate, submit task, await result, cancel.
                       # Shape decided by Phase 0 (HTTP or WS). Timeout + abort built in.
  delegate.ts          # delegate_web_task ToolSpec + handler (caps, error classification)
```

- **Config:** `AppConfig.openclaw: { gatewayUrl: string; agentId?: string }` (persisted; absent = unconfigured). Token via the `AuthState` pattern under ref `openclaw:gateway`, stored like LLM/search keys.
- **Gating:** the tool spec is included only when the Search toggle is ON (it remains the single gate for all external-data egress, Doc 11 §11.4) **and** the bridge is configured (gateway URL + token saved). Unconfigured = the model never sees the tool.
- **Errors:** reuse `ToolNetworkError → 'NetworkError'`. Classified messages: gateway unreachable ("OpenClaw gateway is not reachable at <url>. It may not be running — do not retry; tell the user."), auth rejected, run timeout (with elapsed), run failed (gateway-reported error passed through, capped).
- **Cancellation:** SheetClaw's Stop button aborts the wait and (if Phase 0 found a mechanism) cancels the gateway run; otherwise abandons it with a transcript note.

### Tool schema — `delegate_web_task` (runtime: none)

**Description (LLM-facing):** "Delegate a self-contained web research task to the user's local OpenClaw agent, which can browse the web without CORS limits and use its installed skills. Use when fetch_url is blocked or the task needs multi-step browsing. State the task precisely and say what format you want back. Slower and costlier than fetch_url — do not use it for URLs that fetch_url can read."

| Param | T | R | Constraints |
|---|---|---|---|
| task | string | ✓ | non-empty, ≤ 2 000 chars; self-contained (OpenClaw has no workbook context) |
| expected_format | string | ✗ | `"markdown"` (default) \| `"json"` \| `"csv"` — appended to the task as a format request, not enforced |
| max_chars | number | ✗ | clamp 1 000–20 000, default 16 000 |

**Returns:** `{ status: 'ok', answer, returnedChars, truncated, elapsedMs, agentId?, costNote? }`
**Errors:** `ValidationError` (bad args, bridge unconfigured — should be unreachable given gating), `NetworkError` (classified per §12.5). Timeout default 180 s.
**Hard rule:** the answer is returned verbatim (capped) — never parsed for instructions, never merged with other results, never retried with a rewritten task without a new model turn.

### System-prompt addition (generic, only when the tool is exposed)

- "Prefer fetch_url for direct reads. Delegate to OpenClaw only when a source is CORS-blocked or the task needs multi-step browsing. Scope-clarify with request_user_choice *before* delegating broad tasks — a delegation is slow and runs on the user's other agent."

## 12.6 UI spec

- **Settings → Search tab, new "OpenClaw (local agent)" section** below a divider: Gateway URL field (placeholder `http://127.0.0.1:<port>` with the real default port recorded in Phase 0), token field (masked, Save/Clear, stored like other keys), optional Agent profile id field, **Test connection** button (user-initiated only, per A5), and the B3 caution note: "Point this at a dedicated OpenClaw agent with browse-only tools. Delegated tasks send text to that agent and its model."
- **Chat:** no new chrome. Delegations appear as the existing `Tool:`/`OK|ERR` meta rows; the running state shows elapsed seconds since delegations are slow. Stop aborts the wait.
- Clearing the token or URL de-configures the bridge; the tool disappears from the next run's specs.

## 12.7 Testing & acceptance criteria

| # | Criterion | Type |
|---|---|---|
| D-1 | Unconfigured bridge → tool spec absent from LLM request even with Search toggle ON; zero gateway traffic in app lifecycle (mock asserts no calls) | unit |
| D-2 | Configured + toggle ON → tool spec present; toggle OFF → absent | unit |
| D-3 | Gateway URL validation rejects non-loopback hosts with `ValidationError` before any request | unit |
| D-4 | Answer > `max_chars` → truncated at clean boundary, `truncated: true` | unit |
| D-5 | Unreachable gateway → fast `NetworkError` naming the URL with do-not-retry guidance; no retry loop | unit |
| D-6 | Timeout → `NetworkError` with elapsed time; abort signal cancels the wait | unit |
| D-7 | Genericity guard passes (no new undeclared hostnames; loopback defaults only) | static |
| D-8 | Manual: a delegated research task on a CORS-blocked source (e.g. a Wikipedia article list) round-trips into a confirmed `write_range`, with the restricted profile configured | manual |
| D-9 | Manual AppSource dry-run: with the bridge unconfigured, every Doc 11 AC-11 scenario still passes untouched | manual |

## 12.8 Build sequencing

| Phase | Scope | Gate |
|---|---|---|
| 0 | §12.4 spike against the user's OpenClaw install; fill Appendix A | prompt→answer round-trip verified from taskpane |
| 1 | `openclaw-client.ts` + `delegate.ts` + caps/errors; D-1..D-7 | tests green |
| 2 | Settings section + key storage + Test connection | tests green |
| 3 | System-prompt rule; privacy.html sentence; validation-notes text added to the AppSource submission checklist; D-8/D-9 | manual pass |

## 12.9 Future options (recorded, not committed)

1. **OpenClaw as reader fallback** — route CORS-blocked `fetch_url`s through a minimal OpenClaw skill returning markdown; would resolve Doc 11 open question 2 without jina. Requires a stable single-action invocation surface (assess during Phase 0).
2. **Remote gateways** (tailnet/LAN) — needs its own disclosure language and B2 relaxation; postponed.
3. **Structured handback** — a SheetClaw-specific OpenClaw skill that returns typed JSON tables instead of prose, tightening the write path.

## Appendix A — Phase 0 results

*(to be filled during the spike; include OpenClaw version, chosen surface, endpoint shapes, auth, latency)*
