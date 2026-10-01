# 41 — relay: talking to LLMs from beam-lisp (and what omega vendors)

> **Abstract.** `/home/user/code/ora/relay` is an OpenAI-compatible gateway written in beam-lisp, but its
> *core* (`relay.engine`) is an HTTP-independent library: `model + messages + tools + opts → stream of
> req_llm chunks + a finalizer that records tokens and spend`. Provider breadth (30+ adapters, SSE parsing,
> pricing) comes from the Elixir library **req_llm 1.9.0**, wrapped in ~15 lines of bl. A `defprotocol`
> "provider port" isolates per-provider quirks. spell's first attempt already consumed `relay.engine`
> in-process and it worked (`../lineage/spell.bl.md`). For omega the minimal vendoring is **12 files, ≈1.45 kLOC as-is (≈900 after trimming)**:
> `engine, completion, providers, provider, provider/openai-compat, provider/anthropic, messages, usage,
> spend (adapted), error, env, config (adapted)` plus the `req_llm` Hex dep — dropping keys, budgets,
> admin, OAuth accounts, HTTP, dashboard, rate-limit, analytics. Gaps to fill in omega: a tool-result
> message path in `relay.messages` (it flattens content to text), a chunk→event fold into a pi-style
> event vocabulary, thinking chunks, and cancellation.

Legend: **[OBS]** read/ran · **[INF]** inference.

## 1. Sources

Relay (`/home/user/code/ora/relay`, 6208 lines of `src/relay` + `lib/relay` + `mix.exs`):
`README.md:1-206` · `mix.exs:1-87` · `lib/relay/application.ex:1-112` · `src/relay/engine.bl` (133 l) ·
`completion.bl` (108) · `providers.bl` (141) · `provider.bl` (138) · `provider/openai-compat.bl` (115) ·
`provider/anthropic.bl` (148; read L38-148) · `provider/kimi.bl` (85) · `provider/codex.bl` (75) ·
`messages.bl` (73) · `request.bl` (116) · `response.bl` (87) · `sse.bl` (154) · `usage.bl` (195) ·
`spend.bl` (122) · `inference.bl` (194; header read) · `store.bl` (139; schema L45-76) · `env.bl` (92) ·
`config.bl` (88) · `error.bl` (100) · `json.bl` (49) · `test/relay/engine-test.bl:1-60`.
req_llm: `/home/user/code/ora/relay/deps/req_llm/lib/req_llm.ex` (`stream_text` L866 `defdelegate … Generation`),
`lib/req_llm/stream_chunk.ex:1-80`, `lib/req_llm/stream_response.ex` (`text` L168, `tool_calls` L199,
`usage` L483), `lib/req_llm/providers/*` (alibaba amazon_bedrock anthropic azure cerebras cohere deepseek
google google_vertex groq meta mistral openai openai_codex openrouter venice vllm xai zai zai_coding_plan …).

spell consumer: `/home/user/code/undefine/spell/apps/spell/lib/spell/model.ex:1-329`, and the chunk fold in
`apps/spell/lib/spell/loop.ex:953-1000, 1987`.

knowledger: `/home/user/code/products/knowledger/apps/knowledger/src/knowledger/llm.bl` (297 l, read 1-274),
`decision.bl` (1080 l; header L1-30, Jev bits L113-300, `jev-body` L945, URL L1043 — skimmed).

beam-lisp (`/home/user/code/undefine/beam-lisp--repl`): `priv/lib/gen/llm.bl:1-84`,
`priv/lib/harness/model.bl:1-105`, `priv/std/interop.bl:1-123`, `docs/bl/05-shipping.md:143-144` (`bl deps`).

pi: `/home/user/code/undefine/omega/research/vendor/pi/packages/ai/src/types.ts`
(`KnownApi` L17-27, `AssistantMessage` L546-568, `Usage` L427-448, `StopReason` L450, `ToolCall` L417,
`AssistantMessageEvent` L767-783, `StreamFunction` L371-375).

## 2. How relay talks to an LLM (the call path) [OBS]

### 2.1 Layout

```
src/relay/
  engine.bl            ← THE library entry: stream / generate / tool
  providers.bl         ← router: "gpt-4o" | "anthropic:claude-…" → {:provider :model :api-key :base-url}
  config.bl            ← alias table (data): alias → {:provider :model :api-key {:env VAR} :base-url …}
  provider.bl          ← defprotocol Provider (5 methods) + REGISTRY atom + for-kw
  provider/{openai-compat,anthropic,kimi,codex}.bl   ← adapters, each (provider/register! :kw (->X))
  messages.bl          ← OpenAI wire messages (string keys) → req_llm loose maps (atom keys)
  completion.bl        ← the ONE place req_llm is touched; swappable backend atom
  usage.bl, spend.bl   ← provider usage → unified 6-field token model → datom + telemetry
  inference.bl         ← per-request inference-id, feedback, JSONL export
  error.bl, env.bl, json.bl, store.bl, request.bl, response.bl, sse.bl   ← wire/HTTP + persistence
  http.bl keys.bl auth.bl budgets.bl gate.bl ratelimit.bl accounts.bl oauth.bl analytics.bl
  sandbox/grant/bash-shell/wayland-shell.bl dashboard/*   ← gateway + admin + unrelated
lib/relay/{application,bridge}.ex   ← boot beam-lisp + Bandit Plug (HTTP edge)
```

### 2.2 Call path (streaming) [OBS: engine.bl:96-118, completion.bl, openai-compat.bl, anthropic.bl]

```
(engine/stream {:model "kimi" :messages [{"role" "user" "content" …}] :tools [openai-tool…] :tool-choice nil :opts {} :key-id nil})
 1. providers/resolve model      → {:ok {:provider :model :api-key :base-url :adapter :account-provider :key-missing}}
                                    alias hit → resolve-alias (reads env var via relay.env/getenv)
                                    else "provider:model" passthrough (to-existing-atom guard: no atom leak)
 2. normalize-tools              → each OpenAI {"type":"function","function":{name,description,parameters}}
                                    → ReqLLM.Tool/new [name description parameter_schema callback(inert)]
 3. accounts/for-provider        → OAuth account or nil (OFF by default; flag-gated)
 4. provider/-auth adapter       → {:mode :api-key|:oauth :opts {:api_key …}}   (fragment merged verbatim)
 5. provider/-prep-messages      → e.g. Anthropic-OAuth prepends the exact Claude-Code system line
 6. provider/-call-opts          → ONLY options this provider validates (+ :tools :tool_choice :base_url)
 7. completion/stream "provider:model" msgs opts
                                  → (ReqLLM/stream_text spec msgs <opts as KEYWORD LIST>)  normalised {:ok r}|{:error e}
 8. return {:ok {:chunks (:stream response) :inference-id id :finalize (fn [] …)}}
```

Key invariants documented in source:
* **`->keyword-list`** (completion.bl:35-41): req_llm reads opts with `Keyword.get`; a bl map raises, so the
  one crossing point converts. beam-lisp now ships `interop/->kwlist` (`priv/std/interop.bl:79`) — **use it instead**.
* **`normalize`** (completion.bl:48-58): Erlang `{:ok, r}` tuples → bl `{:ok r}` maps, and any *raise* → `{:error msg}`.
  beam-lisp ships `interop/result` (L38) for this too.
* **Errors are values**: `{:error {:kind :request|:provider …}}`; no throw for expected failures.
* **Atoms from untrusted strings never minted**: role table in `messages.bl`, `binary_to_existing_atom` in `providers.bl`.

### 2.3 Streaming [OBS: sse.bl, spell loop.ex:953-1000]

req_llm returns a lazy `Enumerable` of `%ReqLLM.StreamChunk{type, text, name, arguments, metadata}`
(`stream_chunk.ex:1-80`). The chunk vocabulary is exactly four types:

| `:type` | payload | note |
|---|---|---|
| `:content` | `:text` | assistant text delta |
| `:thinking` | `:text` | reasoning delta (relay's SSE drops it; omega should keep it) |
| `:tool_call` | `:name`, `:arguments` (map, possibly `{}`), `:metadata {:index :id}` | opens a call |
| `:meta` | `:metadata` | `:finish_reason`, `:usage`, and **tool-arg fragments** `:tool_call_args {:index :fragment}` |

Tool-call arguments arrive as `:meta` chunks carrying string *fragments* to concatenate per `:index`
(relay `sse.bl::tool-args-frame`; spell `loop.ex:953-955`: "some providers instead deliver complete decoded
arguments on the :tool_call chunk, kept as a map"). Usage lands on the **last** meta chunk; relay therefore
makes you call `finalize` **after** consuming the stream ("req_llm's terminal usage metadata has settled").
`relay.sse` is a *transport* concern (OpenAI SSE frames via `Stream/flat_map`, lazily); omega does not need it
— it needs the fold in §2.4 instead.

### 2.4 The fold omega needs (and a verified miniature) [OBS-run]

Below is chunk-fold logic in pure beam-lisp over the exact chunk shapes above, with the same finish/usage
fields. It runs offline (`bl run`), and is the same shape the spell loop folded in Elixir.

```beam-lisp
(defn step [acc c]
  (case (:type c)
    :content  (update acc :text str (:text c))
    :thinking (update acc :thinking str (:text c))
    :tool_call (let [i (or (get-in c [:metadata :index]) 0)]
                 (assoc-in acc [:calls i]
                           {:id (get-in c [:metadata :id]) :name (:name c) :args ""}))
    :meta (let [m (:metadata c)
                a (:tool_call_args m)
                acc (if (map? a)
                      (update-in acc [:calls (or (:index a) 0) :args] str (:fragment a))
                      acc)]
            (merge acc (select-keys m [:finish_reason :usage])))
    acc))

(def chunks
  (list {:type :content :text "Let me look. "}
        {:type :tool_call :name "read" :metadata {:index 0 :id "c1"}}
        {:type :meta :metadata {:tool_call_args {:index 0 :fragment "{\"path\":"}}}
        {:type :meta :metadata {:tool_call_args {:index 0 :fragment "\"a.txt\"}"}}}
        {:type :meta :metadata {:finish_reason :tool_calls
                                :usage {:input_tokens 12 :output_tokens 5 :total_cost 0.002}}}))

(def folded (reduce step {:text "" :thinking "" :calls {}} chunks))
(println "text:" (:text folded) "| finish:" (:finish_reason folded))
(println "call 0:" (get-in folded [:calls 0]))
(println "args decoded:" (Jason/decode! (get-in folded [:calls 0 :args])))
```

(A real omega fold would emit *incremental events* — see §6.)

### 2.5 The swappable backend = the offline seam [OBS: completion.bl:62-85, engine-test.bl]

```clojure
(def backend (atom {:generate req-llm-generate :stream req-llm-stream :usage req-llm-usage}))
(defn set-backend! [m] (reset! backend m))
```

Tests (and spell's `PROVIDER=fake`) install `{:stream (fn [_ms _msgs _o] {:ok {:stream (list {:type :content :text "ok"})}}) …}`
and the **full** resolve→prepare→fold→finalize path still runs. This is exactly the cassette seam spell-app
built (`../lineage/spell.bl.md` §2.9): record = wrap the live backend, replay = canned chunks keyed by request digest.
Runnable miniature of that seam (a recording/replaying backend; no network):

```beam-lisp
(def live-calls (atom 0))
(defn live-stream [model-spec msgs _opts]
  (swap! live-calls inc)
  {:ok {:stream (list {:type :content :text (str "echo:" (count msgs) "@" model-spec)})}})

(def backend (atom {:stream live-stream}))
(defn stream [spec msgs opts] ((:stream @backend) spec msgs opts))

;; cassette: digest-keyed memo of chunk lists, wrapping any backend fn
(defn with-cassette [inner cassette]
  (fn [spec msgs opts]
    (let [k (erlang/phash2 [spec msgs opts])
          hit (get @cassette k)]
      (if hit
        {:ok {:stream hit}}
        (let [r (inner spec msgs opts)
              chunks (doall (:stream (:ok r)))]
          (swap! cassette assoc k chunks)
          {:ok {:stream chunks}})))))

(def tape (atom {}))
(swap! backend assoc :stream (with-cassette live-stream tape))
(def a (doall (:stream (:ok (stream "openai:gpt-4o" [{:role :user :content "hi"}] {})))))
(def b (doall (:stream (:ok (stream "openai:gpt-4o" [{:role :user :content "hi"}] {})))))
(println (= a b) "live calls:" @live-calls "recorded:" (count @tape))
```

(Run: prints `true live calls: 1 recorded: 1` — the second identical request never touches the "network".
Uses `erlang/phash2` as the digest; spell-app's real cassette uses a canonical-request sha256 with volatile
fields stripped and never stores the request, only its digest.)

## 3. Tool calls [OBS]

* **Outbound (tool definitions).** `engine/tool` → `openai/tool` (`provider/openai-compat.bl:~20-36`) builds a
  `%ReqLLM.Tool{}` from the JSON-schema `parameters` map with an **inert callback**: "relay only brokers
  calls — tool execution belongs to its caller". So omega's tool registry keeps its own executors and
  hands relay only `{"type":"function","function":{name description parameters}}` maps. The engine
  normalises the list (`normalize-tools`, engine.bl:29-36) and short-circuits on the first invalid tool.
  `:tool-choice` is passed straight to req_llm's `:tool_choice`.
* **Inbound.** `:tool_call` chunks + fragment `:meta` chunks (§2.3); non-streaming
  `ReqLLM.Response/tool_calls` (`response.bl:46-58`).
* **Round-trip messages.** `relay.messages/convert` (messages.bl:50-62) carries `:name` and `:tool_call_id`
  **only for string content** and flattens content to text (`text-of`); it does **not** serialise an
  assistant message's `tool_calls` array, nor tool-result content parts. [INF] A tool loop (assistant
  emits calls → we append `{:role :tool :tool_call_id id :content result}`) needs the assistant turn to carry
  its `:tool_calls` back; **omega must extend `messages.bl` here** (req_llm's `ReqLLM.Context`/
  `ReqLLM.Message` structs can hold tool calls — verify against `deps/req_llm/lib/req_llm/message*`).
  spell dodged this by using a single `run` tool and retry-feeding verdicts as plain user text.
* **Provider-safe options**: Anthropic and OpenAI validate options differently, so `-call-opts` emits only
  what that provider accepts (the "option-leak class of bug", provider.bl:20-28).

## 4. The provider port [OBS: provider.bl]

`defprotocol Provider` with five methods, each taking the adapter record first:

| method | job |
|---|---|
| `-call-opts [p req spec]` | the req_llm options *this* provider validates (sampling, `:tools`, `:base_url`, Anthropic cache knobs) |
| `-prep-messages [p msgs account]` | rewrite messages (Anthropic-OAuth: exact "You are Claude Code…" prefix) |
| `-parse-usage [p usage]` | native usage → unified 6-field model |
| `-auth [p account spec]` | `{:mode :opts}` fragment merged verbatim (`{:api_key …}` or OAuth `{:auth_mode :access_token :anthropic_beta}`) or `{:error e}` |
| `-map-error [p err]` | any error → `{:status n :error envelope}` (OpenAI-shaped; omega would map to its own `{:kind …}`) |

Registry: an atom map; adapters self-register at load (`(provider/register! :openai (->OpenAICompatProvider))`);
`for-kw` falls back to `:__default__` (the OpenAI-compat adapter) so any req_llm-native provider still works.
Routing is *data*: `config/models` is a function (so env is never frozen at load) returning
`{alias {:provider kw :model str :api-key {:env VAR} :base-url str :adapter kw :account-provider str}}`.
OpenAI-compatible vendors (Kimi/Moonshot, DeepSeek, GLM/z.ai coding plan) are simply `:provider :openai`
plus `:base-url`. Providers exercised in the table: openai, anthropic, zai, mistral, deepseek, kimi, glm,
codex (OAuth-only, Responses API).

## 5. Token / spend accounting [OBS: usage.bl, spend.bl, store.bl]

1. **What arrives.** req_llm *normalises* usage before relay sees it (verified by relay's author against
   req_llm 1.9.0): flat `:input_tokens/:output_tokens`, `:cached_tokens`, `:cache_creation_tokens`,
   `:input_includes_cached`, `:total_cost` (**dollars**). Raw provider shapes are also read for a future direct adapter.
2. **`usage/unify`** → six fields `{:cache-read :cache-write :cache-write-5m :cache-write-1h :input :output}`.
   `:input` = *non-cached remainder*: subtract cache-read only when the provider folded it in (OpenAI inclusive,
   Anthropic exclusive; req_llm's explicit `:input_includes_cached` flag wins). nil usage → all zeros
   ("never invented tokens"). Known limitation: req_llm drops the Anthropic 5m/1h write split, so spend
   buckets the write total by the TTL the *request* asked for.
3. **`spend/record`** → cents = `round(total_cost * 100)` floored at 0 ("money in a float is a rounding bug"),
   one `:spend/*` datom (`:spend/key :model :provider :input-tokens :output-tokens :cost-cents :request-id :at`
   + cache facts only when non-zero) and `:telemetry.execute [:relay :request :stop]` with duration, tokens, cents.
4. **`inference/record`**: one id per request (`:inference/id` unique-identity), joinable to the spend row
   (`:spend/request-id`) — a feedback/replay anchor.
5. **When.** `finalize` (closure returned by `engine/stream`) records both; caller must run it *after* draining
   the stream. Non-streaming records inside `generate`.

A runnable check of the cents/unify arithmetic (verbatim logic, trimmed):

```beam-lisp
(defn- rd [m k] (let [v (or (get m k) (get m (name k)))] (if (number? v) (erlang/trunc v) 0)))
(defn unify-min [u]
  (let [raw  (max (rd u :input_tokens) (rd u :prompt_tokens) (rd u :input))
        cr   (max (rd u :cache_read_input_tokens) (rd u :cached_tokens) (rd u :cached_input))
        incl (if (contains? u :input_includes_cached) (= true (:input_includes_cached u)) true)]
    {:cache-read cr :input (if incl (max 0 (- raw cr)) raw) :output (max (rd u :output_tokens) (rd u :output))}))
(defn cost-cents [u]
  (let [c (get u :total_cost)] (if (number? c) (max 0 (erlang/round (* c 100))) 0)))

(println "openai-style   :" (unify-min {:input_tokens 100 :cached_tokens 40 :input_includes_cached true :output_tokens 7}))
(println "anthropic-style:" (unify-min {:input_tokens 100 :cache_read_input_tokens 40 :input_includes_cached false :output_tokens 7}))
(println "cents:" (cost-cents {:total_cost 0.0137}) (cost-cents nil))
```

Omega relevance: the *tokens* matter (context-window gauges, per-task cost traces); *cents* are from
req_llm's `llm_db` pricing. Per-task spend as stigmergic traces = datoms keyed by task id instead of `:spend/key`.

## 6. Comparisons

### 6.1 relay vs knowledger `llm.bl` [OBS]

| | relay (`engine`/`completion`) | knowledger `llm.bl` (297 l) | beam-lisp `gen/llm.bl` (84 l) |
|---|---|---|---|
| Transport | req_llm (Elixir dep, Finch) | OTP `httpc`, hand-built Gemini `generateContent` POST | OTP `inets/ssl` + `json`, OpenAI `/chat/completions` |
| Providers | 30+ via req_llm + alias table | 1 (Gemini) + deterministic `:fake` | any OpenAI-compatible (`provider` map) |
| Streaming | yes (lazy chunk Enumerable) | **no** | **no** |
| Tools | yes (ReqLLM.Tool) | no (JSON-mode only, `decode-reply` repairs fences/trailing prose) | no |
| Retry/timeouts | none in relay core (req_llm defaults) | explicit: 30 s/10 s, 2 retries, backoff `[1000 3000]`, `Retry-After` capped 5 s; kinds `:rate-limited :server :client :transport :bad-response :no-key` | `:timeout-ms`, no retry |
| Offline | `set-backend!` stub | **disk cassette** keyed `<model>-<sha256(prompt)[0:32]>.json`, consulted *before* demanding a key | none |
| Errors | `{:error {:kind …}}` values | `{:ok …}/{:error {:kind …}}`, never throws; `gen!` throws variant | `{:ok text}/{:error …}` |
| Data policy | none | `decision.bl`: per-call `:data-policy` default-deny; `:approved` content never cassetted (`:cache :none`) | none |
| Usage | unified 6-field + cents | prompt/output/total only | none |

Takeaways: knowledger's **retry/timeout/error-kind taxonomy**, **cassette-before-key**, and **data-policy gate**
are worth lifting into omega *around* relay's engine (they're orthogonal). Its hand-rolled HTTP is not worth
copying: no streaming, one provider.

**Jev** (typed decisions): knowledger reaches it via its own `decision.bl` (`POST {TYPESAFE_BASE_URL|https://api.typesafe.ai}/v1/systemone`,
key from `TYPESAFE_API_KEY`/`JEV_API_KEY`, `decision.bl:113,174-175,1043`) — **not** through relay and not a
chat API. [INF] Omega's Jev client should be a sibling of the chat client sharing the retry/data-policy
wrapper, not an adapter inside relay's provider port. pi also models this as a separate `ClassifierApi`
(`typesafe-system-one`, types.ts:35) distinct from chat `KnownApi`.

### 6.2 relay/req_llm vs pi `packages/ai` [OBS: types.ts]

pi's unit is a **provider-native event stream**, not provider-neutral chunks:

```ts
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start" | "text_delta" | "text_end"; contentIndex: number; …; partial: AssistantMessage }
  | { type: "thinking_start" | "thinking_delta" | "thinking_end"; … }
  | { type: "toolcall_start" | "toolcall_delta" | "toolcall_end"; …; toolCall: ToolCall; … }
  | { type: "done"; reason: "stop"|"length"|"toolUse"|"deferred"; message: AssistantMessage }
  | { type: "error"; reason: "aborted"|"error"; error: AssistantMessage };
```

| Concern | pi | relay/req_llm |
|---|---|---|
| Event grain | start/delta/end triples per content block, each carrying the **full `partial` message** | flat chunks; accumulation is the caller's job |
| Stop reasons | `pending stop length toolUse error aborted deferred` | `:stop :length :tool_calls :content_filter` (mapped in `sse.bl`) |
| Errors | **inside** the stream: "Once a stream is returned, failures are encoded in that stream" (types.ts:365-368) with `stopReason:"error"|"aborted"` | `{:error e}` before the stream; mid-stream failures not specified in relay |
| Usage | `Usage{input output cacheRead cacheWrite cacheWrite1h? reasoning? totalTokens cost{input output cacheRead cacheWrite total}}` on the message | six-field unified + cents, recorded separately |
| ToolCall | `{type:"toolCall" id name arguments(JsonObject)}` | name + fragments; caller parses JSON |
| API registry | `Api` = string union (`openai-completions`, `anthropic-messages`, `openai-responses`, `bedrock-converse-stream`, `google-generative-ai`, …) × `Provider` | protocol adapters per provider, over req_llm |
| Cancellation | `aborted` stop reason, signal in options | none visible in relay |

[INF] Omega should define its **own** event vocabulary at the seam (pi's is a good model: block-indexed
start/delta/end + terminal `done`/`error` carrying a complete message with usage), and implement it as a fold
over req_llm chunks in `omega.llm` — so a task process receives messages like `{:llm/event id ev}` that other
tasks and UIs can subscribe to. Errors-in-stream is the right call for a process-based system (one handler).

## 7. What omega should VENDOR (precise plan — do not copy yet)

Base: req_llm 1.9.0 + splode 0.3.0 pin (relay `mix.exs:34-37`: req_llm 1.9.0 resolves splode 0.3.2 whose
struct expansion hits a cyclic-module error on Elixir 1.20 → force `{:splode, "== 0.3.0", override: true}`).

| File (`/home/user/code/ora/relay/…`) | Purpose | Verdict | Notes |
|---|---|---|---|
| `mix.exs` deps `req_llm`, `splode` pin, `jason` | provider substrate | **keep** (as `bl deps`/hex entry; see Q1) | omega has no Mix; confirm `bl deps fetch` can build req_llm + its tree (finch, llm_db, zoi, …) |
| `src/relay/engine.bl` (133) | prepare → call → record; `stream`/`generate`/`tool` | **adapt** | drop `:key-id`, `accounts/for-provider`, `inference/*`; return a pure usage record instead of transacting; add `:cancel`/timeouts |
| `src/relay/completion.bl` (108) | the one req_llm touch + swappable `backend` atom | **keep** (adapt) | replace private `->keyword-list`/`normalize` with `interop/->kwlist`/`interop/result` (`priv/std/interop.bl:79,38`); add retry from knowledger; make backend per-env (`^:per-env`) for test isolation |
| `src/relay/providers.bl` (141) | alias/passthrough router, `to-existing-atom` guard | **keep** | drop `{:env}` → use `omega.env`; keep `:key-missing` as a value |
| `src/relay/config.bl` (88) | alias table | **adapt** | keep the shape; ship a short default table; user config overlays; drop `admin-token`, `default-rate-limit` |
| `src/relay/provider.bl` (138) | `Provider` protocol + registry | **keep** | pass `account` as nil forever or drop param; `-map-error` → omega error kind |
| `src/relay/provider/openai-compat.bl` (115) | OpenAI-shaped adapter + `tool` | **keep** | covers openai, deepseek, kimi-over-openai, glm, groq, … |
| `src/relay/provider/anthropic.bl` (148) | Anthropic adapter, caching knobs | **keep** (trim) | drop OAuth branch + Claude-Code spoof unless subscription auth is wanted (ToS-gated; see Q4); keep `:anthropic_prompt_cache*` |
| `src/relay/provider/kimi.bl` (85), `codex.bl` (75) | subscription adapters w/ OAuth headers | **drop** (v0) | require `relay.oauth`; revisit if subscription auth wanted |
| `src/relay/messages.bl` (73) | wire messages → req_llm loose maps, atom-safe roles | **adapt** | take omega-native messages (atom keys, assistant `:tool_calls`, tool results, content parts) — this is where the §3 gap is closed; keep fixed role allowlist |
| `src/relay/usage.bl` (195) | unified 6-field token model | **keep** | pure, no deps; matches pi `Usage` plus cache TTL |
| `src/relay/spend.bl` (122) | cents + datom + telemetry | **adapt** | split into pure `cost-cents` + `usage-record`; transact keyed by task id; keep `:telemetry` emit |
| `src/relay/error.bl` (100) | OpenAI error envelope | **adapt** | replace envelope with omega error taxonomy (use knowledger's kinds); keep "errors are data" |
| `src/relay/env.bl` (92) | env reads w/ `^:per-env` override | **keep** | the hermetic-test affordance; includes `clear-env!` tombstone. NB fix: `reset!` naming already fixed upstream (commit `42c762c`) |
| `src/relay/inference.bl` (194) | per-request id, feedback, JSONL | **drop** (maybe later) | omega's task trace replaces it; keep only `generate-id` idea |
| `src/relay/store.bl`, `keys.bl`, `auth.bl`, `budgets.bl`, `gate.bl`, `ratelimit.bl` | virtual keys, budgets, bearer gate, rate limits | **drop** | gateway concerns |
| `src/relay/http.bl`, `request.bl`, `response.bl`, `sse.bl`, `json.bl`, `dialect.bl`, `lib/relay/bridge.ex` | HTTP edge, OpenAI/Anthropic dialects | **drop** | omega is not a gateway. (`request.bl`'s `cache-ttl`/`caching-on?` logic: lift the idea into omega's `opts`) |
| `src/relay/accounts.bl`, `oauth.bl` | subscription OAuth | **drop** (v0) | 540+243 lines; flag-gated even in relay |
| `src/relay/analytics.bl`, `dashboard/*`, `sandbox.bl`, `grant.bl`, `bash-shell.bl`, `wayland-shell.bl` | admin/observability/unrelated | **drop** | — |
| `lib/relay/application.ex` | boot: `BeamLisp.init`, search paths, `ensure_loaded` | **drop** (learn) | shows the embed pattern & the release/embedding gotchas (`RELEASE_ROOT`, `Mix.Project.deps_paths`) |
| `test/relay/engine-test.bl`, `provider-test.bl`, `routing-test.bl`, `caching-test.bl`, `wire-test.bl` | contract tests, offline | **adapt** | port with the vendored modules as their conformance suite |
| *new*: `omega.llm` | chunk→event fold (§2.4), cassette wrapper (§2.5), retry/timeouts, data-policy gate, Jev sibling client | **write** | thin layer over vendored engine |

Resulting vendored set: engine, completion, providers, config, provider, openai-compat, anthropic, messages,
usage, spend, error, env = **12 files** (1453 lines as-is; ≈900 after removing the dropped branches).
Namespaces rename `relay.*` → `omega.llm.*` (or equivalent).

## 8. beam-lisp mapping

| Need | Existing | Gap |
|---|---|---|
| Elixir↔bl shape conversion | `priv/std/interop.bl`: `result ok? err? unwrap unwrap-or ->kwlist kwlist-> ->json json-> module` | none; relay predates it and carries private copies |
| JSON | `bl.json/encode|decode`; relay uses `Jason/encode!` + a `jsonable` walk (`relay/json.bl`) | note `bl.json/decode` returns **vectors** for arrays and string keys for objects (interop.bl:113-121) |
| Lazy streams | `Stream/flat_map`, `Stream/concat`, `Enum/to_list` (verified runnable here: `(Stream/flat_map (list 1 2 3) (fn [x] (list x x)))` → `(1 1 2 2 3 3)`) | no bl-native `reduce` over a stream with early exit/cancel documented — verify |
| Protocols/records | `defprotocol`, `defrecord`, `extend-type` (used in `provider.bl`) | — |
| Mutable seams | `atom`, `swap!`, `^:per-env` (relay env.bl) | — |
| Process/task messaging | `priv/std/proc.bl` (other notes) | an LLM call should run in its own process and send events — to be designed |
| Datom | `datom`, `datom.store-*` | — |
| Pure-bl HTTP | `priv/lib/gen/llm.bl` (OTP inets) — non-streaming only | streaming SSE in pure bl would need `httpc` `{stream, self}` or `gun`; req_llm already solves it |
| Dependencies | `bl deps fetch|compile` (hex tarballs, content-addressed; `bl.lock` mirrors `mix.lock`) | **unverified** that req_llm + transitive deps compile under `bl deps` (relay uses Mix path-dep on beam-lisp instead) |
| `bl run` ad-hoc | in this research VM, `bl run` did **not** have `ReqLLM` bound (`undefined var: user/ReqLLM` when probed standalone) — it is an Elixir module reference that resolves only where the dep is on the code path | omega's `bl.lock`/deps story must put req_llm on the path for `bl run` |

[OBS] In a bare `bl run`, `(module "Elixir.ReqLLM")` also failed (`module` is in the opt-in `interop`
namespace, not auto-referred) — require it explicitly (`(:require [interop])`) when needed.

## 9. Interactions & observability

* **Human**: `curl` against relay `/v1/chat/completions` (README); relay's dashboard (`/dash`, a live.app)
  shows overview KPIs, keys, logs (inference history), OAuth connect. For omega: a per-task cost/usage strip
  and a streaming transcript fed by the event stream.
* **Agent developing omega**: `engine-test.bl` shows the whole offline loop: `set-backend!` stub +
  `env/set-env!` fake key + `engine/stream` + drain chunks + `finalize` + `datom/q` over `:spend/request-id`.
  Port that as the first test. Run offline suites with a warm `bl` daemon (`bl test`), never against live keys.
* **Live smoke (opt-in, manual)**: one real call per provider alias using env-var *names* only
  (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY`, `KIMI_API_KEY`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY`,
  `GLM_API_KEY`, `MISTRAL_API_KEY`; Jev: `TYPESAFE_API_KEY`). Record the chunks as a cassette so CI replays them.
* **Telemetry**: `[:relay :request :stop]` → rename `[:omega :llm :stop]`; attach a handler that writes a trace
  datom — the same mechanism a human dashboard and a peer task would read.
* **Debug via values**: because every stage returns `{:ok …}|{:error …}`, any stage (`providers/resolve`,
  `provider/-call-opts`, `messages/to-req-llm`) can be called from a REPL to see exactly what would be sent
  *before* spending tokens. [INF] Worth exposing a `dry-run` that stops after step 6 in §2.2.

## 10. Open questions for discussion

1. **req_llm vs pure-bl provider layer.** (a) Keep req_llm (30+ providers, SSE, pricing, years of quirks) —
   cost: Elixir dep + the splode/Elixir-1.20 pin + dependence on how `bl deps` builds it; (b) pure bl over
   OTP `httpc`/`gun` (like `gen/llm.bl`) for OpenAI-compat + Anthropic only — cost: we own SSE, retries,
   cache options, pricing; benefit: "language = harness = runtime", no Elixir dep. Middle path: vendor now,
   replace the two or three providers actually used later behind the same `Provider` port.
2. **Vendor (copy) vs depend (`{:relay, path:}` as spell did).** Copy: omega owns the trimmed 12 files and
   can evolve messages/tools; relay's later changes won't flow. Depend: spell did this and needed
   `ensure_engine!` search-path hacks, `serve: false`, and hit the atom/string-key bug. Alt: extract a
   small shared `llm-core` library from relay that both consume.
3. **Event vocabulary.** Adopt pi's block-indexed start/delta/end + `done|error` message, or the flat chunk
   vocabulary? pi's gives UIs and peer tasks a self-contained `partial` message each event (bigger payloads);
   flat chunks are cheap but push folding to every consumer. Where does the fold live — inside the LLM
   process, or in subscribers?
4. **Subscription (OAuth) providers** (Claude Code / Codex / Kimi): relay supports them behind a loud flag and
   a system-prompt spoof. In scope for omega? ToS risk vs convenience; 800+ lines (`oauth.bl`, `accounts.bl`).
5. **Cost and budgets for tasks.** Drop budgets entirely, or keep a *per-task* cap (a task spawning tasks can
   burn money)? If kept, where is it enforced: in `finalize` (post-hoc) or by a pre-call check on a shared
   ledger datom (stigmergic)?
6. **Retries/timeouts/data-policy.** Adopt knowledger's taxonomy (`:rate-limited :server :client :transport
   :bad-response :no-key`, bounded backoff, `Retry-After` cap) and default-deny `:data-policy`? In the engine,
   or as a wrapper policy a task can override?
7. **Cassettes.** One record/replay seam (digest of canonical request → chunk list) serving chat, tools and Jev?
   File format: EDN (spell-app) vs JSON (knowledger)? Commit cassettes?
8. **Message model.** Use pi-like content blocks (text/thinking/toolCall/toolResult) as omega's canonical
   message and convert once at the req_llm edge — avoiding the atom/string-key bug that bit spell. Agree?
9. **Cancellation.** A task being cancelled mid-stream must stop the HTTP request. req_llm's stream is an
   Enumerable owned by the consuming process (killing the consumer process presumably closes it —
   **unverified**). Needs a test before committing to the process-per-call design.
10. **Thinking tokens.** Surface `:thinking` chunks as events and store them, or drop (relay drops them on the
    OpenAI wire)? Affects transcript size and replay fidelity.
