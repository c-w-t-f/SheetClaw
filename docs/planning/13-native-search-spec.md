# Document 13 — Native Provider Search Spec

**Decision record (2026-06-11, user call; revised same day):**
1. Search is **two-tier**. LLM providers with native search use their native mechanism whenever the Search toggle is ON, and are marked "native search" in Settings. Providers without native search fall back to the **BYOK search-provider stack (Doc 11)**: they are explicitly marked in Settings as lacking native search, with instructions to configure a search API key; the toggle for them behaves exactly as Doc 11 specified (available once a key is configured). Native takes precedence — if both a native capability and a BYOK key exist, native is used.
2. After native search is confirmed working, the **OpenClaw bridge effort (Doc 12) is sunset** and its partial implementation removed (§13.7).
3. ~~TBD: BYOK stack deletion~~ — **resolved by decision 1: the BYOK stack is retained** as the search tier for non-native providers. Nothing is deleted.

Doc 11 remains authoritative for the BYOK search tier and for everything that is not discovery search: `fetch_url` (preview/caps/CORS classification/deny-cache/reader fallback), `request_user_choice`, context budgets, and the genericity invariant. This document governs the native tier and which tier is active.

## 13.1 Goals and non-goals

**Goals**
- G1. Where the user's LLM provider supports it, search executes server-side on the key they already configured — no second signup, no extra egress party, simpler privacy story. Everyone else keeps the Doc 11 BYOK path.
- G2. The Search toggle remains the single gate for all external-data egress (native mutation or BYOK `web_search`, plus `fetch_url` exposure).
- G3. Each native mechanism is verified for **coexistence with client function tools** before being enabled — SheetClaw's agent loop is function calls; a native search that breaks tool calling disqualifies the provider (it falls back to the BYOK tier).

**Non-goals (v1)**
- No citation/annotation UI; adapters must *tolerate* citation payloads in streams without breaking, nothing more (§13.8 OQ3).
- No OpenAI/Groq/Mistral native search (§13.2 — deferred, their mechanisms conflict with SheetClaw's model-choice design; they use the BYOK tier meanwhile).
- No mixing tiers in one session: when native is active, the client `web_search` tool is not exposed.

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

**BYOK tier** (no usable native path; Doc 11 search stack applies, Settings marks them as lacking native search): `ollama` (local chat has none — though ollama.com's hosted search API is a natural *sixth BYOK adapter* candidate for exactly this segment, see OQ4), `deepseek`, `together`, `llama`, plus the deferred three above.

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

### Gating (two-tier; extends Doc 11 §11.4)

Tier resolution per run: `tier = native` if `NATIVE_SEARCH[activeProvider]` exists and (`supportsModel` absent or true for the configured model); else `tier = byok`.

- **Toggle available** ⇔ tier is native, **or** tier is byok and a Doc 11 search provider is configured and ready.
- **Toggle ON, native tier** ⇒ request mutation active; client `web_search` tool **not** exposed; `fetch_url` exposed.
- **Toggle ON, byok tier** ⇒ exactly Doc 11 behavior: client `web_search` + `fetch_url` exposed, no native mutation.
- **Toggle OFF or unavailable** ⇒ no mutation, no web tools.
- Native precedence: a configured BYOK key is ignored while the active provider is native-capable.
- `request_user_choice` is unaffected (not egress).

### Cost

Native searches bill to the user's LLM key and are not itemized by SheetClaw's usage tracker. The Settings Search tab and the toggle tooltip state this plainly (reuse Doc 12's B6 wording pattern).

## 13.4 UI

- **Composer toggle**, three states (pattern from Doc 11 §11.7):
  - *available/off* and *on* — unchanged.
  - *unavailable* (byok tier, no key configured) — soft-disabled; clicking shows: "`<Provider label>` has no native web search. Configure a search API key in Settings → Search to enable search." with an Open Settings action. (For Qwen with a model outside the native restriction, the hint names the model constraint and offers both options.)
- **Settings → Search tab:** a status line for the active provider at the top — "✓ `<Provider>` has native web search; searches run on your provider key. `<cost note>`" or "✗ `<Provider>` has no native web search — configure a search provider below to enable search." Below it: the Doc 11 BYOK provider/key section (unchanged, now explicitly serving non-native providers) and the reader-fallback checkbox. When the active provider is native, the BYOK section remains visible but is annotated "not used while `<Provider>` is active (native search takes precedence)". The OpenClaw diagnostics section is removed at sunset (§13.7).
- **Provider forms** (Ollama/OpenRouter/Other API tabs): a one-line caption per provider — "Native web search: yes" / "Native web search: no — uses your search API key (Search tab)".
- `webSearchEnabled` session-state semantics unchanged; switching the active provider re-resolves the tier, and switching to a provider whose tier is unavailable resets the toggle to OFF.

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
| N-1 | Non-native provider + no BYOK key → toggle unavailable, hint instructs configuring a search key; non-native provider + key configured → Doc 11 behavior intact (client `web_search` + `fetch_url`, no native mutation) | unit + component |
| N-2 | Native provider + toggle ON → request contains exactly that provider's mutation; switching provider changes/removes it and re-resolves the tier | unit per kind |
| N-3 | Toggle OFF → no mutation, no web tools, for both tiers | unit |
| N-4 | Mutation never sent to a different provider's endpoint (e.g. `openrouter:web_search` never reaches Z.AI) | unit |
| N-5 | Kimi passthrough: `$web_search` tool call echoed verbatim; never executed locally; other tool calls unaffected | unit (loop) |
| N-6 | Adapters skip unknown content blocks/annotations without corrupting text or tool calls (fixture streams per provider) | unit |
| N-7 | Native tier active → client `web_search` absent from the request even when a BYOK key is configured (precedence) | unit |
| N-8 | Genericity guard still passes | static |
| N-9 | Manual: Doc 11 AC-11 scenarios re-run twice — once on a native provider, once on a BYOK-tier provider | manual |

## 13.7 OpenClaw sunset plan (decision 2)

**Trigger:** Phase 0 passes for the user's primary provider(s) and N-1..N-8 are green.
**Halt now:** no further Doc 12 implementation work as of 2026-06-11.
**Removal inventory** (all of the partial implementation that exists):
- SettingsPanel.tsx "OpenClaw Phase 0 diagnostics" section (introduced in `4df8160`, adjusted in `7df37d1`).
- Doc 12 is kept as a historical record with its sunset banner; no code references remain.
- Nothing else: no `src/bridge/`, no tool, no config keys were ever created.

## 13.8 Open questions

1. ~~OQ1 — BYOK search stack deletion~~ — **resolved 2026-06-11: retained** as the search tier for non-native providers (decision 1, revised).
2. **OQ2 — deferred providers** (OpenAI/Groq/Mistral): they use the BYOK tier; native support revisited only on user demand.
3. **OQ3 — citations:** native search returns citations we currently drop. Surface them later as transcript metadata?
4. **OQ4 — Ollama hosted search as a sixth BYOK adapter** (`ollama.com/api/web_search` + `web_fetch`, free account key): the natural search path for the default-provider segment, and its `web_fetch` endpoint is a candidate reader-fallback alternative to jina (Doc 11 OQ2). Needs the standard browser-side CORS verification.

## Appendix A — Phase 0 results

*(per-provider verification results go here)*
