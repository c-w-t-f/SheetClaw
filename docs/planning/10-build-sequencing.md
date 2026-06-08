# Document 10 — Build Sequencing and Dependency Map

Complexity scale: trivial / low / medium / high / very high. Phases are ordered; **go/no-go gates** (G#) must pass before dependent phases start.

## 10.1 Ordered build sequence

### Phase 0 — Spikes & decisions (de-risk before committing)
- **0.1** Confirm Office.js multi-workbook capability on target Excel build → resolves [D8] scope. *(low)*
- **0.2** Confirm OpenAI consumer OAuth/PKCE availability → resolves [D4]; if no, OAuth = OpenRouter-style only. *(low)*
- **0.3** Confirm Anthropic direct-browser header + OpenAI/Generic browser CORS reach → resolves whether a sidecar is needed for chat [D1]. *(low)*
- **0.4** Confirm pivot API maturity on target build → resolves [D5]. *(medium)*
- **Produces:** decision resolutions D1/D4/D5/D8 (partial), spike notes.
- **Verify:** each spike has a written yes/no with evidence.
- **Primary refs:** Docs 1, 4, 5.

### Phase 1 — Project scaffold + HTTPS + connectivity self-test
- Office Add-in (React+TS) scaffold; manifest for shared-folder sideload; `office-addin-dev-certs` trusted cert; loopback exemption; **startup self-test** (cert trust, localhost reach, Ollama reach).
- **Produces:** loadable empty task pane over HTTPS, self-test surface. **Depends:** Phase 0.
- **Verify (Gate G0):** pane sideloads in Excel, self-test green; reproduce on a clean reload. Covers Risks R8, R9.
- **Complexity:** medium. **Refs:** Doc 1 §1.2/1.5.

### Phase 2 — Core types, store, LLMClient interface + first adapter
- Define all data models (Doc 3); set up Zustand store [D2]; implement `LLMClient` interface, normalized `LLMStreamEvent`, and the **OpenAI/Generic adapter** (streaming, tool serialization, usage extraction).
- **Produces:** a callable provider with streamed text. **Depends:** Phase 1.
- **Verify:** unit tests parse recorded OpenAI SSE fixtures into normalized events incl. fragmented tool-call reassembly. Covers R13.
- **Complexity:** high. **Refs:** Docs 2, 3, 4 §4.6, 7 §7.2.

### Phase 3 — Anthropic + Ollama adapters + **tool-calling harness**
- Implement Anthropic adapter (tool_use blocks, tool_result feedback, system param, usage) and Ollama adapter (incl. lenient fallback parser); build a **tool-calling harness** that issues a fixed tool-call test against each configured provider/model and verifies a correct normalized call + result round-trip.
- **Produces:** all four providers behind one interface; harness report per model. **Depends:** Phase 2.
- **Verify (Gate G1 — tool-calling harness test):** each provider returns a well-formed tool call for a canonical prompt; Anthropic↔OpenAI normalization conformance passes. **No-go** for any model that fails → mark it non-tool-capable. Covers R1, R2, R13.
- **Complexity:** high. **Refs:** Doc 4, Doc 6 §6.3–6.4.

### Phase 4 — WorkbookRegistry + ToolExecutor + read-only tools
- Registry (enumerate/scope/resolve, degrade [D8]); ToolExecutor (validate, serialize Office.js access, error mapping); implement **read tools** (`read_range`, `list_sheets`, `get_sheet_context`, `list_workbooks`, selection, charts/pivots list).
- **Produces:** the agent can observe workbooks. **Depends:** Phase 1 (Office), Phase 3 (tool specs).
- **Verify:** each read tool returns correct shapes against a fixture workbook; wrong-workbook resolution rejected. Covers R5, R15.
- **Complexity:** high. **Refs:** Docs 2 §2.3/2.4, 4 §4.1–4.4.

### Phase 5 — AgentLoop + ContextBuilder + SnapshotManager + write tools + confirmation gate
- Implement the loop state machine (Doc 6), ContextBuilder (assembly + budget ladder), SnapshotManager (capture/undo, IndexedDB spill), **mutating tools** (`write_range`, `clear`, `format`, sheet ops) with the **confirmation gate** + per-cell diff + undo.
- **Produces:** end-to-end agentic read→write→confirm→undo for ranges/sheets. **Depends:** Phases 3, 4.
- **Verify:** the Doc 1 §1.3 scenario works end to end; cancel and undo both restore state; budget compaction triggers on a long session. Covers R5, R10, R11, R14, R15.
- **Complexity:** very high. **Refs:** Docs 6, 2 §2.2/2.7/2.8, 4.

### Phase 6 — UsageTracker + pricing + dashboard + footer
- Per-turn recording, cost formula, pricing table [D7], 30-day rolling buckets + quota guard, dashboard queries, CSV export, footer + pre-execution estimate.
- **Produces:** full usage/cost visibility. **Depends:** Phase 2 (usage events), Phase 5 (real runs).
- **Verify:** token counts match provider reports; eviction works at quota; CSV opens in Excel; estimate within tolerance. Covers R4, R7.
- **Complexity:** medium. **Refs:** Docs 7, 3 §3.2, 8 §8.4–8.5.

### Phase 7 — Chart & pivot tools
- Chart create/modify/delete/set-data with allow-list + elevated confirmation; pivot MVP subset [D5] with capability gating; coarse structural undo.
- **Produces:** visualization/pivot editing. **Depends:** Phase 5.
- **Verify:** charts created/modified on target build; unsupported props return `Unsupported` cleanly; pivot MVP works or degrades gracefully. Covers R6, R14.
- **Complexity:** high. **Refs:** Doc 4 §4.4–4.5.

### Phase 8 — Auth hardening: OAuth/PKCE (+ optional sidecar) and secret storage
- AuthManager state machine, API-key flow (done minimally earlier for chat), OAuth/PKCE via Office Dialog API; **Edge WebView popup test**; optional sidecar for token exchange / CORS / vault [D1][D3].
- **Produces:** OAuth where supported; hardened secret storage option. **Depends:** Phase 2 (used keys), Phase 0.2/0.3.
- **Verify (Gate G2 — OAuth popup test in Edge WebView):** full PKCE round-trip completes inside Excel's WebView (dialog opens, code captured via `messageParent`, token exchanged, state validated). **No-go** for OAuth if it fails → ship API-key-only. Covers R3, R12, R16.
- **Complexity:** high. **Refs:** Doc 5.

### Phase 9 — UI polish, states, onboarding, end-to-end hardening
- All loading/empty/error/mid-run states (Doc 8), WorkbookSwitcher, onboarding, accessibility, performance under streaming, full-scenario regression.
- **Produces:** shippable personal tool. **Depends:** all prior.
- **Verify (Gate G3 — acceptance):** the canonical scenarios (sum, format, chart, pivot, multi-step, undo, multi-workbook) all pass; no unhandled error paths.
- **Complexity:** medium.

## 10.2 Dependency map (summary)

```
P0 spikes
 └─► P1 scaffold+HTTPS (G0)
      └─► P2 store+OpenAI adapter
           ├─► P3 Anthropic+Ollama+harness (G1)
           │    └─► P4 registry+executor+read tools
           │         └─► P5 loop+context+snapshot+write tools+gate ──► P6 usage
           │                                                       └─► P7 charts/pivots
           └─► P8 auth/OAuth (G2)  ───────────────────────────────────┐
                                                                       ▼
                                                            P9 polish+acceptance (G3)
```

## 10.3 Go/no-go validation gates

| Gate | When | Pass criteria | On fail |
|------|------|---------------|---------|
| **G0** Load & self-test | end P1 | Pane sideloads over trusted HTTPS; cert/loopback/Ollama self-test green | Fix cert/loopback (R8/R9) before any feature work |
| **G1** Tool-calling harness | end P3 | Every "tool-capable" provider/model returns a well-formed, normalized tool call + round-trips a result; OpenAI↔Anthropic conformance | Demote failing models to non-tool; do not build the loop on an unreliable model (R1/R2) |
| **G2** OAuth popup in Edge WebView | P8 | Full PKCE round-trip completes inside Excel WebView | Ship API-key-only; mark OAuth unsupported (R3/D4) |
| **G3** Acceptance | P9 | All canonical scenarios pass incl. undo + multi-workbook | Block release |

## 10.4 Primary planning reference per phase

| Phase | Primary docs |
|-------|--------------|
| 0 | 1 (§1.5), 4, 5 |
| 1 | 1 (§1.2, 1.5), 9 (R8/R9) |
| 2 | 2, 3, 4 (§4.6), 7 (§7.2) |
| 3 | 4, 6 (§6.3–6.4), 9 (R1/R2) |
| 4 | 2 (§2.3/2.4), 4 (§4.1–4.4) |
| 5 | 6, 2 (§2.2/2.7/2.8), 3, 4 |
| 6 | 7, 3 (§3.2), 8 (§8.4/8.5) |
| 7 | 4 (§4.4/4.5), 9 (R6) |
| 8 | 5, 9 (R3/R12) |
| 9 | 8, 9 (all) |

## 10.5 Complexity roll-up

| Phase | Complexity |
|-------|-----------|
| 0 spikes | low–medium |
| 1 scaffold+HTTPS | medium |
| 2 store+first adapter | high |
| 3 adapters+harness | high |
| 4 registry+executor+reads | high |
| 5 loop+writes+gate | **very high** |
| 6 usage+dashboard | medium |
| 7 charts+pivots | high |
| 8 auth/OAuth | high |
| 9 polish+acceptance | medium |

## 10.6 Open decisions to resolve before/within each phase

| Decision | Resolve by |
|----------|-----------|
| D1 sidecar yes/no | Phase 0.3 (chat) / Phase 8 (OAuth) |
| D2 state library | Phase 2 start |
| D3 secret storage | Phase 8 (acceptable stub earlier) |
| D4 OpenAI OAuth | Phase 0.2 |
| D5 pivot scope | Phase 0.4 / Phase 7 |
| D6 confirmation granularity | Phase 5 |
| D7 pricing source | Phase 6 |
| D8 multi-workbook persistence/scope | Phase 0.1 / Phase 4 |
