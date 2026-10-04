# spike: prompt caching across Anthropic Messages, OpenAI Chat Completions and the Responses/Codex API

> Run: `bin/bl run spikes/prompt-cache.bl.md` (offline, free). Live check, at most 3 tiny Anthropic calls through the
> local proxy: `OMEGA_SPIKE_LIVE=1 bin/bl run spikes/prompt-cache.bl.md`. Namespace `omega.spike.prompt-cache`.

**Question (from the user).** "How do you intend to support caching (openai completions / codex responses / anthropic
messages APIs)?"

Nothing under `src/` is touched. This spike (1) records the current vendor rules with their sources, (2) proposes a
provider-neutral contract that `omega.loop` must keep and each `omega.llm` adapter turns into its vendor's mechanism,
(3) measures today's request encoding against that contract, (4) prototypes the adapters as pure functions, (5) measures
what a per-step "attention line" does to the cacheable prefix depending on where it goes, and (6) prices a 40-step task.

## 1. What the vendors do today (read 2026-10-04)

Sources:
[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) ·
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) ·
[OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state) ·
[OpenAI cookbook, Prompt Caching 201](https://developers.openai.com/cookbook/examples/prompt_caching_201) ·
[openai/codex `core/src/client.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs) and
[`codex-api/src/common.rs`](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs).

| | Anthropic Messages | OpenAI Chat Completions | OpenAI Responses (and the Codex backend) |
|---|---|---|---|
| Opt-in | yes: `cache_control` on a block (explicit, max 4 per request) or one top-level `cache_control` (automatic: breakpoint on the last cacheable block, moves forward each turn; uses one of the 4 slots) | none: automatic for every request | none for implicit; GPT-5.6+ also takes `prompt_cache_options.mode` and `prompt_cache_breakpoint` on a block (explicit, up to 4 writes) |
| What is cached | the prefix in order `tools` → `system` → `messages`, up to and including the breakpoint block | the whole rendered prefix (tools, messages, images, schemas) | same |
| Minimum | 512 tokens (Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.x, Mythos 5.x), 1,024 (Sonnet 5, 4.6, 4.5, Opus 4.8), 2,048 (Opus 4.7), 4,096 (Haiku 4.5, Opus 4.6, Opus 4.5). Shorter prompts are silently not cached, no error | 1,024 tokens; hits come in 128-token steps (models before GPT-5.6); GPT-5.6+ reports the exact boundary | same |
| Lookup | writes only at breakpoints; a read walks back at most 20 block positions from each breakpoint looking for an entry an earlier request wrote (a run of consecutive `tool_use` blocks counts as one position, same for `tool_result`) | longest matching cached prefix on a machine | same; routed by a hash of the first ~256 tokens plus `prompt_cache_key` |
| TTL | 5 min default, refreshed free on each hit; `"ttl": "1h"` costs more; a 1h entry must precede any 5m entry in the request | `prompt_cache_retention`: `in_memory` (5–10 min idle, up to 1 h) or `24h` on listed models | same (GPT-5.6+: `prompt_cache_options.ttl` = `30m`) |
| Price (relative to base input) | write 1.25× (5m) or 2× (1h); read 0.1× (0.05× Opus 5.5, 0.025× Fable/Mythos 5.1) | no write fee; read model-dependent (0.1× for GPT-5.x family; GPT-5.6+ also bills writes at 1.25×) | same as Chat |
| Routing hint | none (the same org-wide prefix hash) | `prompt_cache_key`, about 15 requests per minute per prefix+key | `prompt_cache_key`; on the ChatGPT backend the Codex CLI also sends the `session-id` header |
| Usage fields | `input_tokens` (EXCLUDES cached), `cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` | `prompt_tokens` (INCLUDES cached), `prompt_tokens_details.cached_tokens` | `input_tokens` (includes), `input_tokens_details.cached_tokens`, GPT-5.6+ `cache_write_tokens` |
| What breaks it | any change to tools (invalidates everything), to `system` (invalidates system + messages), to tool_choice, images, thinking config, `effort` (invalidates messages) | any change before the break point; tools order and schema; `reasoning.effort`; compaction | same |
| Conversation state | stateless: resend everything | stateless: resend everything | stateless replay (`store:false`, replay every output item, including encrypted reasoning with `include:["reasoning.encrypted_content"]`) OR `previous_response_id` + `store:true` (server holds the chain; all prior input tokens are STILL billed as input, discounted only if cached) |

NB: `usage/unify` (already in omega) reads all three usage shapes, including the Responses `input_tokens_details`
variant; section 3 confirms it on sample payloads.

What the open-source Codex CLI sends (from `client.rs`, `ResponsesApiRequest`): `store:false`, `stream:true`,
`include:["reasoning.encrypted_content"]`, `tool_choice:"auto"`, `prompt_cache_key` = the session id (a sub-agent uses
`<source>:<parent thread id>` so it shares the parent's key), headers `session-id`, `thread-id`, `x-client-request-id`
(its own comment: "ChatGPT derives cache affinity from the Responses session-id header"), and routing fields first in
the body ("gateways may inspect request bodies incrementally"). Over a WebSocket it sends `previous_response_id` plus only
the new items, but only when every request property (`model`, `instructions`, `tools`, `reasoning`, `include`,
`prompt_cache_key`, `text`, …) is unchanged from the previous request; otherwise it falls back to the full replay.
Codex is therefore stateless-replay by default with `previous_response_id` as a transport optimisation, and it never
rewrites old items.

## 2. The contract

What `omega.loop` guarantees (provider-neutral, because every vendor's cache is a prefix cache):

1. **Append-only history.** Turn k of request n is byte-identical in request n+1. No re-rendering of old tool results,
   no rewriting, no "refresh the file listing at the top". The only deliberate exceptions are compaction and fork, both
   named cache resets (invariant 6).
2. **Canonical encoding.** One encoder, pure in the turn data: same turn → same bytes, regardless of map insertion order
   or process. Section 3 tests it on today's encoder.
3. **Stable head.** `system`, the tool list (order, names, descriptions, schemas) and the model/effort settings do not
   change inside a task. A tool or setting change is a cache reset.
4. **Volatile content rides at the TAIL, and is request-time only.** The request map gains `:tail [block …]`: blocks the
   adapter appends after the last cacheable block of the last user message. They are NOT recorded as turns, so the next
   request has them gone and the prefix is intact. Attention lines, a clock, "the human is looking at X" all go here.
5. **Opaque provider blocks round-trip verbatim.** Reasoning items (Responses), thinking blocks (Anthropic) are stored in
   the turn as `{:type :opaque :provider … :wire item}` and replayed byte-for-byte by the same adapter. Dropping or
   re-encoding them is a cache miss (and for Responses with `store:false`, a quality loss).
6. **Compaction/fork is an explicit reset.** `omega.loop` marks it (`:reset :compaction`); the adapter records it in
   the telemetry so a 0% hit rate on that step is an expected event, not an alarm.
7. **Telemetry.** Every response's `:usage` is already unified; the loop keeps `hit-rate` per step and flags a step
   whose hit-rate is under a threshold on a long prefix (the `usage/hit-rate` docstring already says that is the smell
   of a leaked timestamp).

What each adapter does:

| adapter | mechanism |
|---|---|
| `:anthropic` | explicit breakpoints: (a) last system block, which also covers all tools, only when tools+system reach the model minimum (otherwise it wastes nothing but is useless); (b) the last block of the last message BEFORE the `:tail`; (c) a ladder breakpoint on the user message at least 8 messages back, which was the tail of an earlier request and so has a guaranteed entry (insurance against the 20-position lookback after a steer burst). Three of four slots. System block TTL configurable (`:cache-ttl :5m|:1h`; a 1h system breakpoint precedes the 5m rolling ones, as the API requires). The Claude Code identity block stays first and constant. |
| `:openai-chat` | nothing explicit. Send `prompt_cache_key` = task id (never a per-step id, never a user secret), optional `prompt_cache_retention`. Tool-call `arguments` strings come from the canonical encoder so they are stable. `:tail` becomes a final user message. |
| `:openai-responses` | stateless replay by default (`store:false`, `include reasoning.encrypted_content`, `prompt_cache_key` = task id, plus the `session-id` header on the ChatGPT/Codex backend), because omega's history is its own durable record and a server-held chain would be a second source of truth. `previous_response_id` is a later transport optimisation (send only new items) valid only while all request properties are unchanged, as Codex does. `:tail` becomes the final input item. |

## 3. Helpers: encoder, segments, prefix measures

Everything below is spike code. `jsonable` here is `omega.llm/jsonable` with ONE change (`reduce-kv`), explained in the
bug demo below; the rest of the spike uses it so the measurements are not hostage to that bug.

```beam-lisp
(ns omega.spike.prompt-cache
  (:require [omega.llm :as llm] [omega.llm.sse] [omega.loop :as loop] [omega.env :as env] [omega.task :as task]
            [omega.codemode :as cm] [omega.cli :as cli] [omega.llm.usage :as usage]))

(defn jsonable [x]
  (cond
    (map? x) (reduce-kv (fn [acc k v] (assoc acc (if (keyword? k) (name k) k) (jsonable v))) {} x)
    (vector? x) (to-list (map jsonable x))
    (seq? x) (to-list (map jsonable x))
    (keyword? x) (name x)
    (nil? x) :null
    :else x))

(defn encode [x] (erlang/iolist_to_binary (json/encode (jsonable x))))
(defn bytes-of [x] (erlang/byte_size x))

(defn no-cc
  "Strip every cache_control marker, so two plans can be compared as content."
  [x]
  (cond (map? x) (reduce-kv (fn [a k v] (if (= k :cache_control) a (assoc a k (no-cc v)))) {} x)
        (vector? x) (vec (map no-cc x))
        :else x))

(defn segments
  "An Anthropic body as the vendor renders it: tools, then system, then every message block, in order.
   (JSON key order of the body is irrelevant to the cache; this is the order that is.)"
  [body]
  (vec (concat [(str "tools:" (encode (:tools body)))
                (str "system:" (encode (:system body)))]
               (mapcat (fn [m] (map (fn [b] (str (:role m) ":" (encode b))) (:content m)))
                       (:messages body)))))

(defn vec-prefix? [a b] (and (<= (count a) (count b)) (= a (subvec b 0 (count a)))))
(defn joined [segs] (clojure.string/join "|#|" segs))
(defn lcp [a b] (binary/longest_common_prefix (list a b)))
(defn pct [a b] (/ (Float/round (* 1000.0 (/ a b))) 10.0))
(defn mean [xs] (/ (Float/round (* 10.0 (/ (reduce + xs) (count xs)))) 10.0))

(def p (llm/provider {:kind :anthropic :model "claude-sonnet-5-5"}))
(println "helpers loaded; provider" (:model p) "identity?" (some? (:identity p)))
```

## 4. A simulated 10-step task through the real loop

A real `omega.task` system with a scripted model: nine `eval` steps with growing tool output, then an answer. The step fn
captures each request exactly as `omega.loop/request` builds it, so what is measured is omega's real request shape (real
`SYSTEM-PROMPT`, real `eval` tool, turns read back from datom). Each assistant turn has a text block and a tool call.

```beam-lisp
(def sim-reqs (atom []))
(def sim-root (str "/tmp/omega-prompt-cache-" (erlang/unique_integer (to-list [:positive]))))
(File/mkdir_p! sim-root)

(defn step-code [i] (str "(str (vec (range " (* 100 i) " " (+ (* 100 i) 220) ")))"))
(defn tool-step [i]
  {:content [{:type :text :text (str "Step " i ": inspecting the data before deciding.")}
             {:type :tool-use :id (str "tu-" i) :name "eval" :input {:code (step-code i)}}]
   :stop :tool-use :usage {:input_tokens 100 :output_tokens 20}})
(def script (vec (concat (map tool-step (range 1 10)) [(loop/say "done")])))
(def cursor (atom 0))

(def sim-env (env/open))
(def sim-sys
  (task/start-system sim-env
    {:step (fn [req]
             (let [_ (swap! sim-reqs conj (dissoc req :on-delta))
                   k @cursor
                   _ (reset! cursor (inc k))]
               (nth script (min k (dec (count script))))))
     :tools cm/tools :root sim-root :system-prompt cli/SYSTEM-PROMPT}))
(def sim-id (task/open! sim-sys {:goal "inspect the data"}))
(def sim-view (task/await sim-sys sim-id 120000))
(println "task status:" (:status sim-view) "requests captured:" (count @sim-reqs))

(def reqs @sim-reqs)
(def bodies (vec (map (fn [r] (llm/anthropic-body p r)) reqs)))
(def sizes (vec (map (fn [b] (bytes-of (joined (segments b)))) bodies)))
(println "request sizes (bytes, ≈tokens = /4):" sizes)
(def head-bytes (bytes-of (encode {:t (:tools (first bodies)) :s (:system (first bodies))})))
(println "tools+system bytes:" head-bytes "≈" (quot head-bytes 4) "tokens"
         "(model minimum for the default sonnet-5-5 is 512; opus-4-7 2048; haiku-4-5 4096)")
```

### 4.1 Is step k a prefix of step k+1 under today's encoding?

Two checks per pair: (a) the segment vector (tools, system, each message block) of request k is a prefix of request
k+1's; (b) the byte-level longest common prefix of the rendered form, as a share of request k.

```beam-lisp
(def pairs (partition 2 1 (range (count bodies))))
(def seg-prefix-ok
  (vec (map (fn [[a b]] (vec-prefix? (segments (nth bodies a)) (segments (nth bodies b)))) pairs)))
(def byte-share
  (vec (map (fn [[a b]]
              (let [ja (joined (segments (nth bodies a)))
                    jb (joined (segments (nth bodies b)))]
                (pct (lcp ja jb) (bytes-of ja))))
            pairs)))
(println "segment-prefix holds for pairs:" seg-prefix-ok)
(println "byte prefix, % of request k reused by k+1:" byte-share)

;; encoder determinism: a tool input with 40 keys built in two insertion orders encodes identically
(def fwd (into {} (map (fn [i] [(keyword (str "k" i)) i]) (range 40))))
(def bwd (into {} (map (fn [i] [(keyword (str "k" i)) i]) (reverse (range 40)))))
(println "40-key map, two insertion orders, same bytes?" (= (encode fwd) (encode bwd)))
;; and an encode → decode → keywordize → encode round trip (what a stored tool input goes through)
(def rt-in {:code "(+ 1 1)" :opts {:a 1 :b [1 2.5 nil] :c "é\nq"}})
(defn kw [m]
  (cond (map? m) (reduce-kv (fn [a k v] (assoc a (if (string? k) (keyword k) k) (kw v))) {} m)
        (seq? m) (vec (map kw m))
        :else m))
(defn round-trip [x] (encode (kw (json/decode (encode x)))))
(def rt-plain {:code "(+ 1 1)" :opts {:a 1 :b [1 2.5] :c "é\nq"}})
(println "round trip (encode → decode → keywordize → encode) of a plain input stable?" (= (encode rt-plain) (round-trip rt-plain)))

;; The streaming path: omega.llm.sse folds the model's tool-call JSON into an omega response. A JSON null in the
;; tool input arrives as the keyword :null and is stored in the turn as such.
(def sse-events
  [{"type" "content_block_start" "index" 0 "content_block" {"type" "tool_use" "id" "x" "name" "eval"}}
   {"type" "content_block_delta" "index" 0
    "delta" {"type" "input_json_delta" "partial_json" "{\"code\":\"1\",\"opts\":{\"flag\":null,\"l\":[null]}}"}}
   {"type" "content_block_stop" "index" 0}])
(def streamed (omega.llm.sse/response (reduce omega.llm.sse/fold omega.llm.sse/empty-acc sse-events)))
(def non-streamed (llm/anthropic-response {"content" [{"type" "tool_use" "id" "x" "name" "eval"
                                                      "input" {"code" "1" "opts" {"flag" :null "l" [:null]}}}]}))
(println "stored tool input, streaming path    :" (pr-str (:input (first (:content streamed)))))
(println "stored tool input, non-streaming path:" (pr-str (:input (first (:content non-streamed)))))
(println "request replays it as (streaming)    :" (encode (:input (first (:content streamed)))))
(println "request replays it as (non-streaming):" (encode (:input (first (:content non-streamed)))))
```

### 4.2 A bug in today's `omega.llm/jsonable`

`jsonable` destructures map entries with `(fn [[k v]] …)`. On the pinned beam-lisp that fails for a map whose key is the
keyword `:meta` ("no function clause matching in BeamLisp.Ns.Rt.nth/2"). A model can put any key in a tool input, the
`eval` schema does not forbid extras, and the key is stored in the assistant turn: from then on EVERY request of that
task throws inside `encode`, so the task is dead, not just that step. `digest` (cassettes) shares the encoder.

```beam-lisp
(defn attempt [f] (try {:ok (f)} (catch e {:err (ex-message e)})))
(def todays (fn [x] (erlang/iolist_to_binary (json/encode (llm/jsonable x)))))
(println "today's jsonable on {:meta 1}      :" (attempt (fn [] (todays {:meta 1}))))
(println "today's jsonable on {:metadata 1}  :" (attempt (fn [] (todays {:metadata 1}))))
(println "reduce-kv jsonable on {:meta 1}    :" (attempt (fn [] (encode {:meta 1}))))
(def poisoned (assoc-in (nth reqs 3) [:messages 1 :content 1 :input :meta] {:why "model added a key"}))
(println "request containing a tool input with :meta → today's anthropic encode:"
         (attempt (fn [] (todays (llm/anthropic-body p poisoned)))))
(println "                                          → reduce-kv encode          :"
         (:ok (attempt (fn [] (bytes-of (encode (llm/anthropic-body p poisoned)))))) "bytes")
```

## 5. `(cache-plan request provider)` → wire body

Pure functions. `cache-plan` takes the provider-neutral request (now with an optional `:tail`) and returns the vendor body;
nothing is sent. The Anthropic adapter reuses `omega.llm/anthropic-body` for the base translation, so it extends rather than
forks it.

```beam-lisp
(def MIN-TOKENS {"claude-sonnet-5-5" 512 "claude-opus-5-5" 512 "claude-opus-5" 512 "claude-sonnet-5" 1024 "claude-sonnet-4-6" 1024
                 "claude-opus-4-8" 1024 "claude-opus-4-7" 2048 "claude-haiku-4-5" 4096 "claude-opus-4-6" 4096})
(def LADDER-GAP 8)

(defn est-tokens [x] (quot (bytes-of (encode x)) 4))
(defn ephemeral [ttl] (cond-> {:type "ephemeral"} (= ttl :1h) (assoc :ttl "1h")))

(defn mark-block
  "cache_control on block `bi` of message `mi` (message content stays a vector of block maps)."
  [body mi bi cc]
  (let [m (nth (:messages body) mi)
        blk (assoc (nth (:content m) bi) :cache_control cc)
        m2 (assoc m :content (assoc (:content m) bi blk))]
    (assoc body :messages (assoc (:messages body) mi m2))))

(defn ladder-index
  "The user message at least LADDER-GAP messages before the last one: it was the tail of an earlier request."
  [msgs]
  (let [last-i (dec (count msgs))]
    (loop [i (- last-i LADDER-GAP)]
      (cond (< i 1) nil
            (= "user" (:role (nth msgs i))) i
            :else (recur (dec i))))))

(defn append-tail
  "Request-time blocks after the cache boundary: into the last user message (or a new one)."
  [body tail]
  (if (empty? tail)
    body
    (let [msgs (:messages body)
          li (dec (count msgs))
          wire (vec (map (fn [b] {:type "text" :text (:text b)}) tail))]
      (if (= "user" (:role (nth msgs li)))
        (assoc body :messages (assoc msgs li (update (nth msgs li) :content (fn [c] (into c wire)))))
        (assoc body :messages (conj msgs {:role "user" :content wire}))))))

(defn plan-anthropic [pv req]
  (let [body (llm/anthropic-body pv (dissoc req :tail))
        minimum (or (:min-tokens pv) (get MIN-TOKENS (:model pv) 1024))
        head-ok (>= (est-tokens [(:tools body) (:system body)]) minimum)
        sys (:system body)
        body (if (and head-ok (seq sys))
               (assoc body :system (assoc sys (dec (count sys)) (assoc (last sys) :cache_control (ephemeral (:cache-ttl pv)))))
               body)
        msgs (:messages body)
        li (dec (count msgs))
        total-ok (>= (est-tokens [(:tools body) (:system body) msgs]) minimum)
        body (if (and total-ok (>= li 0))
               (mark-block body li (dec (count (:content (nth msgs li)))) (ephemeral :5m))
               body)
        lad (when total-ok (ladder-index msgs))
        body (if lad (mark-block body lad (dec (count (:content (nth msgs lad)))) (ephemeral :5m)) body)]
    (append-tail body (:tail req))))

(defn count-breakpoints [x]
  (cond (map? x) (+ (if (contains? x :cache_control) 1 0) (reduce + 0 (map count-breakpoints (vals x))))
        (vector? x) (reduce + 0 (map count-breakpoints x))
        :else 0))

;; ── OpenAI Chat Completions ────────────────────────────────────────────

(defn texts [content] (clojure.string/join "\n" (keep (fn [b] (when (= :text (:type b)) (:text b))) content)))

(defn msg->chat [m]
  (case (:role m)
    :assistant
    [(let [calls (vec (keep (fn [b] (when (= :tool-use (:type b))
                                      {:id (:id b) :type "function"
                                       :function {:name (:name b) :arguments (encode (or (:input b) {}))}}))
                            (:content m)))]
       (cond-> {:role "assistant" :content (texts (:content m))}
         (seq calls) (assoc :tool_calls calls)))]
    (concat (map (fn [b] {:role "tool" :tool_call_id (:id b) :content (str (:content b))})
                 (filter (fn [b] (= :tool-result (:type b))) (:content m)))
            (let [t (texts (:content m))] (when (seq t) [{:role "user" :content t}])))))

(defn plan-openai-chat [pv req]
  (cond-> {:model (:model pv)
           :messages (vec (concat [{:role "system" :content (:system req)}]
                                  (mapcat msg->chat (:messages req))
                                  (map (fn [b] {:role "user" :content (:text b)}) (:tail req))))
           :tools (vec (map (fn [t] {:type "function"
                                     :function {:name (:name t) :description (:description t)
                                                :parameters (:input-schema t)}})
                            (:tools req)))
           :prompt_cache_key (:cache-key pv)}
    (:cache-retention pv) (assoc :prompt_cache_retention (:cache-retention pv))))

;; ── OpenAI Responses / Codex ───────────────────────────────────────────

(defn msg->items [m]
  (mapcat (fn [b]
            (case (:type b)
              :text [{:type "message" :role (name (:role m))
                      :content [{:type (if (= :assistant (:role m)) "output_text" "input_text") :text (:text b)}]}]
              :tool-use [{:type "function_call" :call_id (:id b) :name (:name b) :arguments (encode (or (:input b) {}))}]
              :tool-result [{:type "function_call_output" :call_id (:id b) :output (str (:content b))}]
              :opaque [(:wire b)]
              []))
          (:content m)))

(defn responses-static [pv req]
  {:model (:model pv) :stream true :instructions (:system req)
   :tools (vec (map (fn [t] {:type "function" :name (:name t) :description (:description t)
                             :parameters (:input-schema t) :strict false})
                    (:tools req)))
   :tool_choice "auto" :parallel_tool_calls false
   :prompt_cache_key (:cache-key pv)})

(defn plan-responses
  "Stateless replay: store false, every item replayed, encrypted reasoning requested."
  [pv req]
  (assoc (responses-static pv req)
         :store false
         :include ["reasoning.encrypted_content"]
         :input (vec (concat (mapcat msg->items (:messages req))
                             (map (fn [b] {:type "message" :role "user"
                                           :content [{:type "input_text" :text (:text b)}]})
                                  (:tail req))))))

(defn plan-responses-chain
  "previous_response_id variant: server holds the chain, only items after `sent` messages go on the wire.
   Valid only while model/instructions/tools/key are unchanged (checked by the caller, as Codex does)."
  [pv req prev-id sent]
  (-> (responses-static pv req)
      (assoc :store true :previous_response_id prev-id
             :input (vec (mapcat msg->items (drop sent (:messages req)))))))

(defn cache-plan
  "Provider-neutral request + provider map → vendor wire body (a bl map, not yet encoded)."
  [req pv]
  (case (:kind pv)
    :anthropic (plan-anthropic pv req)
    :openai-chat (plan-openai-chat pv req)
    :openai-responses (plan-responses pv req)
    (throw (ex-info (str "no cache plan for " (:kind pv)) {}))))

(println "cache-plan defined; kinds: anthropic openai-chat openai-responses")
```

### 5.1 Wire shapes on a small request

A 3-message request with a one-line tail, to keep the printed JSON readable. The first Anthropic body has no marker at all:
the whole prompt is far below the model minimum, so the planner skips every breakpoint (a marker there would be a silent no-op
anyway). The second body sets `:min-tokens 1` to show where the markers go: the last system block, and the last block of the
last message before the tail, which is the `tool_result` and not the attention line.

```beam-lisp
(def mini {:system "You are omega."
           :tools [{:name "eval" :description "run code" :input-schema {:type "object" :properties {:code {:type "string"}}}}]
           :messages [{:role :user :content [{:type :text :text "goal"}]}
                      {:role :assistant :content [{:type :text :text "looking"}
                                                  {:type :tool-use :id "tu-1" :name "eval" :input {:code "(+ 1 1)"}}]}
                      {:role :user :content [{:type :tool-result :id "tu-1" :content "=> 2" :error? false}]}]
           :tail [{:type :text :text "[attention] human is viewing src/a.bl:12"}]})

(def big-prov (assoc p :model "claude-sonnet-5-5"))
(println "── anthropic (min-token gate: head est" (est-tokens [(:tools mini) (:system mini)]) "tokens; total est"
         (est-tokens (:messages mini)) ")")
(println (encode (plan-anthropic (assoc p :identity nil) mini)))
(println "── anthropic, forced to a 1-token minimum to show the breakpoints")
(def forced (plan-anthropic (assoc p :identity nil :min-tokens 1) mini))
(println (encode forced))
(println "── openai-chat")
(println (encode (cache-plan mini {:kind :openai-chat :model "gpt-5.5" :cache-key "t-42" :cache-retention "24h"})))
(println "── openai-responses (stateless replay)")
(println (encode (cache-plan mini {:kind :openai-responses :model "gpt-5.5" :cache-key "t-42"})))
(println "── openai-responses (previous_response_id chain, 2 messages already sent)")
(println (encode (plan-responses-chain {:kind :openai-responses :model "gpt-5.5" :cache-key "t-42"} mini "resp_123" 2)))
```

### 5.2 Anthropic breakpoint placement on the real 10-step requests

The plan on the last simulated request (19 messages), with the model minimum lowered so the tiny real head qualifies: which
blocks carry a marker, how many markers, and whether the planned body still satisfies the prefix property once the markers are
removed.

```beam-lisp
(def lowmin (assoc p :model "claude-sonnet-5-5"))
(def planned (vec (map (fn [r] (plan-anthropic lowmin (assoc r :tail [{:type :text :text "[attention] x"}]))) reqs)))
(def last-plan (last planned))
(println "last request: messages" (count (:messages last-plan))
         "breakpoints" (count-breakpoints last-plan) "(max 4)")
(println "system marked?" (some? (:cache_control (last (:system last-plan))))
         "· marked message indexes:"
         (vec (keep-indexed (fn [i m] (when (some (fn [b] (contains? b :cache_control)) (:content m)) i)) (:messages last-plan))))
(println "every plan ≤ 4 breakpoints?" (every? (fn [b] (<= (count-breakpoints b) 4)) planned))
;; prefix property of the planned bodies, content only, tail excluded (tail is the last block of the last message)
(defn without-tail [body]
  (let [msgs (:messages body) li (dec (count msgs))
        m (nth msgs li)]
    (assoc body :messages (assoc msgs li (assoc m :content (vec (butlast (:content m))))))))
(println "planned bodies keep the prefix property (markers and tail stripped):"
         (every? true? (map (fn [[a b]] (vec-prefix? (segments (no-cc (without-tail (nth planned a))))
                                                     (segments (no-cc (without-tail (nth planned b))))))
                            pairs)))
```

## 6. Where does a per-step "attention line" go?

bl-ed will tell the model what the human is looking at, every step, and the line changes every step. Four placements, over
the same 10 real requests. Metric: for step k+1, how many bytes of its prompt are NOT a common prefix of step k's prompt
(these are re-processed at full price). Lower is better; the floor is the bytes the step genuinely added.

- **base**: no attention line (the floor).
- **A system**: the line is appended to the system prompt, rewritten every step.
- **B tail**: the line is a `:tail` block on the last user message, request-time only (the contract).
- **C persisted**: the line is recorded into each user turn and stays in history forever (stable bytes, but history grows).

```beam-lisp
(defn attn-line [i] (str "[attention] human is viewing src/mod" i ".bl line " (* 7 i)))

(defn variant-body [kind r i]
  (case kind
    :base (llm/anthropic-body p r)
    :A (llm/anthropic-body p (assoc r :system (str (:system r) "\n" (attn-line i))))
    :B (append-tail (llm/anthropic-body p r) [{:text (attn-line i)}])
    :C (llm/anthropic-body p (assoc r :messages
                                    (vec (map-indexed (fn [mi m] (if (and (= :user (:role m)) (> mi 0))
                                                                  (update m :content conj {:type :text :text (attn-line mi)})
                                                                  m))
                                                      (:messages r)))))))

(defn uncached-bytes
  "Per step k+1: bytes of its rendered prompt beyond the common prefix with step k."
  [kind]
  (let [js (vec (map-indexed (fn [i r] (joined (segments (variant-body kind r i)))) reqs))]
    (vec (map (fn [[a b]] (- (bytes-of (nth js b)) (lcp (nth js a) (nth js b)))) pairs))))

(def base-u (uncached-bytes :base))
(def results {:base base-u :A (uncached-bytes :A) :B (uncached-bytes :B) :C (uncached-bytes :C)})
(doseq [k [:base :A :B :C]]
  (let [u (get results k)]
    (println (name k) "uncached bytes per step:" u "mean" (mean u) "≈tokens" (quot (erlang/trunc (mean u)) 4))))
(println "request sizes at the last step (bytes): base" (bytes-of (joined (segments (variant-body :base (last reqs) 10))))
         "C" (bytes-of (joined (segments (variant-body :C (last reqs) 10)))))
```

## 7. Cost model: 40 steps, system+tools 6k tokens, prefix +1.5k tokens per step

Request i has `N_i = 6000 + 1500·i` input tokens. Output tokens are identical in every scenario and left out. Prices are
relative to the base input rate (1.0); dollars use Sonnet 5.5 at $2 per million input tokens (from the Anthropic pricing
table). "Idle gap" means a pause longer than the 5-minute TTL before steps 10, 20 and 30 (a human reading, a long test run).
The OpenAI automatic scenario reads `floor128(N_{i-1})` at 0.1× with no write fee and assumes the prefix stayed on one machine
(`prompt_cache_key` set). Real hit rates are lower: routing and TTL are best effort. The GPT-5.6 row writes at 1.25×.

```beam-lisp
(def STEPS 40)
(def HEAD 6000)
(def PER 1500)
(defn n-at [i] (+ HEAD (* PER i)))
(defn gap? [i] (contains? #{10 20 30} i))
(defn floor128 [n] (* 128 (quot n 128)))

(defn total [per-step] (reduce + 0 (map per-step (range 1 (inc STEPS)))))

(defn cost-none [i] (* 1.0 (n-at i)))
(defn cost-anth
  "Anthropic, step i. It reads the previous request's prefix (0.1) and writes the delta (w). After an idle gap
   (when `gaps?`) the 5m entry is gone: re-write everything (w), except `head-1h` tokens kept alive by a 1h system
   breakpoint (read at 0.1; written once at 2.0 on step 1)."
  [w head-1h gaps?]
  (fn [i]
    (cond
      (= i 1) (+ (* 2.0 head-1h) (* w (- (n-at 1) head-1h)))
      (and gaps? (gap? i)) (+ (* 0.1 head-1h) (* w (- (n-at i) head-1h)))
      :else (+ (* 0.1 (n-at (dec i))) (* w (- (n-at i) (n-at (dec i))))))))
(defn cost-anth-1h-all [i]
  (if (= i 1) (* 2.0 (n-at 1)) (+ (* 0.1 (n-at (dec i))) (* 2.0 (- (n-at i) (n-at (dec i)))))))
(defn cost-anth-volatile-system [i] (* 1.25 (n-at i)))
(defn cost-openai [i] (if (= i 1) (* 1.0 (n-at 1))
                        (let [c (floor128 (n-at (dec i)))] (+ (* 0.1 c) (- (n-at i) c)))))
(defn cost-openai-56 [i] (if (= i 1) (* 1.25 (n-at 1))
                           (let [c (n-at (dec i))] (+ (* 0.1 c) (* 1.25 (- (n-at i) c))))))
(defn cost-openai-volatile-head [i] (* 1.0 (n-at i)))

(def table
  [["no caching" (total cost-none)]
   ["anthropic 5m, steps back to back" (total (cost-anth 1.25 0 false))]
   ["anthropic 5m, 3 idle gaps (>5 min)" (total (cost-anth 1.25 0 true))]
   ["anthropic 5m + 1h system (6k), 3 idle gaps" (total (cost-anth 1.25 HEAD true))]
   ["anthropic 1h everywhere (writes 2x; gaps irrelevant)" (total cost-anth-1h-all)]
   ["anthropic, volatile line in system" (total cost-anth-volatile-system)]
   ["openai automatic, ideal" (total cost-openai)]
   ["openai GPT-5.6+ (write 1.25x)" (total cost-openai-56)]
   ["openai, volatile line at head" (total cost-openai-volatile-head)]])

(def base-total (total cost-none))
(println "total input tokens, no caching:" (erlang/trunc base-total) "≈ $" (/ (Float/round (* 100.0 (/ (* 2.0 base-total) 1000000))) 100.0) "at $2/MTok")
(doseq [[nm c] table]
  (println (str "  " nm " : " (erlang/trunc c) " token-eq, " (pct c base-total) "% of no-caching, $"
                (/ (Float/round (* 100.0 (/ (* 2.0 c) 1000000))) 100.0))))
```

## 8. Usage normalisation (read from `usage/unify`)

```beam-lisp
(println "anthropic  :" (usage/unify {"input_tokens" 35 "cache_read_input_tokens" 1000 "cache_creation_input_tokens" 200 "output_tokens" 4}))
(println "chat       :" (usage/unify {"prompt_tokens" 2006 "prompt_tokens_details" {"cached_tokens" 1920} "completion_tokens" 9}))
(println "responses  :" (usage/unify {"input_tokens" 2006 "input_tokens_details" {"cached_tokens" 1920 "cache_write_tokens" 80} "output_tokens" 9}))
```

## 9. Live check (optional, at most 3 tiny calls)

Gated on `OMEGA_SPIKE_LIVE=1`. The system prompt carries a random nonce so no earlier cache entry can match, and is long enough
to clear every model minimum. Call 1 writes the system prefix. Call 2 has a different conversation tail plus an unmarked volatile
tail block and should READ the system prefix. Call 3 puts a changing line into the system text BEFORE the breakpoint (the mistake
this spike warns about) and should read nothing.

```beam-lisp
(defn live-post [body]
  (Application/ensure_all_started :ssl)
  (Application/ensure_all_started :inets)
  (let [r (httpc/request :post (tuple (String/to_charlist (str (:base-url p) "/v1/messages"))
                                      (to-list [(tuple (String/to_charlist "anthropic-version") (String/to_charlist "2023-06-01"))])
                                      (String/to_charlist "application/json") (encode body))
                         (list (tuple :timeout 60000))
                         (list (tuple :body_format :binary)))]
    (if (= :ok (elem r 0))
      (let [resp (elem r 1)]
        {:status (elem (elem resp 0) 1) :body (elem resp 2)})
      {:transport (pr-str (elem r 1))})))

(defn live-usage [body]
  (let [r (live-post body)]
    (if (= 200 (:status r))
      (let [d (json/decode (:body r))]
        (usage/unify (get d "usage")))
      (str "http " (:status r) " " (or (:transport r) (:body r))))))

(def live? (= "1" (System/get_env "OMEGA_SPIKE_LIVE")))
(if live?
  (let [nonce (str "n" (erlang/unique_integer (to-list [:positive])))
        filler (clojure.string/join " " (map (fn [i] (str "Rule " i " of the omega test harness: keep outputs short and exact.")) (range 220)))
        sys-text (str "Session " nonce ". " filler)
        id-block {:type "text" :text llm/CLAUDE-CODE-IDENTITY}
        sys-block (fn [t] {:type "text" :text t :cache_control {:type "ephemeral"}})
        base {:model "claude-sonnet-5-5" :max_tokens 8}
        _ (println "system text ≈" (quot (bytes-of sys-text) 4) "tokens")
        u1 (live-usage (assoc base :system [id-block (sys-block sys-text)]
                              :messages [{:role "user" :content "Reply with the single word ok."}]))
        _ (println "call 1 (write)            :" u1)
        u2 (live-usage (assoc base :system [id-block (sys-block sys-text)]
                              :messages [{:role "user" :content "Reply with the single word ok."}
                                         {:role "assistant" :content "ok"}
                                         {:role "user" :content [{:type "text" :text "Again, one word." :cache_control {:type "ephemeral"}}
                                                                 {:type "text" :text "[attention] human is viewing a.bl:1"}]}]))
        _ (println "call 2 (read prefix+tail) :" u2)
        u3 (live-usage (assoc base :system [id-block (sys-block (str "Attention: step 3 line 77. " sys-text))]
                              :messages [{:role "user" :content "Reply with the single word ok."}]))
        _ (println "call 3 (volatile in sys)  :" u3)]
    :live-done)
  (println "live check skipped (set OMEGA_SPIKE_LIVE=1); recorded results are in Findings"))

(task/stop-system! sim-sys)
(ns omega.spike.prompt-cache)
```

## Findings

Offline run: `bin/bl run spikes/prompt-cache.bl.md` (exit 0). Live run (3 calls, one time, 2026-10-04):
`OMEGA_SPIKE_LIVE=1 bin/bl run spikes/prompt-cache.bl.md`. Vendor rules are from the pages cited in section 1 (INFERRED
from documentation; none of the OpenAI behaviour was exercised, no key and no paid calls).

**Recommendation.** One invariant set in `omega.loop`, three small adapters in `omega.llm`: append-only history, one canonical
encoder, a stable head, and request-time volatile content in a new `:tail` after the last cacheable block. Anthropic gets
explicit `cache_control` (needed: it is opt-in); the two OpenAI APIs get `prompt_cache_key` = task id and nothing else (their
caching is automatic). Responses uses stateless replay with encrypted reasoning, as the Codex CLI does.

1. OBSERVED: **today's `omega.loop/request` already satisfies the append-only contract.** Over a real 10-step task (real
   `SYSTEM-PROMPT`, real `eval` tool, turns read back from datom, tool results of growing size) request k is a segment prefix
   of request k+1 in 9 of 9 pairs, and the byte-level common prefix is 100.0% of request k in every pair. Request sizes grew
   2,142 → 12,652 bytes, and each step added about 1,152 bytes (the uncached delta). So caching needs no change to how turns are
   recorded or read.
2. OBSERVED: **map key order is not a hazard on this runtime.** A 40-key map built in forward and reverse insertion order
   encodes to identical bytes (the same map value always encodes the same way here). INFERRED: the order is still an implementation property of the VM; the contract should say "canonical
   encoding" and the planner's encoder should be the one place that enforces it (sort keys), instead of relying on it.
3. OBSERVED, **BUG A (stops the task): `omega.llm/jsonable` throws on a map with the key `:meta`.** `(fn [[k v]] …)` over a map
   entry fails in `BeamLisp.Ns.Rt.nth/2` for exactly that key (it did not fail for `:metadata`, `:name`, `:type`, `:id`,
   `:value` and 25 other keys I tried; the cause is a pin quirk I did not trace, so treat "any key" as unverified beyond that list). A model
   can put any key into an `eval` input; the tool-use block is stored in the turn; from then on every request of that task
   throws inside `encode`, so the task fails at every later step and cannot recover. `digest` (cassettes) has the same
   encoder. The same destructuring is in `decoded->data` (`llm.bl`) and `keywordize` (`llm.bl`, `llm/sse.bl`) and `jev.bl`; they
   fail on a `:meta` key in the same way. Fix: `reduce-kv`, which the spike uses and which printed `{"meta":1}`. Add a test with
   a `:meta` tool input.
4. OBSERVED, **BUG B (silent cache and fidelity loss): a JSON `null` inside a tool input is replayed as the string `"null"`.**
   Both the streaming path (`omega.llm.sse`) and the non-streaming path (`anthropic-response`) store a null as the keyword
   `:null`; `jsonable` turns every keyword into its name, so the next request carries `"flag":"null"` where the model wrote
   `"flag":null`. The prefix is still byte-stable from request to request (the stored form is the same each time), so the cache
   does not break, but the model sees its own earlier call rewritten, and a cassette digest differs from what the vendor
   was sent. Fix: `jsonable` must pass `:null` through (`(= :null x) :null`) before the keyword branch, and `decoded->data` /
   `sse` should store a real nil (or keep `:null` and round-trip it).
5. OBSERVED: **plain tool inputs round-trip stably** (encode → decode → keywordize → encode gives the same bytes for numbers,
   floats, nested maps, vectors and non-ASCII text with `\n`), so streaming a response and then replaying it does not shift
   the prefix. Only the null case in finding 4 differs.
6. OBSERVED: **Anthropic placement is cheap and fits the budget.** On the 19-message request the planner puts 3 markers (last
   system block, message 10 = the ladder, message 18 = the last block before the tail); never more than 4 on any of the 10
   steps; with markers and tail stripped, every planned body keeps the prefix property (9 of 9 pairs). The head breakpoint is only
   emitted when tools+system reach the model's minimum: omega's real head is 2,088 bytes (about 522 tokens by bytes/4 and
   ), which by bytes/4 clears Sonnet 5.5's 512 (the live run below shows bytes/4 under-counts by about 1.5×, so the real figure is nearer 800) but NOT Opus 4.7 (2,048) or Haiku 4.5
   (4,096). With the default model, then, system+tools alone barely cache; the rolling message breakpoint is what matters.
   The DESCRIPTION is tiny, so adding the project/context prompt later raises it above every minimum.
7. OBSERVED (live, through the local proxy): **the proxy passes `cache_control` through and the cache works as documented.**
   Call 1 (system prefix of about 3.6k estimated tokens, marker on the last system block): `cache-write 5311, cache-read 0`.
   Call 2 (same system, longer conversation, volatile unmarked tail block after the marked block): `cache-read 5311, cache-write
   24, input 19`. So the prefix was read and the unmarked tail was not written. Call 3 (a changing line placed before the
   system breakpoint): `cache-read 0, cache-write 5323`: the whole 5.3k prefix is rewritten, 1.25× paid again, exactly the
   failure the contract forbids. The proxy also reports the 5m/1h split correctly (`cache-write-5m 5311`), which
   `usage/unify` reads (direct path). Token estimates by bytes/4 under-count by about 1.5× on this text, so the planner's
   minimum gate is conservative only if it is compared against a lower bound; treat `est-tokens` as a lower bound.
8. OBSERVED: **where the attention line goes changes the uncached bytes per step by 5×.** Mean uncached bytes per step over the
   same 10 requests: base (no line) 1,168 (≈291 tokens), **B tail 1,246 (≈311)**, **C persisted in each user turn 1,250
   (≈312)**, **A rewritten in the system prompt 5,856 (≈1,464) and growing with the prefix** (1,229 → 10,588: step k pays for
   the whole conversation). Tail costs 78 bytes over the floor (the line itself); persisted costs the same per step but grows
   the stored transcript forever (13,388 vs 12,652 bytes at step 10); system placement costs the entire prefix every step.
   B is the contract; C is the right choice only when the line is meant to be part of the record.
9. OBSERVED, cost model (40 steps, 6k head, +1.5k per step, 1.47M input tokens uncached, $2.94 at Sonnet 5.5's $2/MTok):

   | scenario | token-equivalents | % of uncached | $ |
   |---|---|---|---|
   | no caching | 1,470,000 | 100% | 2.94 |
   | Anthropic 5m, steps back to back | 222,900 | 15.2% | 0.45 |
   | Anthropic 5m, 3 idle gaps (>5 min) | 341,925 | 23.3% | 0.68 |
   | Anthropic 5m + 1h system breakpoint, 3 gaps | 325,725 | 22.2% | 0.65 |
   | Anthropic 1h everywhere (writes 2×) | 272,400 | 18.5% | 0.54 |
   | Anthropic, volatile line in the system prompt | 1,837,500 | 125.0% | 3.68 |
   | OpenAI automatic, ideal (read 0.1×, no write fee) | 208,559 | 14.2% | 0.42 |
   | OpenAI GPT-5.6+ (write 1.25×) | 222,900 | 15.2% | 0.45 |
   | OpenAI, volatile line at the head | 1,470,000 | 100% | 2.94 |

   Caching is worth 80–85% of input cost on a 40-step task. Idle gaps cost 8 points on 5m TTL; a 1h system breakpoint saves
   little (the system is a small part of a 6k head grown to 66k), and 1h on everything is best only when gaps are frequent
   AND the task is long. A mistake that moves volatile text before the breakpoint turns a 85% saving into a 25% LOSS on
   Anthropic (every step re-written at 1.25×) and is silent: the request still succeeds. INFERRED: OpenAI's real hit rate is
   lower than the ideal row (128-token steps, routing, 5–10 minute in-memory TTL).
10. OBSERVED: **`usage/unify` already reads all three vendors.** Anthropic (input excludes cached), Chat
    (`prompt_tokens_details.cached_tokens`) and Responses (`input_tokens_details.cached_tokens`, `cache_write_tokens`) map to
    the same six fields; `input` is the uncached remainder in each case (35, 86 and 86 in the examples). `hit-rate` is then
    comparable across vendors. GPT-5.6+'s `cache_write_tokens` is not read into `:cache-write` (it prints 0 above); add the
    alias if that family is used.
11. INFERRED (Codex source and docs): **Responses: replay, don't chain, in v1.** `previous_response_id` still bills all earlier
    tokens as input (cached at the read rate if the cache hits), only saves upload bytes, requires `store:true` (the server
    keeps the conversation: a second source of truth next to omega's history, breaking fork, rewind and compaction, which are
    all prefix edits), and the Codex CLI itself uses it only on a WebSocket when every request property is unchanged. Stateless
    replay with `include:["reasoning.encrypted_content"]` costs the same cache hits and keeps history ours. The reasoning items
    must be stored and replayed verbatim (`:opaque` block), or reasoning quality and cache hits both drop. The ChatGPT-subscription
    Codex backend also wants `session-id`/`thread-id` headers and `store:false`; set the header from the same task id.
12. INFERRED: **`prompt_cache_key` = task id is right for omega.** Subagents (`spawn`) would share a prefix with their parent
    only if they share the system prompt and tool list; Codex shares the parent's key for sub-agents of the same family. Omega
    sub-tasks have a different goal in the first user message and the same head, so each can use its own task id and still hit
    the 1,024-token head cache through the prefix hash; sharing the parent's key adds routing locality but can exceed the
    ~15 requests per minute per key. Start with the task id.

### What belongs where

| core, now (in the FIRST change) | later FEAT |
|---|---|
| Fix `jsonable` (BUG A, BUG B) and its twins; add tests with a `:meta` key and a `null` tool input | `:opaque` blocks and reasoning/thinking replay |
| A `:tail` field on the request, never recorded (the first consumer is bl-ed's attention line) | `:openai-chat` and `:openai-responses` adapters (the shapes above are the starting point) |
| `omega.llm/cache-plan` for `:anthropic`, behind `:cache` provider config (default on, `:cache-ttl :5m`), skipping below the model minimum | `previous_response_id` transport optimisation |
| `hit-rate` per step in the task record (it is the leak alarm) | explicit GPT-5.6+ `prompt_cache_breakpoint` |
| Compaction and fork set `:reset` on the next request | cache pre-warm (OpenAI GPT-5.6+ `prompt_cache_options.prewarm`; Anthropic: a 1-token call) |
| A loop test: step k body is a prefix of step k+1 (sections 4 and 6 of this spike, as an assertion) | per-extension prefix registry for tools that must appear later |
