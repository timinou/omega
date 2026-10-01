# CodeMode — pi's `codemode`, and its recreation in beam-lisp

> **Abstract.** pi's `codemode` is one tool whose input is a *program*. The model writes JavaScript. The program runs in a fresh QuickJS-in-WASM VM whose only capability is `await tools.<name>(args)`. Nested tool calls and their results never enter the LLM context. Only the script's `text()`/`console.*` output and its return value come back, with a token budget and spill-to-file. The model learns the API from generated TypeScript declarations, and finds un-listed tools with BM25 `searchTools()`. Tools reach scripts through *exposure modes* (`direct`, `codemode`, `deferred`, `hidden`). This document reads that machinery closely, surveys the wider "code mode" idea (Cloudflare, Anthropic, CodeAct, smolagents), compares it with the Spell harness's PTC-Lisp `execute` tool, and designs the beam-lisp version. In omega the model writes **beam-lisp**, and the sandbox is a **forked, capability-narrowed `env`** instead of a WASM VM. Beam-lisp already ships most of the mechanism: `env/fork {:caps …}`, `env/eval`, `:max_heap_words`, process-kill timeouts, and `spawn` conveyance. The runnable block below proves it end to end. Gaps are listed in §5.

Everything marked **OBSERVED** was read in source or run with `bl run`. Everything marked **INFERRED** is my reading or a design proposal.

---

## 1. Sources

pi (shallow clone at `research/vendor/pi`, HEAD `e792ba131ed0495f3ff58a0eb13f20540e344d5c`; codemode CHANGELOG says 0.99.2, 2026-09-30):

- `packages/codemode/README.md` (1-190), `CHANGELOG.md`
- `packages/codemode/src/types.ts` (1-136), `source.ts` (1-115), `wasm.ts` (1-35), `index.ts` (1-36), `identifier.ts`
- `packages/codemode/src/declarations.ts` (1-351), `runtime/host.ts` (1-361), `runtime/worker.ts` (1-159), `runtime/protocol.ts` (1-51), `runtime/prelude-source.ts` (1-344)
- `packages/codemode/test/sandbox.test.ts` (1-647, esp. 215-345 tools, 346-400 store, 461-587 limits, 588-647 escape hatches), `test/declarations.test.ts`, `test/source.test.ts`
- `packages/agent/examples/mcp-codemode/main.ts` (1-50), `tools.ts` (1-172)
- `packages/coding-agent/examples/sdk/14-codemode-mcp.ts` (1-61)
- `packages/coding-agent/docs/mcp.md` (1-248; exposure table ≈ "Control tool exposure")
- `packages/coding-agent/src/extensions/codemode/tool.ts` (1-451), `execute.ts` (1-480), `index.ts` (1-46), `renderer.ts`
- `packages/coding-agent/src/extensions/tool-search/tool.ts` (1-247)
- `packages/coding-agent/src/core/nested-tool-calls.ts` (1-261)
- `packages/coding-agent/src/core/mcp-servers.ts` (1-30, 198), `core/agent-session.ts` (≈1440-1520: `getCallableToolNames`, `_getCallableTools`, `_applyToolLoadout`), `core/extensions/types.ts` (≈496-509 `ToolExposure`, 526-547 namespaces/loadout, 588-605), `core/settings-manager.ts` (95-106 `CodemodeMode`), `core/compaction/utils.ts` (≈30: nested calls feed file-op extraction), `extensions/mcp/index.ts` (≈7-14, 111-215, 440-480: auto-enable codemode)

beam-lisp (`/home/user/code/undefine/beam-lisp--repl`):

- `examples/sandbox/00-README.md`, `01-the-env-is-a-world.bl`, `03-a-token-becomes-a-sandbox.bl`, `05-the-confused-deputy.bl`
- `priv/std/env.bl` (1-193), `priv/std/effects.bl` (1-141)
- `lib/beam_lisp/env.ex` (≈100-154 `fork`, `max_heap`), `lib/beam_lisp/refs.ex` (≈255-300 `apply_heap_bound`, `future_exec`, `spawn_exec`), `lib/beam_lisp/sandbox.ex` (1-80)
- `docs/the-environment-and-process-conveyance.md` (1-200), `docs/trust-boundary.md` (1-164)
- `!tasks/plans/PLAN-046-env-isolation-sandbox-the-seamless-test-harness.org` (heap/cost notes only)
- `priv/lib/harness.bl` (1-330: `eval-cell`, `run-turn`), `priv/lib/harness/mcp.bl` (1-206), `priv/lib/mcp/{server,jsonrpc,tools,transport-http,transport-stdio}.bl` (listing)
- `docs/raw-strings.bl.md` (literate convention)

Wider idea:

- Cloudflare, "Code Mode: the better way to use MCP": <https://blog.cloudflare.com/code-mode/>
- Anthropic Engineering, "Code execution with MCP: Building more efficient agents" (2025-11-04): <https://www.anthropic.com/engineering/code-execution-with-mcp>
- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), arXiv 2402.01030: <https://arxiv.org/abs/2402.01030>
- Hugging Face smolagents, "What are agents?": <https://huggingface.co/docs/smolagents/conceptual_guides/intro_agents>
- smolagents, "Secure code execution": <https://huggingface.co/docs/smolagents/tutorials/secure_code_execution>
- Cloudflare Agents `codemode` docs (linked from the blog, not read): <https://github.com/cloudflare/agents/blob/main/docs/codemode.md>

Spell `execute` tool: described from its tool description in this session (not a file). It is cited as prior art, not as a verified source.

---

## 2. What pi's CodeMode is, and how it works (OBSERVED)

### 2.1 Layering

Two layers, deliberately split:

1. **`@earendil-works/pi-codemode`** (`packages/codemode`). It has no pi dependencies (README:5). It holds the sandbox (`CodemodeSandbox`), the source format (`parseCodemodeSource`), and the declaration renderer (`renderDeclarations`). A caller supplies `CodemodeTool[]` = `{name, description?, inputSchema?, outputSchema?, execute(args,{signal})}` (`types.ts:225-252`).
2. **coding-agent `extensions/codemode`**. It adapts the agent's tools into `CodemodeTool`s, builds the model-facing description, adds discovery globals (`searchTools`, `describeTool`, `describeNamespace`) and `models.*`, persists `store()` into the session, and truncates output (`tool.ts`, `execute.ts`).

### 2.2 The model-facing tool

One tool, `codemode`, with one parameter (`tool.ts:~80`):

```ts
export const codemodeSchema = Type.Object({
	code: Type.String({ description: 'Raw JavaScript source. Top-level await and return work. May start with a `// @options: {"max_output_tokens": 1000}` line.' }),
});
```

- The code is the **body of an async function** (`worker.ts:~690`: `(async (tools, console) => {${data.code}\n})`). The prefix shares line 1 with the script, so stack-trace line numbers are exact.
- The optional first line `// @options: {"max_output_tokens":…, "timeout_ms":…}` is parsed by `parseCodemodeSource` (`source.ts`). It rejects unknown fields and bad values, and replaces the line with a blank line so line numbers survive. **The sandbox does not act on the options. The caller does** (README:77).
- `constrainedSampling: { type:"grammar", variants:{ openai_lark: CODEMODE_SOURCE_GRAMMAR } }` (`tool.ts`). A Lark grammar lets capable providers emit the script as raw text instead of a JSON-escaped string. This matters: code inside JSON string escapes is a known failure source. Omega gets this for free (see §4).
- `exposure: "model-only"`: scripts cannot start scripts (`tool.ts`).

### 2.3 Script-visible API (the "prelude")

`runtime/prelude-source.ts` is JS evaluated inside the VM before the script. It keeps the single host bridge in a closure and builds, then **freezes**, the API:

| global | semantics |
|---|---|
| `tools.<id>(args)` | `Promise`. One JSON-serialisable arg; result JSON round-trips. Also `tools["raw-name"]`. Failure rejects with an `Error` carrying the tool's message. `id = toCodemodeIdentifier(name)`. |
| `ALL_TOOLS` | frozen `[{name:id, description}]` |
| `text(v)` / `console.*` | append a text output item (non-strings JSON-stringified) |
| `image(x)` | append an image. Accepts `data:` URL, `{image_url}`, or an MCP `ImageContent`. Remote URLs are rejected. Base64 and magic bytes are validated; the MIME type comes from the signature, not the declaration (CHANGELOG 0.99.2). |
| `exit()` | end successfully now (throws a private `EXIT` sentinel after reporting) |
| `store(k,v)` / `load(k)` | synchronous JSON KV snapshot. 256 KiB per value, 1 MiB total (`MAX_STORE_*`). `undefined` deletes. |
| `searchTools`, `describeTool`, `describeNamespace`, `models.*` | host *globals* added by coding-agent (§2.6, §2.8) |
| **absent** | `process`, `require`, `fetch`, timers, `WebAssembly`, modules (`sandbox.test.ts:588-612`) |

`eval` and `Function` exist but only mint more code inside the same VM (test at 613). Dynamic `import` rejects. `tools` and `console` are frozen (test at 637).

### 2.4 Sandbox: QuickJS compiled to WASM, in a worker thread

- Each `execute()` spawns a **fresh `worker_threads` Worker** that instantiates a **fresh QuickJS VM** (a separate wasm instance, own linear memory), about 20 ms (README:178). Imports are a WASI shim (clock, random, discarded stdout/stderr) and one host-call entry point. `worker.ts:~35` throws away engine stdout/stderr "because it belongs to the host application (for example a TUI)".
- `memoryLimitBytes` caps the QuickJS heap (`InternalError: out of memory` inside the script). The coding agent sets **256 MiB** (`execute.ts: CODEMODE_MEMORY_LIMIT_BYTES`), because the worker shares pi's process and wasm32 allows 4 GiB.
- `maxStackSize: MAX_STACK_SIZE`: deep recursion becomes a catchable `RangeError`, not a wasm trap.
- **Deadline**: `timeoutMs` (default 300 000 in the library; coding-agent passes `sourceOptions.timeoutMs ?? Infinity`, i.e. none unless the model asks). The host owns the timer and `AbortSignal`. On fire it sets a shared `Int32` interrupt flag (the VM's `interruptHandler` polls it via `Atomics.load`), then `worker.terminate()`. The flag exists because Bun's `terminate()` cannot stop a thread spinning in wasm (`host.ts` comment; README:182).
- **Deadlock detector**: `stalled()` fails a script awaiting a promise nothing can settle (no pending host call, no timers in the VM) rather than hanging (README:49; test at 478).
- A new worker per run means "a runaway script … cannot poison a later run" (`host.ts` class comment). State persists only via `store`.

### 2.5 Host↔worker protocol (`protocol.ts`)

JSON strings across the thread boundary, so the worker never builds structured values itself.

```ts
WorkerToHost =
  | { type:"call"; id:number; target:"tool"|"global"; name:string; args:string|undefined }
  | { type:"output"; item: CodemodeOutputItem }
  | { type:"done"; ok:true;  value:string|undefined; writes:string }   // writes = JSON [[k,json]] | [[k]] for deletes
  | { type:"done"; ok:false; error:string }                            // JSON {name?,message,stack?}
  | { type:"crash"; message:string }
HostToWorker = { type:"result"; id:number; ok:boolean; payload:string|undefined }
```

Control flow (`host.ts` `Execution`):

1. VM calls `bridge("call", id, name, argsJson)`, which becomes a `call` message. The host looks the tool up, `JSON.parse`s args, runs `tool.execute(args,{signal})`, and posts `result`. A throw becomes `ok:false` and the script sees a rejected `Error(message)`.
2. Every tool call gets its own `AbortController`. `finish()` aborts all still-pending calls (marked `cancelled`). That covers **unawaited calls, timeout, abort and `close()`** ("calls that are still running when the script returns are aborted").
3. `result.calls` records `{name,status:"ok"|"error"|"cancelled",durationMs}` for every tool call. Globals are not recorded.
4. `execute()` **never rejects for script failures**. It returns `{ok:false,error:{kind:"script"|"timeout"|"aborted"|"sandbox",…},output,calls}`. `output` is kept up to the failure.

### 2.6 Declarations: how the model learns the API

`declarations.ts` is a small JSON-Schema → TypeScript compiler:

- `renderDeclarations({tools,globals})` yields `declare const tools: { /** desc */ read(args:{path:string;}): Promise<string>; … };` plus `declare function g(...)` and `declare const ns:{…}` for namespaced globals. Descriptions become doc comments, with `*/` escaped.
- `schemaToType`: objects on one line with **properties sorted by name**; multi-line with `//` comments if a property has a description; `$ref` to `#/$defs` / `#/definitions` expanded (max 32 expansions; recursive or remote refs become `unknown`); `enum`/`const` become literal unions; `anyOf`/`oneOf` become unions; `allOf` becomes `&`. Input types over `DEFAULT_INPUT_SCHEMA_MAX_CHARS = 16 000` degrade to `unknown`.
- Output type: a tool without `outputSchema` is declared `Promise<string>` (coding-agent forces `{type:"string"}`). An MCP `CallToolResult` schema is detected structurally (`mcpStructuredContentSchema`) and rendered as `Promise<CallToolResult<T>>`, with a shared `MCP_TYPESCRIPT_PREAMBLE` of MCP content types prepended once.
- `renderToolSample` = description + a fenced one-tool declaration. This is what `describeTool()` and `ALL_TOOLS[i].description` return.
- **Schemas shape declarations only. Values are never validated against them** (README:113). Validation happens in the agent loop's tool pipeline (`ctx.executeTool`).

The assembled description (`createCodemodeDescription`, `tool.ts`) has a fixed intro (limits, helper list), a "some tools may be omitted" paragraph, an optional MCP-types block, an optional `models.*` block, then `Nested tools:` with one `### \`id\`` section per listed tool, grouped under `## namespace` headings. It is token-budgeted (`inlineBudget`, default **3000 estimated tokens**, chars/4) by `selectCatalog`, a **round-robin cheapest-first** pick across groups, so every namespace is represented before any is complete. Anything that does not fit becomes "(some tools not listed)" and is reachable by search. The description is stable while MCP servers connect, because deferred tools never affect it (cache-friendliness is an explicit design goal).

### 2.7 Exposure modes

`ToolExposure = "direct" | "model-only" | "codemode" | "deferred" | "hidden"` (`core/extensions/types.ts:509`):

| exposure | declared to the model as its own tool? | callable from scripts? | in codemode description? | found via |
|---|---|---|---|---|
| `direct` (default) | yes, if active | yes, if active | only in `codemode.mode = "only"` (else its own description gets the codemode declaration appended in mode `on`) | normal tool list |
| `model-only` | yes | **no** (`codemode`, `tool_search` themselves) | n/a | n/a |
| `codemode` | no | **always** (active or not) | no: namespace heading only | `searchTools()`, `ALL_TOOLS`, `describeNamespace()` |
| `deferred` | no, until `tool_search` loads it | yes | never | `tool_search` tool (activates matches for the *next* call), or `searchTools()` |
| `hidden` | no | no | no | nothing |

`mcp.md` calls `codemode` the MCP default and accepts `codemode-deferred` as an alias for it. `toolExposure` overrides per tool, with exact names beating `*` patterns. Callable set = active `direct` tools ∪ every `codemode`/`deferred` tool (`agent-session.ts: _getCallableTools`). "Codemode calls do not depend on the active tool set, so they remain available after `/tree`, resume, and fork."

Two codemode *modes* (`settings-manager.ts:95-106`): `on` (direct tools get the codemode declaration appended to their own description, and the codemode description lists only non-direct tools) and `only` (codemode lists everything callable; declarations of active direct tools are *hidden* from requests via `prepareLoadout` → `hiddenDeclarations`).

`mcp/index.ts` auto-activates `codemode` when a `codemode`-exposure server connects, and `tool_search` for `deferred` ones. It warns once if neither is active, so the tools would be uncallable. The system prompt gets an `mcp_servers` section (server, how to reach its tools, one-line description). When that section changes, it is *appended to the conversation* instead of mutating tool declarations, so earlier messages stay cached.

### 2.8 Tool discovery

- `searchTools(query,{limit=8,namespace?})` → `[{name:id, description:sample}]`; `describeTool(name)` → declaration sample; `describeNamespace(name)` → `{name,description?,instructions?,tools:[ids]}`. Namespace matching accepts `mcp__dev-radius`, `mcp__dev_radius`, `dev-radius`, `dev_radius` (`isNamespaceName`).
- The ranker (`tool-search/tool.ts`) is **Okapi BM25** (k1 1.2, b 0.75) over a document of: name, name-with-spaces, description, schema descriptions and property names (recursive), namespace name/description/instructions. Tokenising splits camelCase and non-alphanumerics, drops a stopword list, and uses a naive plural stemmer. `ToolRanker` is an interface: "a hybrid ranker with embeddings can replace it".
- Discovery is a **host global, not a tool call**, so it is not recorded in `calls`. It runs synchronously from the script's view (via `spread:true` globals).
- Lazy connection: a script waits only for the MCP servers it names (`mcp__<server>`), or for all of them if it calls `searchTools()` / reads `ALL_TOOLS` (`mcp.md`).

### 2.9 How nested results flow (and do *not* flow) back into context

1. A script's nested call goes through `ctx.executeTool(name,args,{signal})`, i.e. the **agent loop's normal pipeline** (validation, `tool_call`/`tool_result` hooks, permission gates) via `NestedToolCallRunner` (`nested-tool-calls.ts`). Events are emitted with `parentToolCallId`.
2. The script receives (`toScriptValue`): `structuredContent` if the tool declares an `outputSchema` (also for error results that carry one, so MCP `isError` resolves in-script); otherwise the **text** content as one string; otherwise a failed call **throws** `Error(text)`.
3. **The model never sees any of that.** It sees only: a header `Script completed|failed\nWall time N seconds\nOutput:`, the ordered `text()`/`console` items, the `return` value appended as text, and on failure `Script error:\n<stack>\n\nTool calls made before the failure (they are not undone): read (ok), write (error)`.
4. **Output budget**: `max_output_tokens` (default **10 000**, chars/4). Over budget: text items are fused into head + `…N tokens truncated…` + tail (half each), images kept, and the *full text is spilled to a temp file* whose path is appended (`truncateOutput`, `spillOutput`). The same shape is used for direct bash output.
5. **Audit**: the nested calls are recorded on the tool-result message as `nestedCalls` (≤256 calls, ≤8 KiB args per call, ≤32 KiB total, errors ≤500 chars; marked `complete:false` when anything is dropped). Usage of nested results is summed onto the message. Compaction reads these to keep file-op tracking right (`compaction/utils.ts`).
6. **Persistence**: successful scripts append `store()` writes as a `codemode-store` custom session entry. `load()` replays the entries on the current branch, so **each fork/branch sees only its own path's values** (`readCodemodeStore`). A failed script persists nothing.
7. **Effects are not transactional**: "Tool calls are real and have side effects. If the script fails partway, earlier calls are not undone." (tool description). The failure message lists the calls so the model knows what happened.

### 2.10 Other behaviours worth copying

- `models.*` global namespace (`getModelsOfType`, `classify`…): a script can ask classifier models, with a concurrency limiter of 4. Only `provider`+`id` from the script-supplied model are used, so a script cannot inject `baseUrl`/`headers` to exfiltrate credentials; `headers` are dropped from catalog entries (`execute.ts: toModelInfo`, comment "must never receive the credentials"). **This is the capability-confinement idea in miniature.**
- The sandbox is **lazy-loaded** on first call (`execute.lazy.ts`).
- Image forwarding from MCP results: `image(result.content[0])`.
- `mcp-codemode` example (`agent/examples/mcp-codemode/tools.ts`): an `Agent` gets MCP tools directly *and* a `codemode` tool, with `createNestedToolRunner(agent)` re-entering `runToolCall` so hooks apply to nested calls. This is the smallest "wire it yourself" reference.

---

## 3. The wider "code mode" idea

- **CodeAct** (arXiv 2402.01030, Wang et al., 2024-02-01): executable Python as a *unified action space* instead of JSON tool calls. Claims up to 20% higher success on API-Bank and a newly curated benchmark across 17 LLMs, plus multi-turn self-debugging from interpreter feedback.
- **smolagents** (Hugging Face): "AI Agents are programs where LLM outputs control the workflow"; code agents give composability, object management, generality, and training-corpus familiarity. Its `LocalPythonExecutor` is an **AST interpreter with an import allow-list and an operation cap** (e.g. "Maximum number of 1000000 iterations in While loop exceeded"), and the docs state plainly that no local Python sandbox is completely secure. Real isolation needs E2B/Docker/Modal/Blaxel, either per snippet or the whole agent system.
- **Cloudflare "Code Mode"**: convert MCP tools into a TypeScript API (`declare const codemode: {…}` with doc comments), give the agent *one* tool that runs TypeScript. Sandbox = a fresh V8 isolate per run via the Worker Loader API (a few ms, a few MB, no containers); no Internet; the only egress is RPC bindings back to the agent loop, which dispatches to MCP servers; results return through `console.log`. Claims: models handle more and more complex tools; chained calls skip the "LLM copies output to next input" tax. Their current limitation: the whole API is loaded into context.
- **Anthropic "Code execution with MCP"** (2025-11-04): same insight; adds *progressive disclosure*: a `servers/<name>/<tool>.ts` file tree the agent lists and reads on demand, or a `search_tools` with a *detail-level parameter* (name / name+description / full schema). Claimed 150 000 → 2 000 tokens (98.7%). Also: filter big results in code ("agent sees five rows instead of 10 000"); loops and conditionals in code (cheaper time-to-first-token); **privacy-preserving tokenisation** of PII by the MCP client so real values flow between tools without entering the model's context; **state persistence and "skills"** (agents save working functions to `./skills/` with a `SKILL.md`). It warns that code execution "requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring" and has operational overhead.

Synthesis (INFERRED): three separable ideas hide inside "code mode".

1. **Composition**: one program replaces N model round trips.
2. **Context economy**: tool schemas load on demand, and results are reduced before the model sees them.
3. **Confinement**: untrusted code gets only a named capability table.

pi implements all three. The Spell `execute` tool implements the same three with a different language and sandbox (§3.1). Omega should treat them as independent dials.

### 3.1 Comparison: Spell's `execute` (PTC-Lisp) — OBSERVED from its tool description

| dimension | pi `codemode` | Spell `execute` |
|---|---|---|
| language | JavaScript (QuickJS) | PTC-Lisp, a deterministic Clojure subset, running in a sandboxed BEAM process |
| tool access | `await tools.x(args)` (promise) | `(tool/x {…})` (synchronous call; `pmap`/`psettled` for fan-out) |
| declarations | generated TS in tool description | none: tool names are just known; `(doc …)`, `(apropos …)`, `(dir …)` introspect *the language* |
| sandbox | wasm instance + worker thread; no host globals | BEAM isolated process, no fs/net/shell of its own |
| capability policy | exposure + `ctx.executeTool` hooks | **read/write tools allowed; process tools (`bash`,`task`) and network (`fetch`,`web_search`) denied by default** |
| limits | 256 MiB heap; deadline by `// @options` or none; no stack-depth config | `timeout_ms` 1..30 000 (default 1000), `max_heap_mb` default ~50 / hard 256, `session_store_mb` ~64 |
| error model | tool errors reject; script result `{ok:false,error.kind}` | `psettled` / `try`-`catch` / `(fail …)`; heap/timeout kills are **uncatchable** by `try` |
| big results | everything goes through JSON; all in heap | >256 KB results are **parked off-heap as handles**, projectable (`count`,`get`,`take`) without realising |
| state across calls | `store`/`load` (JSON, 1 MiB) | session `(def x …)` bindings persist; handles stay offloaded |
| transactions | none ("not undone") | **file writes (`edit`,`create`) are rolled back if the program fails**; mixing with non-file mutations (`org`,`memory`,`todo_write`) is **rejected** up front |
| preview | none | `intent:"visible-refresh"` dry-runs writes into a preview; `background-tick` inert unless `auto_write` |
| result shape | text items + return value + header | one small value (optionally validated by a `signature`), `probe` for labelled multi-checks |
| discovery | BM25 `searchTools`, `describeTool`, `describeNamespace` | none built-in beyond `doc/apropos/dir` for the language (tools are enumerated in the harness prompt) |

Takeaways for omega: (a) handles for large results, (b) transactional effects with an *up-front rejection of un-rollbackable mixes*, (c) `probe` (a named multi-check giving structured evidence), (d) `signature` as a return contract, and (e) the explicit "uncatchable resource kill" semantic are all things pi lacks. Conversely pi has generated declarations, output budgeting with spill, BM25 discovery, exposure modes, and per-branch persisted store, and Spell's tool lacks those.

---

## 4. What omega should take / adapt / drop

**Take**

- **One tool whose input is a program; nested results stay out of context.** It is the whole point, and the message log already supports it: `nestedCalls` on the tool-result message gives an audit trail without context cost. In omega the trail becomes *datoms/traces on the task* (stigmergy), not message metadata.
- **Frozen, minimal API surface** (`tools`, `ALL_TOOLS`, `text`, `exit`, `store`/`load`, discovery). Small and teachable.
- **Failure as a value with `kind`** (`script|timeout|aborted|sandbox`) and *partial output preserved*. Beam-lisp's `harness/eval-cell` already returns `{:value :stdout :error :ms}` the same way.
- **"Calls made before the failure (they are not undone)" footer.** It is cheap and honest.
- **Token-budgeted catalog with round-robin cheapest-first across namespaces**, and a description that is *stable* as tools connect (prompt-cache hygiene). Take the exposure model (`direct`/`codemode`/`deferred`/`hidden`) with the same names.
- **Output budget + spill** (head/tail + temp file path). Reuse for any large tool output, not just codemode.
- **`searchTools` / `describeTool` / `describeNamespace` as host globals + BM25 behind a `ToolRanker` protocol.** The `ToolRanker` seam is right: BM25 now, embeddings or datalog-over-tool-facts later.
- **Per-branch `store`** (here: per-*task*, written as facts).
- **Credential confinement**: the script names a model by `provider/id`, and the host resolves credentials. Generalise it: *scripts hold no secrets, ever*.

**Adapt**

- **Language: beam-lisp, not JS.** Declarations become a *signature listing* (§5.3). A Lisp is a better fit for the model-to-model boundary (code is data, so a script can be quoted, logged, diffed, replayed). The cost is training-prior (see Open Q1).
- **Sandbox: forked `env` with `:caps []`, not WASM.** Beam-lisp already provides compile-time capability gating (`env/eval` in a capped fork refuses ungranted modules *before bytecode exists*). Tools are *names in the sandbox's namespace* that wrap host fns, which is exactly the "vocabulary of a world" doctrine of `examples/sandbox`.
- **Async → processes.** pi needs `Promise.all`; beam-lisp has processes, `future`, `pmap`-style fan-out, and `spawn` conveyance. The script runs *in its own BEAM process*, killed on deadline, so no interrupt-flag hack is needed (the BEAM preempts).
- **Persisted `store`** → facts on the owning task, queryable by sibling tasks. This is where omega's stigmergy and codemode meet: `store` becomes the trace.
- **Nested-call pipeline** → *the same capability check as a direct call*, with the **task's** authority (conveyed env), not the harness's. See §5.5, the confused deputy.

**Drop**

- QuickJS/WASM/worker-thread/interrupt-flag machinery (BEAM scheduler + process kill replace it).
- TS declaration compiler *as such* (JSON-Schema → TS). Replace with a smaller JSON-Schema → "signature + docstring" renderer, or, if tools are authored in beam-lisp, derive signatures from the defn directly.
- Lark grammar for provider-constrained decoding (for JS). *Keep the idea*: a beam-lisp `.bl` grammar can constrain sampling and avoid JSON-escaping (also `#|…|` raw strings, per `docs/raw-strings.bl.md`, already solve quote hell for code-in-strings).
- JSON round-trip for every arg/result. Inside one VM the host and script can share **BEAM terms**. Keep JSON only at the MCP/LLM boundary. This kills a whole class of lossy conversions (but see Open Q4: data-vs-handle).
- `models.*` as a hard-wired namespace. Make it an ordinary tool group that happens to call the gateway (relay).

---

## 5. beam-lisp mapping and design

### 5.1 What exists (OBSERVED)

| need | existing piece | where |
|---|---|---|
| restricted world for untrusted code | `(env/fork parent {:caps [...]})`: child caps = parent ∩ spec, narrowing only | `priv/std/env.bl`; `lib/beam_lisp/env.ex` `fork/2` |
| compile model-written source inside it | `(env/eval src)`: capability gate applies to *this compilation* | `env.bl`; ran below |
| denied-at-compile-time | `File/read` in a capped env → `module File is not granted in this environment` | `examples/sandbox/01…`; **ran** in this doc |
| per-env heap bound | `(BeamLisp.Env/fork parent (list (tuple :caps …) (tuple :max_heap_words N)))`; child ≤ parent | `env.ex:124`; `refs.ex:265-282` |
| process-level isolation, kill on deadline | `spawn-monitor` + `receive … (after ms (erlang/exit pid :kill))`, as `harness/eval-cell` does | `priv/lib/harness.bl: eval-cell` |
| capture stdout | `StringIO/open` + `erlang/group_leader` | `harness.bl: eval-cell`; ran below |
| env crosses `spawn` deliberately | `spawn`/`future`/`promise` convey; raw `erlang/spawn` does not; `env/capture`+`env/bind` | `docs/the-environment-and-process-conveyance.md`; `refs.ex: spawn_exec` |
| avoid confused deputy | a `:global` server must `env/bind` the **caller's** token before acting | `examples/sandbox/05…` |
| token → caps | `auth/sandbox-fork` (Biscuit token → env) | `examples/sandbox/03…` |
| effect lattice | `pure < atom < process < io`; `check-purity-claims` flags a `^:pure` lie | `priv/std/effects.bl` |
| MCP server (harness over MCP) | `harness.mcp` serves `eval`/`start_turn`/`steer_turn` on loopback HTTP + bearer token | `priv/lib/harness/mcp.bl`; `priv/lib/mcp/*` |
| `.bl.md` as the transcript | `harness.doc` appends cell+result blocks | `priv/lib/harness.bl`, `harness/doc.bl` |

### 5.2 Observed behaviour (ran with `bl run`, this machine)

Executable below. Each script runs in a **fresh fork** (`caps []`, `max_heap_words` 4M), in **its own process**, with a **deadline**, **captured stdout**, and a **host tool table** compiled once at trusted level. Observed results (see the block output):

- A granted tool call works; `println` output is captured separately from the value.
- A host tool that throws is catchable *inside* the script (`caught: tool failed`).
- `(File/read …)` is rejected at compile time by the gate.
- `(loop [] (recur))` is killed at the deadline and reported as `{:error :timeout}`.
- `@calls` shows host-side audit (`[:read "a.txt"] [:boom]`): the trace is naturally recorded *by the host wrapper*, not trusted to the script.

```beam-lisp
(ns cm.demo (:require [env]))

;; ── the host side: trusted, compiled at :global ───────────────────────────
(def calls (atom []))                       ; the audit trail (host-owned)
(defn host-read [args]
  (swap! calls conj [:read (get args "path")])
  (str "contents-of:" (get args "path")))
(defn host-boom [_]
  (swap! calls conj [:boom])
  (throw (ex-info "tool failed" {})))

;; ── the tool table: names the sandbox may speak ───────────────────────────
;; A base env holds namespace `tools` whose fns forward to host fns.
;; (The wrappers are compiled with full caps; the sandbox only ever calls them.)
(def base (env/fork))
(env/with-env base
  (fn [] (env/eval "(ns tools)
                    (defn read [a] (cm.demo/host-read a))
                    (defn boom [a] (cm.demo/host-boom a))")))

;; ── run-script: fork → process → deadline → captured output → value|error ─
(defn run-script [src ms]
  (let [sb     (BeamLisp.Env/fork base
                 (list (tuple :caps []) (tuple :max_heap_words 4000000)))
        parent (erlang/self)
        tag    (erlang/make_ref)
        io     (elem (StringIO/open "") 1)
        [pid mref]
        (spawn-monitor
          (fn []
            (erlang/group_leader io (erlang/self))
            (erlang/send parent
              [tag (try {:ok (env/with-env sb (fn [] (env/eval src)))}
                        (catch e {:error (ex-message e)}))])))
        r (receive
            [t v] :when (= t tag) v
            [:DOWN m :process _ x] :when (= m mref)
              {:error (str "exit " (pr-str x))}
            (after ms (do (erlang/exit pid :kill) {:error :timeout})))
        out (elem (elem (StringIO/close io) 1) 1)]
    (erlang/demonitor mref (list :flush))
    (env/destroy sb)
    (assoc r :output out)))

(println (run-script "(ns s1) (println \"reading\") (count (tools/read {\"path\" \"a.txt\"}))" 5000))
(println (run-script "(ns s2) (try (tools/boom {}) (catch e (str \"caught: \" (ex-message e))))" 5000))
(println (run-script "(ns s3) (File/read \"/etc/hostname\")" 5000))
(println (run-script "(ns s4) (loop [] (recur))" 500))
(println @calls)
```

Two more probes (run, not embedded: each takes >10 s of BEAM startup here):

- **`:max_heap_words` is enforced per *spawned* process, with `kill:false`.** `refs.ex:265-282` applies it inside `future_exec`/`spawn_exec`. A `future` in a 1M-word fork that allocated a 20M-element vec **still returned 20000000** in my probe. So the bound did **not** stop it: it is *not a reliable hard cap* today (probable cause: `env/eval` ran in the *caller's* process, or `kill:false` degrades to a no-op raise that the vector builder never hit; I did not diagnose it). By contrast `(erlang/process_flag :max_heap_size {:size 200000 :kill true :error_logger false})` set inside a `spawn-monitor` child **did** kill it (`[:killed :killed]`). Design consequence: omega's runner must set `max_heap_size` with `kill:true` itself on the script process and treat `:killed` as `kind: :heap`. It must not rely on `env`'s flag. **(OBSERVED probe; cause INFERRED.)**
- **`(meta (var f))` and `#'f` metadata returned `nil`** in my probe, so docstrings and arglists are not retrievable through var meta in this build. Declaration generation (§5.3) therefore cannot rely on `defn` docstrings today (gap; maybe `doc` lives elsewhere, I did not find it).

### 5.3 Design: `codemode` for omega (INFERRED / proposal)

Design sketches in `clojure` fences (not runnable). Names are placeholders.

**Layering mirrors pi's, but both layers are beam-lisp:**

```
omega.codemode.sandbox   ; run-script: fork, process, deadline, heap kill, output capture → Result
omega.codemode.catalog   ; tools → {sigs, search, describe}; exposure; budgeted description
omega.codemode.tool      ; the model-facing tool: parse source, call sandbox, shape result, spill
```

**The tool table as a first-class value.** A tool is data plus a fn; the sandbox namespace is *generated from it*:

```clojure
;; a tool = a value; a sandbox namespace is a projection of a set of them
{:name        "read"
 :ns          "omega.fs"                       ; namespace for search + grouping (≙ pi ToolNamespace)
 :exposure    :direct | :codemode | :deferred | :hidden
 :doc         "Read a file"
 :sig         '[path & [{:keys [offset limit]}]]   ; rendered into the description
 :in-schema   {...JSON Schema...}               ; optional; for MCP tools, the wire schema
 :out         :text | :data                     ; ≙ outputSchema vs string
 :effect      :io                               ; from priv/std/effects.bl lattice
 :run         (fn [args ctx] ...)}              ; HOST fn; never visible to the script
```

**Sandbox protocol (replaces host.ts/worker.ts/protocol.ts):** one BEAM process per script; the host function table closes over `ctx` (task id, authority token, signal):

```clojure
(defn run-script [{:keys [code tools task budget]}]
  ;; 1. parse optional header form: (options {:max-output-tokens 2000 :timeout-ms 30000})
  ;; 2. fork env from the TASK's env (parent = the task's conveyed env, NOT :global)
  ;;    with :caps [] ∩ task-caps, plus the tool namespace generated from `tools`
  ;; 3. spawn-monitor a process:  group_leader → StringIO; process_flag max_heap_size {:kill true}
  ;; 4. env/eval code inside the fork; each tool wrapper:
  ;;      checks authority (token ∩ tool), writes a trace fact, runs :run, returns a TERM
  ;; 5. receive result | :DOWN | (after deadline → exit :kill)
  ;; 6. => {:ok? bool :value v :error {:kind :script|:timeout|:heap|:aborted|:sandbox …}
  ;;        :output [items…] :calls [{:tool :status :ms}…] :writes {…}}
  )
```

**Differences from pi, deliberately:**

1. **Result is a BEAM term, not JSON.** Maps, vectors, keywords, even function values stay in-VM. Only the final return value is *rendered* (pretty-printed + budgeted) for the model. The `store` is `{:writes …}` data written as facts.
2. **Large-result handles** (stolen from Spell's `execute`): any tool result over N KB is parked in an ETS/datom table keyed by an opaque handle. The script gets a handle value that supports `count/get/take/select-keys` without realising it, and `(realise h)` is explicit. This directly attacks pi's weakness that a 100 MB result sits in the QuickJS heap.
3. **Transactional effects, or up-front refusal.** Tools carry `:effect` from the existing lattice (`effects.bl`: `pure < atom < process < io`). Define the script-level rule:
   - File-edit tools stage into a *shadow* (overlay map `path → new-bytes`, reads see the overlay). Commit on `:ok?`, discard on any failure. This is Spell's behaviour.
   - Non-stageable effects (send message to another task, spawn task, git commit, network) are classified `:irreversible`. By default **a script may use at most one irreversible tool, and only as its last effect** (checked by a cheap pre-pass over the quoted forms using the same walker as `effects/eff-walk`), else the script is refused before running. A task may opt in with a stated reason. This turns pi's honest-but-passive "not undone" footer into a *preventive* check.
4. **Policy = caps ∩ authority, not an exposure flag.** pi's exposure controls *discovery*; the `ctx.executeTool` hooks control *permission*. Omega separates them the same way, but permission is **the task's Biscuit/caps token**, so a script inside task T can never call a tool T's own direct calls could not (§5.5).
5. **Trace instead of `nestedCalls`.** Every nested call is a fact `{:task T :call-of C :tool "read" :args-hash … :status :ok :ms 12}`. Siblings and the UI read the same facts. That is the stigmergic layer for free: the codemode trace *is* the environment the other tasks sense.
6. **Declarations: a signature digest, not TS.** For each listed tool: `### name  (sig)  ; doc`. For MCP tools with JSON Schema, a smaller JSON-Schema→"keys/types" renderer (port of `schemaToType`'s ideas: sorted keys, `?` optional, `$ref` budget, `…` when over a char cap). The budget algorithm (`selectCatalog`: round-robin cheapest-first across namespaces) ports 1:1 as a pure fn, and is a very good first pure-bl component to write and test.
7. **`exit`, `text`, return**: keep `exit` (early success). `text` is just `println` into the captured stdout, so we need no new primitive. The return value is appended last, as in pi's coding-agent.

**Exposure & discovery.** Keep pi's four modes with the same names. `searchTools` (BM25 behind a `ToolRanker` protocol) and `describe-tool`/`describe-namespace` are host fns in the sandbox namespace (not recorded as calls; read-only, so classified `:pure` in the effect lattice). `deferred` tools can additionally be loaded into the *next model call* by a `tool_search`-style tool. A beam-lisp-specific upgrade: since beam-lisp has `priv/std/codebase.bl` and "code-semantic-search" docs (`docs/code-semantic-search.md`; not read), tools could be discovered by *the same index* that discovers code. Worth a decision (Open Q6).

**Source format.** The model's code arrives as raw `.bl` text (or `.bl.md` cells, as `harness/mcp.bl` already accepts). The options header becomes a leading *form*, `(omega/options {...})`, read with the reader and stripped, instead of a `// @options:` comment line. It keeps source parseable as one language and needs no line-number trick. Grammar-constrained decoding is then a tiny grammar over "a sequence of balanced forms".

### 5.4 Capability policy

OBSERVED mechanics: caps are a set of **module atoms** (optionally `[module op]` pairs); unresolvable names drop out *fail-closed* (`caps-entry`); the gate runs at **compile time**; `env/eval` compiles in the *current* env; narrowing is `parent ∩ spec`; destroyed or smuggled tokens can't carry rights (`env/bind` re-derives caps from the registry).

INFERRED policy for omega scripts:

- Script env caps: **`[]`** (no interop modules at all). Everything the script can do is "call a function in `omega.tools.*`". Pure core (`map`, `reduce`, string ops in `core`) is available because `core` is compiled at `:global` as trusted substrate (doctrine in `examples/sandbox/00-README.md`).
- **The doctrine caveat is load-bearing:** "the gate … does **not** re-mediate code already compiled at `:global`." So a tool wrapper that does `(File/read path)` is *the script's reach into the filesystem*. Wrappers must therefore **validate their arguments** (path under project root, size limits), and any wrapper that calls back into user code must not do so under `:global`. Review rule: *every `:run` fn is part of the TCB.*
- Dangerous-by-default core fns reachable without interop: need an audit. E.g. is `eval`, `require`, `load-file`, `spawn`, `send`, `atom`, `intern`, `(var-get …)` reachable from `core` without caps? I did **not** audit this. It is the single most important verification before shipping (§7 Q2). `trust-boundary.md` is explicit that the compiler itself makes "no effort to sandbox" and that atom-table exhaustion is a VM-wide abort (`AtomLimitError` guard samples every 256 tokens, not a quota). **Model-generated code is machine-generated input**, the exact hazard it warns about.
- **Atom budget per script** is currently unenforceable (documented: "a high-water alarm, not a quota"). Mitigation: reject scripts over N bytes before reading; run each script in a *separate process* so a crash is contained; keep a node-level atom watchdog. For true hostility, a separate BEAM node (the doc's own recommendation).

### 5.5 Authority: task's token, conveyed

The confused-deputy example (05) is the pivot. Omega's tool wrappers run at `:global`. If a script in task T calls `tools/read`, the wrapper runs with harness authority. Therefore each wrapper must either (a) check `(env/allowed? …)` / the token for the *caller's* env (read from the script process's env via `env/capture` before the call, or simply by making the wrapper run *inside the script's env* through a `$remote` handle as example 05 does) or (b) take the authority check explicitly from `ctx.authority`. Prefer (b): a plain `allowed?(tool, token)` using `auth/authorize` (pure, offline), and log allow *and* deny as facts (example 06: "every verdict becomes one datom"). The token is minted by the parent task by *attenuation* (Biscuit), so a spawned subtask's scripts are strictly narrower: monotone by construction.

### 5.6 Heap, timeouts, and the uncatchable kill

Observed: process kill on deadline works (`:timeout`), and `max_heap_size{kill:true}` kills (`:killed`). Policy:

| resource | mechanism | surfaced as |
|---|---|---|
| wall clock | `(after ms (erlang/exit pid :kill))` in the supervising receive | `{:kind :timeout}` |
| heap | `process_flag :max_heap_size {:size W :kill true}` set by the runner (not relying on `env`'s `kill:false`) | `{:kind :heap}` via `:DOWN :killed` |
| reductions / pure loops | covered by wall clock (BEAM preempts; no interrupt flag needed) | `:timeout` |
| output size | cap the captured `StringIO` (e.g. truncate on append) so a `println` loop can't grow the host | `…truncated…` + spill |
| tool-call count | counter in the wrapper (pi: 256 recorded); refuse past N | `:error :too-many-calls` |
| atoms | see §5.4; not enforceable per script today | node-level watchdog |

Like Spell's tool, heap/timeout kills are **not catchable by the script** (a `try` in the script cannot swallow `exit :kill`). That is a feature: it makes the budget real. The model sees `kind` and the partial output, then adjusts.

### 5.7 How results get summarised

Pipeline (port of pi's, plus handles):

1. Collect ordered `output` items (stdout captured via group leader; `(emit …)` for non-text items such as images).
2. Append the return value, `pr-str`'d with print-length/level caps (so a lazy infinite seq or giant map can't blow the render).
3. Apply budget (`max_output_tokens`, default 10k, chars/4): head + `…N tokens truncated…` + tail; spill full text to a file/artifact and append its URI (omega already uses `artifact://`-style handles in Spell; choose one).
4. Header `Script completed|failed · wall N s · K tool calls (ok/err/cancelled)`.
5. On failure: error text + stack (lines map exactly, because source is the model's own text and the reader tracks positions; `env/eval` errors already say `line 1:`), then "Tool calls made before the failure" and, new, **"Staged effects discarded: …"** from the transaction layer.
6. Facts: one summary fact per script (`:codemode/run`) linking task, script hash, outcome, calls. The full script text is stored once (content-addressed), so the model can later say "re-run script 7f3a with a change".

---

## 6. Interactions & observability

How a human or a developing agent peeks into, tests, and drives this part.

- **REPL/eval**: `run-script` is a plain function, so `bl run` or the warm VM can call it with a source string (as the block above). That makes *the sandbox testable without an LLM*, the same property pi's `codemode` package has (its test suite drives `CodemodeSandbox.execute` directly: about 45 `it(...)` cases incl. escape hatches).
- **Test matrix to port from `sandbox.test.ts`** (OBSERVED list → omega equivalents): return values; top-level order of output; syntax-error line numbers; thrown errors; non-Error throws; tool error → catchable; unknown tool; unawaited call cancelled; concurrent calls; store snapshot/writes/copy semantics/limits; globals; infinite loop → timeout; stalled promise (n/a: no promises, but a script blocked in `receive` forever → timeout); abort; close; parallel executions share no state; deep recursion → catchable; escape hatches (no host globals, `eval`/`Function` stay inside, frozen API). Add: **cap-denial tests** (`File/read`, `erlang/halt`, `spawn`, `os/cmd` all denied), **heap-kill**, **atom-flood** (expect rejection), **confused-deputy** (script in capped task cannot read through a wrapper), **transaction rollback**.
- **Peek**: every run leaves (a) a `.bl.md` block (cell + `bl-result`) in the task's session document, the existing `harness.doc` shape, and (b) trace facts. A human reads the document top to bottom. The TUI/loom front-end renders `{:calls …}` as rows (pi's `renderer.ts` shows nested calls live via `onUpdate`; replicate by emitting a fact per call as it starts and ends).
- **Drive**: `harness/mcp.bl` already exposes `eval`, `start_turn`, `steer_turn` over MCP on loopback with a bearer token. A fourth MCP tool, `codemode`, with the *same* `run-script`, lets an *outside* agent (Claude Code, Spell) drive omega's sandbox, and also gives us an apples-to-apples comparison with Spell's `execute`.
- **Dry-run / preview**: with the transaction layer, `run-script {:dry-run true}` returns the staged diff without committing (Spell's `visible-refresh`).
- **Doctor**: a `bl codemode doctor` that lists the catalog, the token budget it consumes, which tools are listed vs deferred, and runs the escape-hatch matrix against the current build. Cheap, high-value, and the thing to run after any change to `env.ex` or `core`.
- **Evals**: pi has a `packages/evals` (not read). A tiny eval comparing (a) direct tool-calls vs (b) codemode on multi-step tasks (tokens, steps, success) would test the Cloudflare/Anthropic claims on *our* models. See Q1.

---

## 7. Open questions for discussion

1. **Which language does the model write?** *(a)* beam-lisp only: matches "language = harness = runtime", scripts are data, replayable; risk: weaker training prior than JS/Python, so more syntax slips (CodeAct, Cloudflare and smolagents all lean on code-in-training-data). *(b)* beam-lisp *and* a JS/TS escape (QuickJS-NIF or Deno subprocess): best prior, but reintroduces a second runtime. *(c)* a deliberately Clojure-shaped subset like PTC-Lisp, which is what Spell uses today. A small eval (Q-evals above) would settle this empirically. Recommendation: (a), with a strong in-description idiom cheat-sheet and `doc`/`apropos` helpers, then measure.
2. **How strong must the sandbox be?** *(a)* env caps `[]` + process + heap + deadline (what exists, §5.2): fast, in-VM, but depends on an *unaudited* "what is reachable from `core` with no caps" surface and cannot bound atoms. *(b)* a separate BEAM node per script (strongest, per `trust-boundary.md`): ~100s of ms startup, cross-node tool RPC (serialisation reappears). *(c)* (a) now, (b) as a mode for untrusted/third-party models or MCP-sourced scripts. Needs a one-off audit of `core` first.
3. **Transactions: how far?** *(a)* none, like pi (simplest; footer lists effects). *(b)* file-overlay only (Spell's behaviour). *(c)* overlay + up-front refusal of un-rollbackable mixes via the effect lattice (my proposal; needs the pre-pass over quoted forms to be sound, and `eff-walk` currently returns `:unknown` for any callee it can't see, so it would over-refuse). Tradeoff: safety vs "why did my script get refused".
4. **JSON at the boundary or BEAM terms inside?** Terms: no conversion bugs, richer values, handles possible; but tool authors can leak non-serialisable things into scripts and into the trace/store (how is a pid or fun stored as a fact?). Need a "pure data" predicate (the effect lattice can't help: values, not code) and a clear rule that `store`/facts accept EDN-able terms only.
5. **Should scripts be able to spawn processes / tasks?** Pi: no (`codemode` is `model-only`). In omega a task *is* the unit of concurrency, so the natural answer is **a script can never start a task directly; it can only call an `omega.tasks/*` tool (irreversible, authority-checked)**. Alternatively allow in-script `future`/`pmap` over *tools* (parallel tool calls) but never raw `spawn`. Which concurrency primitives belong in the sandbox vocabulary (`future`, `pmap`, `psettled`-style)?
6. **Discovery: BM25 over tool metadata, or the code index?** Keep pi's BM25 behind `ToolRanker` (small, deterministic, offline). Or index tools as facts and query with datalog + `code-semantic-search`: uniform with code search, enabling "find tools that produce a `:file/path`". More power, more machinery, and nondeterminism if embeddings are used. Start BM25; decide the seam now.
7. **Exposure default for MCP-sourced tools.** pi defaults to `codemode` (not declared, reachable via scripts). Do we also make *omega's built-in* tools (read/edit/bash) `direct`, `codemode`, or both? `on` vs `only` mode. Tradeoff: fewer tokens and chaining vs the model losing a simple, robust single-call path for trivial reads (pi keeps `direct` as default for exactly this reason). Is `only` ever the default for any model?
8. **Where do tool declarations live?** Derive from `defn` metadata (but `meta` returned `nil` in my probe, so docstrings aren't there yet: fix in beam-lisp, or maintain a parallel `:doc/:sig` table), from JSON Schema (MCP), or both. A single source of truth per tool is required (no parallel impls).
9. **Result handles vs always-realise.** Handles (Spell) keep big results off-heap, but add a new value type the model must learn (`realise`), and handle lifetimes tied to the task. pi has no equivalent, and a 256 MB cap is its guard rail. Take handles from day one or add when we hit the first big-result pain?
10. **Persistence granularity of `store`.** pi: per-session-branch via custom entries. Omega: per task as facts (visible to siblings = stigmergy) vs private to the script/task (safer). Is script state *world-readable by default*? Probably task-scoped with explicit `(publish k v)`, but then `publish` is an irreversible effect.
11. **Typed decisions (Jev) inside scripts.** A `(decide …)` host fn calling Jev for a typed choice would give scripts a principled "ask a classifier" like pi's `models.classify`. Needs: confinement of the key (script never sees `TYPESAFE_API_KEY`), a concurrency limiter, and cost accounting into the task. In scope for codemode, or a separate coordination primitive?
12. **Budget defaults.** pi: inline budget 3000 tokens, output budget 10000 tokens, no default timeout, 256 MiB heap. Spell: 1 s timeout, ~50 MB heap, 30 s ceiling. Omega is a long-running task harness, so a long default deadline is plausible; but an unbounded default with no model-visible clock invites hangs. Which numbers, and who may raise them (the script's header, or only the harness)?
