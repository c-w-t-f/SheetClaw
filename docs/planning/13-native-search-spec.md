# Document 13 — Native Provider Search Spec

**Decision record (2026-06-11, user call):**
1. Web search moves to **LLM-provider-native search**. The composer Search toggle is available only when the active LLM provider supports native search; toggling it ON activates that provider's native search in requests. Providers without native search get a disabled toggle — search is not supported for them.
2. After native search is confirmed working, the **OpenClaw bridge effort (Doc 12) is sunset** and its partial implementation removed (§13.7).
3. **TBD:** whether to delete the BYOK search-provider stack (Doc 11 §11.3–11.4 providers) or keep it dormant (§13.8 OQ1). Note: under decision 1 it is *functionally* retired immediately — the toggle no longer consults it; the open question is only code/docs deletion.

Doc 11 remains authoritative for everything that is **not** discovery search: `fetch_url` (preview/caps/CORS classification/deny-cache/reader fallback), `request_user_choice`, context budgets, and the genericity invariant.

## 13.1 Goals and non-goals

**Goals**
- G1. Search executes server-side at the user's LLM provider, on the key they already configured — no second signup, no extra egress party, simpler privacy story.
- G2. The Search toggle remains the single gate for all external-data egress (native search activation + `fetch_url` exposure).
- G3. Each provider mechanism is verified for **coexistence with client function tools** before being enabled — SheetClaw's agent loop is function calls; a native search that breaks tool calling disqualifies the provider.

**Non-goals (v1)**
- No BYOK search fallback for non-native providers (decision 1).
- No citation/annotation UI; adapters must *tolerate* citation payloads in streams without breaking, nothing more (§13.8 OQ3).
- No OpenAI/Groq/Mistral native search (§13.2 — deferred, their mechanisms conflict with SheetClaw's model-choice design).

## 13.2 Provider capability matrix

**Supported in v1** (clean fit with existing adapters and chat-completions flow):

| Provider | Mechanism | How it works | Search cost |
|---|---|---|---|
| `generic` (OpenRouter) | `openrouter:web_search` server tool in `tools[]` | Model invokes 0–N times server-side; beta | ~$0.005/call (Exa) |
| `anthropic` | Web search server tool in Messages API `tools[]` | Server-side, documented to coexist with client tools; stream contains `server_tool_use` / `web_search_tool_result` blocks | ~$10/1k searches + result tokens |
| `kimi` (Moonshot) | `builtin_function` `$web_search` in `tools[]` | Flows through the **standard tool-calling loop**: model emits a `$web_search` tool call; client echoes the arguments back verbatim as the tool result; search executes server-side on the next completion | $0.005/call |
| `qwen` (DashScope) | `enable_search: true` + `search_options` request params | Same OpenAI-compatible endpoint SheetClaw already uses; restricted to newer models (qwen3.5-plus/flash, qwen3-max in thinking mode) | per provider |
| `glm` (Z.AI) | `web_search` tool type in `tools[]` | Chat completions | per provider |

**Deferred** (mechanism fights the design; revisit on demand): `openai` (needs Responses API migration or forced `-search-preview` models), `groq` (built-in tools only on `groq/compound` models — overrides user model choice), `mistral` (websearch lives in the separate Agents API).

**Unsupported** (no native path; Search toggle disabled): `ollama` (local chat has none — ollama.com's hosted search API is a BYOK-style service, excluded by decision 1), `deepseek`, `together`, `llama`.

## 13.3 Architecture

### Capability descriptor

```ts
// src/adapters/native-search.ts
interface NativeSearchCapability {
  provider: ProviderKey;
  kind: 'openrouter-server-tool' | 'anthropic-server-tool'
      | 'kimi-builtin-function' | 'qwen-enable-search' | 'glm-web-search-tool';
  /** e.g. Qwen's model restriction; absent = all models */
  supportsModel?: (model: string) => boolean;
  costNote: string;
}
export const NATIVE_SEARCH: Partial<Record<ProviderKey, NativeSearchCapability>> = { ... };
```

This registry is the single source of truth for toggle availability, request mutation, and Settings copy. No capability flags scattered across adapters.

### Request mutation (per kind, applied only when session search is ON)

- `openrouter-server-tool` / `glm-web-search-tool` / `anthropic-server-tool`: append the provider's tool entry to the serialized tools array. Anthropic's goes through the Anthropic adapter; the other two through the OpenAI adapter, gated on the active provider key (never sent to other OpenAI-compatible endpoints).
- `kimi-builtin-function`: append the `$web_search` builtin tool entry **and** register a loop-level passthrough: a tool call named `$web_search` is answered by echoing its arguments back as the tool result (no local execution, no parsing). This is the one mechanism that touches the agent loop.
- `qwen-enable-search`: set `enable_search: true` (+ default `search_options`) in the request body.

### Stream tolerance

Each adapter must tolerate the provider's search artifacts without crashing or corrupting tool-call accumulation: unknown content block types (Anthropic `server_tool_use`, `web_search_tool_result`), `annotations`/`url_citation` fields (OpenRouter/GLM), and billing/usage extensions. Unknown block types are skipped; their text content is not injected into the transcript in v1.

### Gating (replaces Doc 11 §11.4 tool-exposure rules for search)

- Toggle **available** ⇔ `NATIVE_SEARCH[activeProvider]` exists *and* (`supportsModel` absent or true for the configured model).
- Toggle **ON** ⇒ request mutation active **and** `fetch_url` exposed. Toggle OFF or unavailable ⇒ neither.
- The legacy `web_search` client tool is **never exposed** (retired from the tool list; code fate per OQ1).
- `request_user_choice` is unaffected (not egress).

### Cost

Native searches bill to the user's LLM key and are not itemized by SheetClaw's usage tracker. The Settings Search tab and the toggle tooltip state this plainly (reuse Doc 12's B6 wording pattern).

## 13.4 UI

- **Composer toggle**, three states (pattern from Doc 11 §11.7, new copy):
  - *available/off* and *on* — unchanged.
  - *unavailable* — soft-disabled; clicking shows: "Web search isn't supported with `<provider label>`. Switch to OpenRouter, Anthropic, Kimi, Qwen, or GLM in Settings to use search." with an Open Settings action. (For Qwen with an unsupported model, the hint names the model restriction instead.)
- **Settings → Search tab, v1 contents:** native-search status line for the active provider (supported/unsupported + cost note), the reader-fallback checkbox (Doc 11, unchanged — it serves `fetch_url`), and nothing else. The BYOK provider/key section is hidden (OQ1); the OpenClaw diagnostics section is removed at sunset (§13.7).
- `webSearchEnabled` session-state semantics unchanged; switching the active provider to a non-native one resets it to OFF.

## 13.5 Phase 0 — per-provider verification (gate)

For each v1 provider, from a sideloaded taskpane with a real key, record in Appendix A:

| Check | Why |
|---|---|
| Native search activates and returns search-grounded answers | basic function |
| **Client function tools still work in the same request** (model can call `read_range`/`write_range` etc. in a search-enabled session) | G3 — disqualifying if broken |
| Streaming completes without adapter errors; tool-call accumulation uncorrupted by search artifacts | stream tolerance |
| Kimi only: `$web_search` round-trip via echo-back works in our loop | unique mechanism |
| Qwen only: behavior when model doesn't support `enable_search` (silent ignore vs hard error) | gating correctness |
| Search-call cost appears on the provider's billing as expected | B6-style honesty |

**Gate:** a provider ships only after passing; failures move it to *deferred* with the failure recorded. **The user's decision 2 trigger — "native search works fine" — is satisfied when at least the user's primary provider(s) pass.**

## 13.6 Acceptance criteria

| # | Criterion | Type |
|---|---|---|
| N-1 | Active provider without native search → toggle unavailable, hint names supported providers, no search mutation in requests | unit + component |
| N-2 | Active provider with native search + toggle ON → request contains exactly that provider's mutation; switching provider changes/removes it | unit per kind |
| N-3 | Toggle OFF → no mutation, no `fetch_url`, even for native providers | unit |
| N-4 | Mutation never sent to a different provider's endpoint (e.g. `openrouter:web_search` never reaches Z.AI) | unit |
| N-5 | Kimi passthrough: `$web_search` tool call echoed verbatim; never executed locally; other tool calls unaffected | unit (loop) |
| N-6 | Adapters skip unknown content blocks/annotations without corrupting text or tool calls (fixture streams per provider) | unit |
| N-7 | Legacy `web_search` absent from every request | unit |
| N-8 | Genericity guard still passes | static |
| N-9 | Manual: Doc 11 AC-11 scenarios re-run using native search for discovery (per verified provider) | manual |

## 13.7 OpenClaw sunset plan (decision 2)

**Trigger:** Phase 0 passes for the user's primary provider(s) and N-1..N-8 are green.
**Halt now:** no further Doc 12 implementation work as of 2026-06-11.
**Removal inventory** (all of the partial implementation that exists):
- SettingsPanel.tsx "OpenClaw Phase 0 diagnostics" section (introduced in `4df8160`, adjusted in `7df37d1`).
- Doc 12 is kept as a historical record with its sunset banner; no code references remain.
- Nothing else: no `src/bridge/`, no tool, no config keys were ever created.

## 13.8 Open questions

1. **OQ1 — BYOK search stack deletion (user's "to be decided").** Functionally retired by decision 1. Deleting means removing `src/web/providers/*`, `src/web/search.ts`, the Settings BYOK section, search auth-state slots, and amending Doc 11 §11.3–§11.4/§11.12 + privacy.html. Keeping it dormant costs maintenance and dead code but preserves an escape hatch if a native mechanism (notably OpenRouter's beta) breaks. Decide after Phase 0 results are in.
2. **OQ2 — deferred providers** (OpenAI/Groq/Mistral): revisit only on user demand.
3. **OQ3 — citations:** native search returns citations we currently drop. Surface them later as transcript metadata?

## Appendix A — Phase 0 results

*(per-provider verification results go here)*
