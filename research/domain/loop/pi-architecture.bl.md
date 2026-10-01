# Pi architecture, read for omega

Pi (earendil-works/pi, "pi-mono") is a minimal, extensible coding-agent harness built as layered TypeScript packages: `ai` (provider abstraction) → `agent` (the loop) → `coding-agent` (tools, sessions, extensions, modes), with a newer experimental stack (`durable`, `chord`, `protocol`, `server`, `client`) that moves toward durable, multi-presentation, task-graph agents. This document records how each layer actually works (read from source at `research/vendor/pi`), then says what omega should take, adapt or drop given omega's two deviations: **a prompt is a task, not a chat** (tasks know their scope, are discoverable, coordinate stigmergically via traces/messages/waits on beam-lisp `proc`), and **language = harness = runtime**. Two small runnable beam-lisp models (the tool-call loop with steering/follow-up queues, and the session tree with compaction) pin the mechanics down; everything else is quoted or cited.

Convention: **[OBS]** = read in source/docs or run; **[INF]** = my inference; **[PROP]** = proposal for omega.

## 1. Sources

All paths relative to `/home/user/code/undefine/omega/research/vendor/pi/` unless noted.

| Area | Files (lines) |
|---|---|
| Philosophy / overview | `README.md:1-60`; `packages/coding-agent/README.md:15-20`; `packages/coding-agent/docs/how-pi-works.md` (all); `docs/index.md`; `docs/quickstart.md:94-106` ("Choose how to customize Pi") |
| Agent loop | `packages/agent/src/agent-loop.ts:163-332` (`runLoop`), `:333-380` (`declareToolChanges`), `:381-477` (`streamAssistantResponse`), `:478-507` (truncated-call failure), `:508-682` (tool execution), `:707-920` (prepare/execute/finalize); `packages/agent/src/agent.ts:134-155,191-205,299-342,376-410,495-525` (`Agent`, queues, abort); `packages/agent/src/types.ts:47-135,193-215,349-380,424-529` |
| Harness (durable successor) | `packages/agent/docs/harness.md:1-40`; `packages/agent/docs/runtime-simplification.md:1-25`; `packages/agent/src/harness/*` |
| ai package | `packages/ai/src/types.ts:17-29,84-86,286-306,316-332,389-450,522-610,633-660,715-790,1097-1156`; `packages/ai/src/models.ts:144-175,244,985-1034`; `packages/ai/src/utils/event-stream.ts:1-80`; `packages/ai/src/providers/typesafe.ts:1-20`; `packages/ai/src/api/typesafe-system-one.ts:1-30`; `packages/ai/README.md` (TOC `:9-60`) |
| coding-agent core | `src/core/agent-session.ts:190-234,362`; `src/core/sdk.ts:175`; `src/core/session-manager.ts:372-600,987,1497`; `src/core/system-prompt.ts:1-216`; `src/core/skills.ts:355-383`; `src/core/tools/{read,edit,write,bash,file-mutation-queue}.ts`; `src/main.ts:113-116`; `src/modes/{print-mode.ts,rpc/*,interactive/*}` (all under `packages/coding-agent/`) |
| coding-agent docs | `docs/session-format.md` (all); `docs/compaction.md:1-158`; `docs/extensions.md:1-135`; `docs/skills.md:1-80`; `docs/prompt-templates.md:1-50`; `docs/settings.md:1-70`; `docs/rpc.md:1-60`; `docs/rpc-commands.md:5-45` |
| Extension API | `src/core/extensions/types.ts:509 (ToolExposure), 565 (ToolDefinition), 900 (before_agent_start), 1540-1872 (ExtensionAPI)`; `examples/extensions/jev-router.ts:1-50` |
| Secondary packages | READMEs: `packages/{tui,protocol,server,client,durable,chord,telemetry,evals,codemode}/README.md`; `packages/session-backends/sqlite-node/README.md`; `packages/durable/README.md:78-99,444-486` |
| beam-lisp (read-only) | `/home/user/code/undefine/beam-lisp--repl/priv/lib/harness.bl:1-60`, `harness/doc.bl:1-12`, `harness/model.bl:1-30`, `gen/llm.bl:1-25`, `loom/desktop.bl:1-20`, `wry.bl:1-10`, `mcp/server.bl:1-12`; `priv/std/proc.bl:1-50`, `priv/std/proc/*.bl` headers |

URLs: `https://pi.dev` (docs site, referenced from README; not fetched), `https://agentskills.io/specification` (skills spec, referenced from `docs/skills.md`).

## 2. Design philosophy: minimal core, extensions for everything

[OBS] Pi's own words: "Pi is a minimal, extensible AI agent for the terminal. Adapt Pi to your workflow, not the other way around." (`packages/coding-agent/README.md:17`). "Ask Pi to create the prompt templates, skills, extensions, and themes you need". The customization ladder is explicit — *"Start with the least powerful mechanism that meets your need"* (`docs/quickstart.md:96`):

| Need | Mechanism |
|---|---|
| persistent instructions | `AGENTS.md` context file |
| reusable prompt | prompt template (`/name`) |
| task-specific instructions + files | skill (`SKILL.md`, loaded on demand) |
| executable tools/commands/handlers | extension (TS module in-process) |
| custom terminal component | TUI component |
| unsupported model service | custom provider |
| distribute several | pi package (npm/git) |

[OBS] Security stance (`README.md` "Permissions & Containerization"): *no built-in permission system*; tools and extensions run with the process's OS permissions; containerize (Docker, Gondolin micro-VM, OpenShell) if you need a boundary. "Project trust" only gates which project resources load (`docs/how-pi-works.md` last section).

[OBS] Default toolset is four tools: `read`, `bash`, `edit`, `write` (`system-prompt.ts:75` `selectedTools ?? ["read","bash","edit","write"]`; `docs/settings.md` `defaultTools`). `grep`, `find`, `ls`, `powershell` exist but are opt-in. Sub-agents, plan mode, MCP, permission gates are *extensions* (`examples/extensions/subagent`, `plan-mode`, `permission-gate.ts`, `docs/mcp.md`).

[OBS] Repo rule worth stealing (`AGENTS.md` "Code Quality"): "Inline single-line helpers that have only one call site", "No inline imports", "Do not preserve backward compatibility unless the user asks" — same cutover discipline omega's contract states.

## 3. The agent loop (`packages/agent`)

### 3.1 Shape [OBS]

`how-pi-works.md`: a submitted message joins the active branch; Pi builds a request (system prompt + active branch + tools + model settings); the provider streams an assistant message that may hold text and tool calls; Pi records it, executes each tool call, records results — **that is one turn**. If tool results or queued messages need another request → another turn, else the run ends. **Steering** messages enter *after the current assistant turn's tools finish, before the next LLM call*; **follow-up** messages enter *only once the agent would otherwise stop*; **abort** stops the run and returns queued messages to the editor.

The whole control flow is one function, `runLoop` (`agent-loop.ts:163-332`):

```ts
let pendingMessages = (await config.getSteeringMessages?.()) || [];
while (true) {                                   // outer: follow-up loop
  let hasMoreToolCalls = true;
  while (hasMoreToolCalls || pendingMessages.length > 0) {   // inner: turn loop
    // prepareNextTurn (e.g. compaction), catch-up steering poll, emit turn_start
    // inject pending (steering/follow-up) messages into context
    // prepareRequest hook (may swap model/thinking level)
    const message = await streamAssistantResponse(...);
    if (message.stopReason === "error" || message.stopReason === "aborted") { ...emit agent_end; return; }
    const toolCalls = message.content.filter((c) => c.type === "toolCall");
    if (toolCalls.length > 0) {
      const batch = message.stopReason === "length"
        ? await failToolCallsFromTruncatedMessage(toolCalls, emit)   // never run truncated args
        : await executeToolCalls(currentContext, message, config, signal, emit);
      hasMoreToolCalls = !batch.terminate;
    }
    const decision = await config.finishTurn?.(lastCompletedTurn, signal); // {action:"continue"|"end"}
    pendingMessages = (await config.getSteeringMessages?.()) || [];
  }
  const followUp = (await config.getFollowUpMessages?.()) || [];
  if (followUp.length > 0) { pendingMessages = followUp; continue; }
  break;
}
```

### 3.2 Events [OBS] (`types.ts:514-529`)

`agent_start/agent_end` · `turn_start/turn_end{message,toolResults}` · `message_start/message_update{assistantMessageEvent}/message_end` (for system, user, assistant, toolResult) · `tool_execution_start/update/end`. Everything above the loop (UI, RPC, extensions, persistence) is a subscriber of this one event stream. `AgentSession` adds `queue_update`, `compaction_start/end`, `auto_retry_*`, `entry_appended`, `session_info_changed`, `bash_execution_update` (`agent-session.ts:190-232`).

### 3.3 Tool-call cycle [OBS]

- `AgentTool` = `Tool` (name, description, TypeBox `parameters`) + `label`, `prepareArguments` (pre-validation shim), `outputSchema`, `execute(toolCallId, params, signal, onUpdate)`, `replay: "never"|"safe"` (durable recovery policy for unknown-outcome effects), `executionMode: "sequential"|"parallel"` (`types.ts:464-497`).
- Hooks in `AgentLoopConfig`: `beforeToolCall → {block, reason, terminate}` (`:66`), `afterToolCall → {content, details, isError, terminate…}` field-wise replace (`:92`), `convertToLlm`, `transformContext`, `prepareRequest`, `prepareNextTurn`, `finishTurn`, `getSteeringMessages`, `getFollowUpMessages`.
- Execution: if config is `sequential` or *any* call in the batch is tagged `sequential`, run in order; otherwise `executeToolCallsParallel` (`:508-530,586`) — calls are *prepared* (validated, `beforeToolCall`) in source order, *executed* concurrently, and results are emitted in source order. A batch terminates the run early only if **every** finalized result sets `terminate` (`:689`).
- Failure is data: thrown tool errors become `isError` results (`createErrorToolResult`, `:905`); aborted-before-start tools yield "Operation aborted".
- Tools that mutate files serialize per realpath via `withFileMutationQueue` (`coding-agent/src/core/tools/file-mutation-queue.ts:27-61`): a promise-chain keyed by canonical path, different files stay parallel.

### 3.4 Queues & abort [OBS]

`Agent` (`agent.ts:134-155,299-342`) owns two `PendingMessageQueue`s with mode `"one-at-a-time"` (default) or `"all"`; `steer(m)`, `followUp(m)`, `clearSteeringQueue()`, `clearAllQueues()`, `abort()` (aborts the `AbortController` of the single `activeRun`). A second `prompt()` while running throws: *"Use steer() or followUp() to queue messages"* (`:376`). Over RPC: `prompt` during a run requires `streamingBehavior: "steer" | "followUp"` (`rpc-commands.md:20-29`). Abort is cooperative: one `AbortSignal` is threaded through `streamFn`, `convertToLlm`, every `execute`, and the hooks.

### 3.5 Runnable model of the cycle [OBS: ran with `bl run`]

The pi loop is small enough to restate in beam-lisp exactly: inner loop = tool results or pending steering; outer loop = follow-ups. Here steering = a queue drained at turn boundaries; the "model" is a stub.

```beam-lisp
(defn run-loop
  "Toy pi loop: model = fn [ctx] -> assistant msg. Returns final transcript + events."
  [model tools steering follow-up]
  (loop [ctx [] pending (steering) events []]
    (let [ctx (into ctx pending)
          msg (model ctx)
          ctx (conj ctx msg)
          calls (:calls msg)
          results (mapv (fn [c] {:role :tool :id (:id c) :out ((get tools (:name c)) (:args c))}) calls)
          ctx (into ctx results)
          events (conj events [:turn-end (count calls)])
          steer (steering)]
      (cond
        (or (seq calls) (seq steer)) (recur ctx steer events)
        :else (let [fu (follow-up)]
                (if (seq fu) (recur ctx fu events) {:ctx ctx :events events}))))))

(let [q-steer (atom [{:role :user :text "also fix tests"}])
      q-fu (atom [])
      drain (fn [a] (fn [] (let [v @a] (reset! a []) v)))
      model (fn [ctx] (if (some #(= (:role %) :tool) ctx)
                        {:role :assistant :text "done" :calls []}
                        {:role :assistant :text "reading" :calls [{:id "c1" :name :read :args "a.txt"}]}))
      r (run-loop model {:read (fn [p] (str "contents of " p))} (drain q-steer) (drain q-fu))]
  (println (map :role (:ctx r)) (:events r))
  (assert (= [:user :assistant :tool :assistant] (map :role (:ctx r)))))
```

[INF] In beam-lisp, a task's loop is a process; `steer` = a message into its mailbox drained at turn boundaries (selective `receive` with zero timeout), `follow-up` = mailbox drained only at quiescence, `abort` = `exit`/monitor or a cancel message, per-tool parallelism = `pmap`/spawned workers under `proc.fence` (bounded isolation, `priv/std/proc/fence.bl`).

### 3.6 The newer durable harness [OBS]

`packages/agent/docs/harness.md` (a normative spec, many parts) and `packages/durable` replace the in-memory loop with a **state machine of operations** over an entry tree: "`accept` durably creates an operation, `drive` advances an expected operation, `requestAbort` durably requests cancellation, `inspectExec…`" (`harness.md` §0.2). Every effect is a four-phase `prepare immutable input → publish durable intent → perform effect → publish durable outcome` (`runtime-simplification.md:19`), and tools declare `replay: "never"|"safe"` for the intent-without-outcome case after a crash. 38 invariants and a race catalog (`harness.md` Part 9). [INF] This is the same problem (resumable agent work) that BEAM solves with supervised processes + a datom/fact log; omega should take the *operation-phase vocabulary*, not the machinery.

## 4. `packages/ai`: provider abstraction

### 4.1 Message and content types [OBS] (`types.ts`)

- Content blocks: `TextContent{text,textSignature?}`, `ThinkingContent{thinking,thinkingSignature?,redacted?}`, `ImageContent{data,mimeType}`, `ToolCall{id,name,arguments,thoughtSignature?,namespace?}` (`:389-425`). Signatures exist so providers can replay opaque reasoning.
- Messages (`:522-610`): `SystemMessage{content, sections?, toolsAdded?, toolsRemoved?}`, `UserMessage`, `AssistantMessage{content, api, provider, model, usage, stopReason, errorMessage?, diagnostics?, deferred?}`, `ToolResultMessage{toolCallId,toolName,content,isError,details?}`.
- `StopReason = "pending"|"stop"|"length"|"toolUse"|"error"|"aborted"|"deferred"` (`:450`). `Usage{input,output,cacheRead,cacheWrite,reasoning?,totalTokens,cost{…}}` (`:427`).
- **System prompt as a patchable transcript entry**: the leading `SystemMessage` declares named `sections`; later system messages replace a section by name or remove it with `null`, and add/remove tools (`toolsAdded/toolsRemoved`). Replaying them yields the current prompt+toolset (`:522-538`; `session-format.md` "SessionMessageEntry"; `agent-loop.ts:333-380` computes the delta before each request). Rationale [INF]: keeps the prompt-cache prefix stable and makes toolset changes an auditable event.
- `AgentMessage = Message | CustomAgentMessages[...]` (open union via declaration merging, `agent/types.ts:365-374`); `convertToLlm` maps/filters app messages to LLM messages before every call — the seam by which UI-only/custom messages stay out of context.

### 4.2 Streaming events [OBS] (`types.ts:767-787`)

`start` → (`text_*` | `thinking_*` | `toolcall_*`)`_start/_delta/_end` each carrying `contentIndex` and a live `partial: AssistantMessage` → terminal `done{reason,message}` or `error{reason: aborted|error, error: AssistantMessage}`. Errors are **in-band**: a stream never throws after `start`; failures finalize an `AssistantMessage` with `stopReason:"error"`. The carrier is a push/pull `EventStream<T,R>` with a final-result promise (`utils/event-stream.ts:22-80`) — an async iterable + `result()`.

### 4.3 Provider abstraction [OBS]

- `Api` = wire protocol id (`openai-completions`, `openai-responses`, `anthropic-messages`, `bedrock-converse-stream`, `google-generative-ai`, `google-vertex`, `mistral-conversations`, `azure-openai-responses`, `openai-codex-responses`, `pi-messages`; extensible `string`), `Provider` = auth + base URL + model catalog (`models.ts:144-175`), `Model` = `{id,name,api,provider,baseUrl,input[text|image],cost,contextWindow,maxTokens,reasoning,thinkingLevelMap,promptCache,compat?}` (`:1097-1142`). Many providers share one `Api`; per-API `compat` flags absorb OpenAI-compatible quirks.
- `ProviderStreams` contract (`:286`): `stream(model, context, options)` and `streamSimple(...)` returning `AssistantMessageEventStream`, optional `fetchDeferred/cancelDeferred` for async/background responses. `createProvider({id, auth, models, streams…})` (`models.ts:1034`); `createModels()` registry (`:985`). Auth resolves env var / OAuth / credential store (`providers/typesafe.ts:8-12`: `envApiKeyAuth("TypeSafe API key", ["TYPESAFE_API_KEY"])`).
- Cross-provider hand-off mid-session (README "Cross-Provider Handoffs") via `transform-messages.ts`; thinking-level mapping per model (`ThinkingLevel off|minimal|low|medium|high|xhigh|max`, `clampThinkingLevel`, `models.ts:1217-1250`); `faux` provider for tests (`providers/faux.ts`); retry/overflow detection utils (`utils/retry.ts`, `overflow.ts`).
- **Third operation: classifier.** Besides chat and image generation, `ProviderClassifier.classify(model, {state, questions}, opts)` returns typed answers for `choice | score | bool` questions (`types.ts:316-332,633-690`), with `typesafe-system-one` as an API (`api/typesafe-system-one.ts`, key `TYPESAFE_API_KEY`) and `jev-router.ts` using it to route models. This is the same "Jev / System One typed decision" omega wants for coordination. [INF] Take the *question shape* (`instructions` + `criteria` map, `bool`/`choice`/`score`) as the omega decision-request value.

## 5. coding-agent

### 5.1 Layering [OBS]

`createAgentSession(options)` (`sdk.ts:175`) assembles `ModelRuntime`, `ResourceLoader` (context files, skills, templates, extensions, themes), `SettingsManager`, `SessionManager`, then an `AgentSession` (`agent-session.ts:362`, 4.3k lines) wrapping `Agent`. `AgentSession` is the single object every mode drives. Pi's SDK slogan: "omit to discover, provide to override" (CHANGELOG 5247).

### 5.2 Built-in tools [OBS]

`read` (offset/limit, images as attachments, 2000-line/50KB-ish truncation constants from `truncate.ts`), `write`, `edit` (multi-edit: `edits[{oldText,newText}]`, each matched against the **original** file, unique & non-overlapping; `edit.ts:20-40,149-153`), `bash` (cwd, timeout, tail-truncation with full output spilled to a temp file; `bash.ts:41-58,258`), `grep`, `find`, `ls`, `powershell`. Each tool is a `ToolDefinition` with `promptSnippet` (one line in the system prompt's tool list) and `promptGuidelines` (bullets merged, de-duplicated into "rules", `system-prompt.ts:76-114`). Pluggable `*Operations` objects (e.g. `BashOperations`) let an extension reroute a tool to SSH/VM without reimplementing it. Edit tool declares `constrainedSampling: json_schema strict "prefer"`.

### 5.3 System prompt [OBS] (`system-prompt.ts:121-216`)

Built as ordered named sections: `preamble` (untagged: "You are an expert coding assistant operating inside pi…"), `tools`, `rules`, `docs`, `addendum`, `project_context` (AGENTS.md files as `<project_instructions path=…>`), `skills`, `cwd`, plus extension `sections`; each non-preamble section wrapped `<name>…</name>`. `diffSystemPromptSections(prev, current)` (`:204`) yields the patch persisted as a system message. `--system-prompt`/`customPrompt` replaces the preamble; `forceSystemPrompt` replaces everything.

### 5.4 Sessions: tree in JSONL; branching; compaction [OBS]

- File: `~/.pi/agent/sessions/--<cwd-path>--/<timestamp>_<id>.jsonl` (`session-format.md`). Header line `{"type":"session","version":3,"id","timestamp","cwd","parentSession?"}`, then entries `{type,id,parentId,timestamp,…}` — **append-only tree**; the current leaf selects the active branch.
- Entry types: `message` (an `AgentMessage`), `model_change`, `thinking_level_change`, `usage` (non-context spend, e.g. `cache_warm`), `compaction{summary,firstKeptEntryId,tokensBefore,systemMessage?,details}`, `context_edit{targetId,replacement}` (append-only edit/omission of one earlier entry, branch-relative), `branch_summary{fromId,summary}`, `custom{customType,data}` (extension state, *not* in context), `custom_message{customType,content,display}` (*in* context), `label`, `session_info`.
- Branch = continue from an earlier entry (same file); `/fork`, `/clone` copy history into a new file with `parentSession`. Context = walk leaf→root; a compaction entry replaces everything before `firstKeptEntryId` by its summary (`session-manager.ts:476-600` `buildContextEntries/buildSessionContext`).
- Compaction (`docs/compaction.md`): triggers when `contextTokens > contextWindow − reserveTokens` (default reserve 16384) checked in `prepareNextTurn` between turns; keep ~20k recent tokens; cut points only at user/assistant/bash/custom messages (never tool results); split-turn case produces two merged summaries; summary is structured, iterative (previous summary passed in), and tracks read/modified files in `details`; overflow/`length` errors trigger one compact-and-retry. Branch summarization does the same when navigating `/tree` away from a branch. Both extension-hookable (`session_before_compact`).
- Storage seam: `packages/session-backends/sqlite-node` and `durable`'s `Storage` swap JSONL for SQLite behind a `SessionRepo`.

Runnable model of tree + compaction context building:

```beam-lisp
(defn path-to-root [entries leaf]
  (loop [id leaf acc '()]
    (if (nil? id) (vec acc)
        (let [e (get entries id)] (recur (:parent e) (cons e acc))))))

(defn build-context
  "pi buildSessionContext: walk leaf->root; a :compaction entry replaces everything before :first-kept."
  [entries leaf]
  (let [path (path-to-root entries leaf)
        cmp (last (filter #(= :compaction (:type %)) path))]
    (if cmp
      (let [kept (drop-while #(not= (:first-kept cmp) (:id %)) path)
            kept (remove #(= :compaction (:type %)) kept)]
        (into [{:role :user :text (str "[summary] " (:summary cmp))}] (map :msg kept)))
      (mapv :msg (filter #(= :message (:type %)) path)))))

(let [es (into {} (map (juxt :id identity))
          [{:id "a" :parent nil :type :message :msg {:role :user :text "q1"}}
           {:id "b" :parent "a" :type :message :msg {:role :assistant :text "a1"}}
           {:id "c" :parent "b" :type :message :msg {:role :user :text "q2"}}
           {:id "d" :parent "c" :type :compaction :summary "q1/a1 happened" :first-kept "c"}
           {:id "e" :parent "d" :type :message :msg {:role :assistant :text "a2"}}
           {:id "x" :parent "b" :type :message :msg {:role :user :text "branch q2'"}}])]
  (println (map :text (build-context es "e")))
  (println (map :text (build-context es "x")))
  (assert (= ["[summary] q1/a1 happened" "q2" "a2"] (mapv :text (build-context es "e"))))
  (assert (= ["q1" "a1" "branch q2'"] (mapv :text (build-context es "x")))))
```

### 5.5 Extension API [OBS]

An extension is a TS module whose default export is a factory `(pi: ExtensionAPI) => void|Promise` (`docs/extensions.md:13-40`), loaded with `jiti` (no build step), in-process, same permissions. Don't start resources in the factory; use `session_start`/`session_shutdown`.

- **Events** via `pi.on(name, handler)` (`types.ts:1545-1612`): `project_trust`, `resources_discover`, `session_start/shutdown/compact/tree/…`, `context`, `context_with_system`, `before_agent_start` (gets structured `systemPromptOptions`), `before_provider_headers`, `after_provider_response`, `provider_stream_event`, `agent_start/end/before_settle/settled`, `turn_start/end`, `message_start/update/end`, `tool_execution_*`, `model_select`, `thinking_level_select`, `tool_call` (may mutate/block), `tool_result` (handlers compose), `user_bash`, `input`. Handlers run in registration order; some notify, some transform/cancel/replace. `turn_end` and `agent_before_settle` are *actionable boundaries*: a handler may append `custom/custom_message/context_edit/compaction` entries and return `continue:true` for one more model request.
- **Registration**: `registerTool` (`ToolDefinition` adds `promptSnippet`, `promptGuidelines`, `renderShell`, `exposure: "direct"|"model-only"|"codemode"|"deferred"|"hidden"` (`:509`), annotations like MCP's `readOnlyHint/destructiveHint`), `registerCommand`, `registerShortcut`, `registerFlag`, `registerMessageRenderer`, `registerEntryRenderer`, `registerProvider`, `registerMcpServer`, `registerVirtualModel` (router: `route(request, ctx) → {model, thinkingLevel, state}`; state stored on the session branch).
- **Control**: `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `setLabel`, `exec`, `getActiveTools/setActiveTools`, `setModel`, `setThinkingLevel`, `getCommands`, `pi.events` (inter-extension bus).
- **UI**: `ctx.ui.notify/confirm/select/custom…` ; in RPC mode forwarded as `extension_ui_request/response` records (`rpc-extension-ui.md`).
- Example showing minimal extensions at work: `jev-router.ts` (plan on a strong model, implement on a cheap one, classifier-rated), `permission-gate.ts`, `plan-mode/`, `subagent/`.

### 5.6 Skills, prompt templates, settings [OBS]

- **Skill** = dir with `SKILL.md` (frontmatter `name`, `description`, `disable-model-invocation`, `allowed-tools`…; Agent Skills spec). Only name+description+path go in the system prompt (`formatSkillsForPrompt`, `skills.ts:355-383`, emits `<available_skills><skill><name/><description/><location/></skill>…`); the model loads the body with `read`. `/skill:name args` forces it. Progressive disclosure = cheap routing.
- **Prompt template** = `prompts/<name>.md` with frontmatter `description`, `argument-hint`; `$1 $@ ${1:-default} ${@:N:L}` substitutions; expanded *before* becoming a user message.
- **Settings**: JSON, global `~/.pi/agent/settings.json` + project `.pi/settings.json` (project overrides; resource lists merge): model/thinking defaults, `steeringMode`, `followUpMode`, `defaultTools` with `+name/-name` deltas, `compaction.*`, `sessionDir`, `cacheWarming`, `codemode.*` (`docs/settings.md`).
- **Context files**: `AGENTS.md` discovered up the tree into `project_context`.

### 5.7 Modes [OBS]

All modes drive one `AgentSession` (`how-pi-works.md` "Interfaces"):
1. **Interactive** (`modes/interactive`, uses `pi-tui`): editor, chat viewport, `/tree`, `/fork`, `/compact`, model cycling.
2. **Print** (`print-mode.ts`): `pi -p "prompt"` text, or `--mode json` → agent events as JSONL.
3. **RPC** (`modes/rpc`, `docs/rpc*.md`): JSONL over stdin/stdout, strict LF framing; commands `prompt, steer, follow_up, abort, clear_queue, new_session, get_state, get_messages, set_model, cycle_model, set_thinking_level, set_*_mode, compact, set_auto_compaction, set_auto_retry, bash, abort_bash, get_session_stats, export_html, switch_session, fork, clone, get_entries, get_tree, get_last_assistant_text, set_session_name, get_commands`; each may carry an `id` echoed in `{"type":"response",…}`; session events stream without ids. `prompt` response = *accepted* (`started|queued|handled`), not *finished*.
4. **SDK**: `createAgentSession()` in-process, same events.

## 6. The other packages (one section each)

- **tui** — [OBS] "Minimal terminal UI framework with differential rendering and synchronized output (CSI 2026)"; `Component{render()}` tree, main-screen and alt-screen renderers behind one `TUI` interface, built-in `Editor/Markdown/SelectList/ScrollView/…`, Kitty/iTerm2 inline images, theme interfaces, native module for modifiers (`packages/tui/README.md:1-20`, `src/tui*.ts`). Relevance: reference for omega's ratatui-wrapper TUI API (component set, themes-as-interfaces, alt-screen viewport with app-owned scrolling).
- **protocol** — [OBS] "Runtime-neutral routed envelopes, CBOR encoding, byte-stream framing", version 8: hello handshake with `serverId`; targets `{serverId}` or `{serverId, sessionId, attachmentId}`; correlated requests/responses with opaque JSON payloads; cancellation, subscription updates, attachment changes; 4-byte BE length + CBOR frame. Payload semantics belong to chord (`protocol/README.md:1-30`).
- **server** — [OBS] experimental local server routing facet-service calls to durable **Sessions** with *multi-presentation attachment* (several UIs attached to one session, each with a server-generated `attachmentId`); `SessionDirectory` (replicated catalog), `SessionManagement`; unix/ws transports (`server/README.md`).
- **client** — [OBS] transport-neutral `Client.connect({serverId, transportFactory})`; verifies logical `serverId`; `request(target, {serviceId, member, args})`; typed APIs come from chord bindings; never auto-reconnects or replays (`client/README.md`).
- **durable** — [OBS] "durable agent harness": storage commits before display; vocabulary **Harness / Conversation / Entry / Commit / Document / Task / Submission / Extension / Registry / Agent** (`durable/README.md:78-90`). Tasks are checkpointed state machines that **own child tasks** and `wait` on them with `allSettled` or `failFast` policy; abort runs bottom-up; `harness.taskGraph()` exposes live tasks (owner edge, status pending/running/waiting/completing) as one observable state (`:444-486`). Submissions have idempotent `requestId`. **This is the closest pi gets to omega's "tasks"** — but conversation-owned and tree-shaped, not stigmergic.
- **session-backends** — [OBS] only `sqlite-node/`: `SqliteSessionRepo` + `createNodeSqliteFactory()` implementing `SessionRepo` for agent-core (`create`, `createBranch`, `appendMessage`…).
- **chord** — [OBS] "application-composition runtime" (explicitly *not* pi-specific): plugins → *facets* (backend/browser/TUI pieces bundled separately), typed *services* (singleton or keyed instance), *replicated state* (`change(ctx, draft => …)` atomic overlay transactions; consumers get immutable snapshots; unready on disconnect), remote-service boundary, dependency-ordered activation/disposal (`chord/README.md:1-45`). [INF] It is pi's answer to "one feature, several front-ends" — what omega gets for free from BEAM processes + loom live state.
- **telemetry** — [OBS] vendor-neutral, explicit-context (`TelemetryContext.startSpan({name}, cb(span))`, no global current span), `NOOP_TELEMETRY_CONTEXT`, `InMemoryTelemetryContext` reference adapter, typed schemas, conformance tests.
- **evals** — [OBS] `vitest-evals` behavioural evals; `*.docs.eval.ts` run each case twice in Docker (`without_docs` / `with_docs`) and report documentation *lift*; host evals run locally (`PI_PROVIDER`, `PI_MODEL`); `plan.ts` expands (case, variant, repetition).
- **codemode** (brief; sibling file covers it) — [OBS] QuickJS-in-WASM sandbox where model-written JS can only call injected tools; nested tool calls stay out of LLM context (`codemode/README.md:1-5`). Surfaces in settings as `codemode` tool and `ToolExposure "codemode"`.

## 7. Take / adapt / drop for omega (mapped to "tasks, not chats")

Core reframing [PROP]: a pi *session* is one linear-ish conversation with a human; an omega **task** is a process with a scope, a transcript (its own tree), a mailbox, and traces in a shared environment. Pi's session concepts therefore split: *what a task remembers* (entries/tree/compaction) stays; *who is talking* (the single editor ↔ agent pairing) becomes messages between tasks (a human front-end is just another sender).

| Pi concept | Verdict | Reason | As a task |
|---|---|---|---|
| Turn = assistant response + tool calls; two nested loops | **Take verbatim** | Small, proven; matches the runnable model above | Task body is that loop in one process; `turn_end` is where it checks mailbox |
| Steer vs follow-up queues | **Adapt** | Exactly "messages from other tasks/users": steer = interrupt at next boundary, follow-up = when idle | Both are mailbox classes; a *peer task* can steer, not only the human; delivery mode (`all`/`one-at-a-time`) stays a setting |
| `abort` via `AbortSignal` | **Adapt** | BEAM gives monitors/links/exit signals; no cooperative-only flag needed | Abort = cancel message or exit; **children abort bottom-up** like `durable` tasks |
| `AgentEvent` stream as the one observation bus | **Take** | UI, RPC, persistence, telemetry all subscribe | Events are also *traces* written to the shared environment (stigmergy substrate) |
| `AgentTool` + `beforeToolCall/afterToolCall` hooks | **Take** | Hook points are the right permission/audit seam | Hooks = ordinary functions in task config; Jev can be a `beforeToolCall` decider |
| Parallel tool execution, per-tool `sequential`, per-path mutation queue | **Take** | Real correctness need | Per-path queue = a registered process per path (`proc.reg`), or a lock fact in the environment |
| `terminate` hint, `finishTurn {continue|end}` | **Adapt** | Needed for "task is done" detection | Task completion is a *typed decision*/result value posted to the environment, awaited by dependents |
| `AssistantMessage` / content blocks / `StopReason` / `Usage` | **Take shapes** | Provider-neutral, in-band errors | Plain maps with keyword roles |
| `AssistantMessageEvent` stream | **Adapt** | In beam-lisp a stream is messages to a subscriber pid or a `proc.flow` demand-driven stream (backpressure) | Subscribers can be other tasks |
| `Provider/Api/Model` + `compat` | **Take, shrunk** | Needed; omega already has `ora/relay` and `gen.llm` | Provider = map; one `chat` seam |
| Classifier op (`choice/score/bool` + criteria) | **Take** | The Jev decision shape | The coordination primitive: "is task B's output sufficient?", "which task should handle this?" |
| Patchable `SystemMessage.sections` + tool deltas | **Take** | Cache-stable, auditable, extensions add sections | A task's *scope statement* is a section; scope changes are patches |
| JSONL tree with `id/parentId` | **Adapt** | Tree is right; JSONL file less so | Omega's `harness.doc` already makes a session a `.bl.md` doc (`priv/lib/harness.bl:1-40`); decide the one source of truth (see Q2) |
| Compaction + `firstKeptEntryId` + branch summaries | **Take** | Entry-immutable + projection is the right invariant | Per-task; a *summary entry can itself be a trace* other tasks read |
| `custom` vs `custom_message` entries | **Take** | Clean split: state vs context | `custom` ≈ task-private facts; `custom_message` ≈ injected context |
| `context_edit` (append-only omission) | **Take** | Edit history without mutation | Same |
| Extensions in-process TS with `pi.on` | **Adapt** | In beam-lisp the language *is* the extension language | Extension = bundle (ns) registering handlers/tools/commands in an env map; hot-reload native |
| `ExtensionAPI` registration surface | **Adapt** | Keep the verbs (tool, command, provider, renderer, event) | Each is a registry entry (`proc.reg`) |
| `ToolExposure` (direct/codemode/deferred/hidden) | **Take idea** | Context-cost control | Sibling doc (codemode) |
| Skills (progressive disclosure, `SKILL.md`) | **Take** | Cheap, portable (Agent Skills spec); beam-lisp already has `mcp/skill.bl.md` | A task's scope may *pull* skills; skills are discoverable via the same registry as tasks |
| Prompt templates | **Take, tiny** | Pure string expansion; or a fn | Just functions |
| Settings (global+project merge, `+/-` deltas) | **Take** | Good merge semantics | One config value per task, derived by merge |
| Modes interactive/print/json/RPC/SDK over one session | **Adapt** | One task API, many front-ends | Front-ends = loom or TUI attached to the task registry; print = run a task and await |
| RPC JSONL w/ correlation ids; `prompt` ack ≠ done | **Adapt** | Ack/accepted vs done distinction is essential | Task submission returns a task id; `await` is a `proc` wait |
| `durable` tasks: own children, `waiting on`, `failFast/allSettled`, task graph | **Take concepts** | Matches the task idea | Supervision tree (`proc.super`) + wait-on-set; graph view is a query |
| `chord` facets/services/replicated state | **Drop** (BEAM supersedes) | Processes+messages+live state already give this | loom `live` state replication |
| `protocol/server/client` CBOR framing, attachments | **Drop initially** | Intra-node messaging is free; remote later | Revisit for remote TUI |
| `telemetry` explicit span context | **Adapt light** | Traces ARE the stigmergy log | Spans = trace facts |
| `evals` docs-lift A/B | **Take idea** | Measures whether docs/skills help | Run as tasks |
| No built-in permission system, containerize | **Take posture** (+ hooks) | Honest; BEAM can add per-task scope enforcement | Scope = enforceable capability set |
| Sub-agents/plan-mode/MCP as extensions | **Take posture** | Keeps the core small | Sub-agent = spawn a child task |
| TS-specific machinery (jiti, TypeBox, declaration merging, jiti loader, npm packages) | **Drop** | Language-specific | Native namespaces/bundles/schemas |
| 4.3k-line `AgentSession`, 60+ providers, OAuth zoo | **Drop** | Accretion; relay owns it | — |

## 8. Table: pi concept → file:line → omega / beam-lisp equivalent

| Pi concept | File:line (under `research/vendor/pi/packages/`) | Proposed omega / beam-lisp equivalent |
|---|---|---|
| Two-level run loop | `agent/src/agent-loop.ts:163-332` | task process loop; `(loop … recur)`, model in §3.5 |
| Steer / follow-up queues | `agent/src/agent.ts:299-342,134-155` | mailbox classes in the task proc (`proc.server` clauses; `proc.queue`) |
| Abort | `agent/src/agent.ts:341-342`; `agent-loop.ts:586-682` | exit/monitor; bottom-up via `proc.super` |
| Event stream | `agent/src/types.ts:514-529` | `proc.bus` fan-out (`priv/std/proc/bus.bl`) + trace facts |
| Tool + hooks | `agent/src/types.ts:66-135,464-497` | map `{:name :schema :execute}` + `:before`/`:after` fns |
| Parallel/sequential tools | `agent/src/agent-loop.ts:508-682` | `pmap`/`psettled`; `proc.fence` |
| File mutation queue | `coding-agent/src/core/tools/file-mutation-queue.ts:27-61` | per-path registered proc (`proc.reg`) |
| Messages/content blocks | `ai/src/types.ts:389-610` | plain maps (see `gen.llm` `chat`, `priv/lib/gen/llm.bl`) |
| Stream events | `ai/src/types.ts:767-787` | messages to subscriber / `proc.flow` |
| Provider/Model registry | `ai/src/models.ts:144-175,985-1034` | `ora/relay` + `gen.llm` provider map |
| Classifier (System One) | `ai/src/types.ts:316-332,633-690`; `ai/src/api/typesafe-system-one.ts` | Jev call in `knowledger/decision.bl`-style typed-decision fn |
| Patchable system sections | `ai/src/types.ts:522-538`; `coding-agent/src/core/system-prompt.ts:121-216` | `{:sections {name text|nil}}` patch entries |
| Session tree + entries | `coding-agent/docs/session-format.md`; `src/core/session-manager.ts:476-600` | datom/tree of entries; `harness.doc` `.bl.md` projection |
| Compaction | `coding-agent/docs/compaction.md`; `src/core/compaction/` | summary entry + `:first-kept` (model in §5.4) |
| Extension API | `coding-agent/src/core/extensions/types.ts:1540-1872` | bundle registering into env registry |
| Tool exposure | `coding-agent/src/core/extensions/types.ts:509` | sibling codemode doc |
| Skills | `coding-agent/src/core/skills.ts:355-383`; `docs/skills.md` | `mcp/skill.bl.md` pattern; registry |
| Prompt templates | `coding-agent/docs/prompt-templates.md` | plain fns |
| Modes | `coding-agent/src/modes/{print-mode.ts,rpc/*,interactive/*}` | loom (`priv/lib/loom/desktop.bl`) / TUI / `bl run` |
| RPC protocol | `coding-agent/docs/rpc.md:1-60`; `rpc-commands.md` | task registry API; MCP (`priv/lib/mcp/server.bl`) as external surface |
| Durable tasks & task graph | `durable/README.md:78-99,444-486` | `proc.super` + wait-on; trace-graph query |
| TUI | `tui/README.md` | ratatui wrapper mirroring loom |
| Telemetry | `telemetry/README.md` | trace facts |
| Evals | `evals/README.md` | tasks measuring skill/doc lift |

## 9. beam-lisp mapping and gaps

[OBS] Already present in `/home/user/code/undefine/beam-lisp--repl/priv`:

- **A harness prototype** — `lib/harness.bl`: "a beam-lisp session a model (or you) drives: eval, turns, steers" (`start-turn`, `steer-turn`, `await-turn`, `status`, `stop!`); *session = an append-only `.bl.md` document* at `.local/harness/<session>.bl.md` (`harness/doc.bl`); one `keeper` process is the only writer and owns each session's turn (spawn+monitor worker); turn workers are members of the project VM (`vm.owner`). `harness/model.bl` makes one model step: document in, `.bl.md` reply out, via `gen.llm`. So **steer ≈ already exists**; omega's loop should build on it rather than parallel it.
- **LLM seam** — `lib/gen/llm.bl`: `chat` (messages in, text out), provider = map, OpenAI-compatible, pure bl over inets/ssl/json. Gaps vs `pi-ai`: no streaming events, no tool-call content blocks, no usage/cost, no thinking levels, no classifier. [INF] `ora/relay` (outside this file's scope) is the likely upgrade path.
- **Process pattern language** — `std/proc.bl` one-require door; bundles `proc.server` (`defserver` + open clauses), `tick`, `sched` (deadline queue), `queue` (durable), `bus` (backpressured fan-out on `flow`), `flow` (demand-driven streams), `reg` (find a process by what it is), `table`, `fence` (bounded isolation), `super` (supervision trees as data), `pipeline`. These cover mailbox classes, abort trees, wait-on-set, the event bus, and the registry; none is a "task" abstraction yet.
- **Front-ends** — `lib/loom/*` + `lib/wry.bl` (`desktop/app` = pure `view: state→hiccup`, pure `on-event` reducer; wry window), `lib/live.bl` (web converge); `lib/mcp/*` (MCP server surface over code facts).
- **Static checks that fit tool hooks** — `std/effects.bl` (effect lattice pure < atom < spawn/send < io), `std/typed.bl`, `std/deferred.bl`: usable to *classify a tool's effect level before running it* (pi has only `readOnlyHint` annotations).
- **Docs/livebooks** as executable spec (`.bl.md`, `bl.doc`).

Gaps: streaming provider events; tool-call content blocks and schema validation (no TypeBox analogue seen [INF: `typed.bl` is a checker, not a runtime JSON-schema validator — unverified]); token/cost accounting; compaction; tree-structured sessions with fork/branch (harness doc is linear); skill/template/settings discovery & merge; the task abstraction itself (scope, discoverability, stigmergic traces); a Jev client in the harness (exists in `knowledger/decision.bl`, not in the stdlib).

## 10. Interactions & observability

For a human and for an agent developing omega:

- **Event tap**: pi's cheapest observability is one subscriber on the event stream; `--mode json` prints it as JSONL. [PROP] omega: every task emits the same events to `proc.bus`; `bl` can tail them; the trace store is queryable (datom).
- **Replay tests**: pi's `faux` provider + `test/suite/harness.ts` (AGENTS.md: "no real provider APIs, keys, or paid tokens") run whole loops deterministically. [PROP] a `faux` model fn `(fn [ctx] msg)` — exactly the stub in §3.5 — makes every loop test a `.bl.md` runnable block; this doc's blocks are that pattern.
- **Inspect state**: pi RPC `get_state/get_messages/get_tree/get_entries/get_session_stats`; durable's `taskGraph()`. [PROP] `(tasks)` query returns the live task graph (owner, status, waiting-on); `(trace task-id)` the entries; `/tree` view in loom.
- **Drive**: pi RPC `prompt/steer/follow_up/abort`. [PROP] same four verbs on a task id, available from REPL, loom, TUI, other tasks.
- **Evaluate in the live VM**: `harness.bl` already lets the model/human `evaluate` cells in the project VM; extensions are hot-loaded code, so "inspect an extension" is `(doc …)`/`find` on its ns.
- **Evals**: docs-lift A/B (with/without docs) is the right way to know whether omega's skills help; run as tasks.

## 11. Open questions for discussion

1. **What is a task's transcript?** Options: (a) pi-style entry tree per task (branch/fork/compact), (b) flat append-only doc (`harness.doc` today), (c) facts in a datom store with the tree as a derived view. Tradeoff: (a) proven and gives `/tree`, (b) simplest and human-readable `.bl.md`, (c) makes cross-task queries/stigmergy free but adds a store dependency to the core.
2. **Source of truth: `.bl.md` document vs structured store?** The existing harness makes the livebook the state. Pi shows structured entries (`custom` vs `custom_message`, `context_edit`, `usage`) that a markdown doc models awkwardly. Option: store structured, render `.bl.md` as a projection — or keep doc and embed typed blocks. Decide before building compaction.
3. **Steer/follow-up semantics for peers.** Should a peer task's message be *steer* (interrupt at next turn boundary) or *follow-up* (when idle), and who decides — the sender, the receiver's scope, or a Jev decision? Options: sender-declared (pi-like), receiver policy table, typed decision per message (cost: latency/tokens on every message).
4. **Parent/child task ownership.** Take `durable`'s owner edges + bottom-up abort (clean, structured concurrency), or allow free-floating tasks coordinating only via traces (more stigmergic, harder to cancel/GC)? Likely both: ownership for sub-work, traces for peers — but what garbage-collects traces?
5. **How much of pi's hook surface to copy?** ~35 events is a lot. Minimum viable: `before-tool`, `after-tool`, `context`, `before-turn`, `turn-end` (actionable), plus the event bus. Everything else derivable from the bus. Risk of too few: extensions monkey-patch; too many: accretion like `agent-session.ts` (4.3k lines).
6. **Provider layer ownership.** Build streaming + tool-call blocks + usage into `gen.llm`, or put it in `ora/relay` and keep omega's seam to one `stream` fn? Streaming events as messages vs `proc.flow` demand-driven streams (backpressure) is a real choice for UI latency.
7. **Where does the system prompt live per task?** Pi's named sections + deltas are cache-friendly. Should a task's *scope* be a section (so it appears in the prompt) *and* a machine-readable value (so others can find it)? Options: scope map `{:goal :paths :tools :children}` rendered into a section vs free text.
8. **Permissions.** Pi has none (containerize). With scoped tasks omega can enforce capabilities (paths, tools, effect level via `std/effects.bl`). Take pi's honesty plus opt-in enforcement, or ship enforcement in core? Tradeoff: safety vs "simplest possible" core.
9. **Tool exposure / context cost.** Adopt `direct/deferred/codemode/hidden` exposure now, or start with a fixed 4-tool set (read/write/edit/bash) like pi's default and add exposure when the sibling codemode design lands?
10. **Compaction authority.** Per task automatic (pi), or a separate *compactor task* triggered by trace pressure? The latter is stigmergic but adds a coordination dependency to the base loop.
11. **Which front-end API shape?** Pi's RPC (command + response id + event stream) is a good template for the loom ↔ TUI parity requirement: define it once as task-registry operations and make both front-ends clients, versus each front-end calling the process API directly.
12. **Skills vs bundles.** Pi skills are prose (+scripts) loaded by `read`; omega bundles are code. Keep both (skill = prompt-level knowledge, bundle = capability) or unify as "a skill is a bundle with a `SKILL.md` doc block"?
