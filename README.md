# omega

The simplest coding harness that works, built from beam-lisp primitives. pi's
architecture (a small loop plus extensions), with one deviation: **prompts are
tasks, not chats**. Tasks coordinate stigmergically. They leave traces in a shared
fact log, sense each other's traces, message one another (the human included), and
wait on each other.

## Try it

```sh
bin/bl run omega.bl.md                      # playground: 3 tasks + a human, offline
bin/bl run docs/domain-model.bl.md          # the datom model, runnable, with invariants
bin/bl test                                 # the suite (offline; 7 files)

cd /some/project
~/code/undefine/omega/bin/omega --offline "look around"     # no network
~/code/undefine/omega/bin/omega "add a test for X and run it" # live: Sonnet 5.5
~/code/undefine/omega/bin/omega --jev --notify "…"          # + Jev done-gate, desktop notifications
```

PELAGIC opens as a package in an Omega editor session:

```sh
bl pelagic.dev                   # server + frontend; open the printed URL
bl pelagic.dev -- --port 8820       # another development host
bl pelagic.local                 # standalone demo server
bl pelagic.bundle                # portable demo ZIP
```

Unchanged launches reuse compiled output. See the [PELAGIC launch guide](spikes/pelagic/session-launch.bl.md).

Flags: `--offline`, `--jev`, `--notify`, `--cassette PATH` (record/replay the model),
`--db DIR` (where to keep tasks), `--memory` (keep nothing).

**Where tasks are kept.** Every task, its conversation (each turn), messages,
traces and results are datoms in ONE store per project: `<project>/.omega/db`
(fjall, on disk). Close the window or kill omega and nothing is lost: the next
`omega-ui` in that project shows every task again. A task that was mid-turn
comes back as *idle* ("interrupted…", under Needs you); send it a message to
continue. A store is one process's at a time, so a second omega in the same
project says so and exits (use `--db DIR` or `--memory`). `--offline` and
`--demo` runs are in memory unless `--db` is given. An omega started from
inside a task (omega testing itself) is in memory too. Add `.omega/` to the
project's `.gitignore`.

The UI is a beam-lisp `live.app` (server-rendered, keyed patches over a socket,
streaming tokens), shown in a native wry window or any browser:

```sh
cd /some/project && ~/code/undefine/omega/bin/omega-ui        # live: type a goal, Enter = a task
~/code/undefine/omega/bin/omega-ui --demo                      # offline scripted world
~/code/undefine/omega/bin/omega-ui --no-window                 # serve only → http://127.0.0.1:4747
~/code/undefine/omega/bin/omega-headless                       # the real UI, off-screen: scenarios + screenshots
```

omega inside bl-ed: the task world and the editor in one VM. Tasks are `#+begin_task` blocks in
your `.bl.org` files, and every view is a document.

```sh
cd /some/project && ~/code/undefine/omega/bin/bl-ed --offline  # open the printed URL
# C-Enter on a #+begin_task block  open/refine a task; its #+RESULTS row is drawn as a live card
# y / n / a on a card              answer its question · t its livebook · e what it did · s say
# space a o / s / n / q / i        overview · scratch · new task · query · the live image (bl:)
# C-o                              back
```

## Requirements

- **beam-lisp, pinned** in `env.bl` (`:bl "commit:…"`) and run by the `bl`
  launcher at `~/.local/bin/bl`, which builds that commit once in a clean tree
  and keeps it. omega is unaffected by uncommitted work in the beam-lisp
  checkout. `bin/bl` adds `src/` to the search path and always starts the VM in
  omega's root. Run the live checkout instead with
  `OMEGA_BL=~/code/undefine/beam-lisp/bin/bl`. To move the pin, see `env.bl`.
- **Live model:** an Anthropic Messages endpoint. The default is the local
  better-ccflare proxy at `http://localhost:8080`. It only routes requests whose
  first system block is the Claude Code identity line, which `omega.llm` sends.
  Override with `OMEGA_BASE_URL` / `OMEGA_MODEL` in `.env`. Set
  `OMEGA_BASE_URL=https://api.anthropic.com` plus `ANTHROPIC_API_KEY` for the
  direct API.
- **Output limit:** `OMEGA_MAX_TOKENS` (in `.env` or the environment) sets the maximum tokens of
  one model reply. Unset keeps the default of 8000, a deliberate small default (cost, latency): raise it
  per project when you ask for large single replies (`OMEGA_MAX_TOKENS=32000`). It must be a whole number
  from 1 to 128000; anything else (`0`, `-1`, `8k`, `1e5`, too large) stops startup with an error that names
  the variable and the rule but never echoes the value. When a reply is cut off by the limit while it was
  writing a tool call, omega runs nothing, answers the call with a "NOT RUN … retry with smaller chunks"
  error, and the model carries on. `eval` with a missing, non-string or blank `code` likewise returns an
  actionable error instead of running anything.
- **Interrupted tool calls:** an assistant tool call is persisted before the tool runs, so a kill
  (SIGTERM, crash) in between leaves a call with no result. `task/recover!` answers each genuinely
  unanswered call with an explicit error result ("INTERRUPTED … NOT re-run … effect UNKNOWN: inspect
  before retrying"); completed results and healthy histories are untouched, and no tool is ever replayed.
  The request builder (`omega.loop/messages`) applies the same pure repair, so no provider sees an orphan.
- **Transient 5xx:** `omega.llm` retries rate-limit, 5xx (500/502/503/504/529) and transport errors 3 times
  with 1 s, 2 s, 4 s backoff. A 503 that outlasts those retries fails the turn and the task ends as
  `failed` (terminal: open a new task to try again). This is by design, not changed.
- **Jev:** `TYPESAFE_API_KEY` in omega's `.env`. Credentials are always read from
  omega's home, never from the project being worked on.

## Layout

| path | what |
|---|---|
| `src/omega/schema.bl` | the datom schema: actor, task, msg, trace, turn |
| `src/omega/env.bl` | one fact store per env (in memory, or durable per project: `.omega/db`); ids resume on reopen; `sense` = datom watch |
| `src/omega/actor.bl` | uniform actors (tasks and humans); mailboxes are facts |
| `src/omega/trace.bl` | open trace vocabulary and glossary; decay; reinforcing reads; claim policy |
| `src/omega/task.bl` | **the interface**: `open! say! steer! cancel! await view children tree`; `recover!` after a restart |
| `src/omega/loop.bl` | one turn (`turn!`): model → tools → … → answer; the `step` seam; scripted models |
| `src/omega/codemode.bl` | **the only tool: `eval`** (beam-lisp, harness cell evaluator, heap cap + deadline; a killed cell reaps its processes) |
| `src/omega/reap.bl` | OS processes tagged per task and cell (env tags), killed when the cell is killed or the task ends |
| `src/omega/prelude.bl` | what eval code calls: read write edit ls glob sh · spawn wait send done · trace traces q (`wait` returns `:pending` before the cell deadline) |
| `src/omega/llm.bl` | Anthropic over OTP httpc; retries; cassettes. `llm/usage.bl` vendored from relay |
| `src/omega/jev.bl` | Jev typed decisions: questions as values, declared decisions with fail direction |
| `src/omega/ext.bl` | extensions as values: events, hooks (call-predicate, context, tool/after), tools |
| `src/omega/ext/notify.bl.md` | desktop notifications; click a button to answer a task's question |
| `src/omega/ext/jev_gate.bl.md` | Jev done-gate and scope check, with live evidence |
| `src/omega/cli.bl`, `bin/omega` | one task from the shell |
| `src/omega/ui/model.bl` | the env projected for screens: task rows grouped by urgency, asks, details |
| `src/omega/ui/theme.bl` | design system as data: dark/light (WCAG AA tested), status = glyph + word + tone |
| `src/omega/ui/screens.bl.md` | overview + task screens as pure `state → hiccup`, with the design reasoning |
| `src/omega/ui/web.bl`, `bin/omega-ui` | the UI as a `live.app`: env + ephemeral stream conn observed, intents = task verbs |
| `src/omega/stream.bl`, `src/omega/llm/sse.bl` | streaming: SSE parsed and folded purely; deltas and activity (the call or `sh` running now) broadcast over `pg`, never facts |
| `src/omega/ui/probe.bl`, `bin/omega-headless`, `test/headless/ui.bl` | the real window in a private headless sway: drive, query, wait-for, screenshot |
| `src/omega/ed/`, `bin/bl-ed` | omega in bl-ed: pure org renderers (`render.bl`), the providers and intents (`providers.bl`), the one-VM launcher (`main.bl`) |
| `vendor/bl-ed/` | bl-ed, vendored from beam-lisp (`VENDOR.md` lists every delta): documents that are not files, presentations, `ed/omega.bl` |
| `research/domain/` | the research basis (15 literate notes) and the decision register |
| `!tasks/plans/PLAN-001-…` | the decisions this version implements |

## Known beam-lisp gotchas (observed on main, 2026-10-01)

- Call arguments evaluate **right-to-left**: never sequence effects by argument position.
- `:true` / `:false` read as booleans. Use string keys.
- Not in core: `ffirst`, `take-last`, `false?`, `read-string` (data), `requiring-resolve`, `#'ns/private-var`.
- **Never name a public fn after a core fn** (`run!`, `count`, …): a qualified call runs CORE on the first, cold call (filed upstream as beam-lisp BUG-109). omega's `run!` became `turn!`.
- `json/encode` refuses vectors (tuples), so use `omega.llm/jsonable`.
- `(range a b step)` and `vector` are missing; `erlang/whereis` returns `:undefined`; `re-find`/`re-seq`
  resolve only in some load contexts (use `Regex/run`/`Regex/scan`). A top-level `swap!` into a registry
  may not have run when another ns calls in (demand loading): keep registries as fns returning literals.
- live.diff honours `:key` only when every sibling is keyed (BUG-110): key whole lists, empty groups included.
- wry: one window per VM, and GTK binds `WAYLAND_DISPLAY` at the first window.
- Datom: a transaction map needs `:db/id`; a lookup-ref is not accepted as a ref value
  (resolve it first); negation is `[:not …]` / `missing?`.
