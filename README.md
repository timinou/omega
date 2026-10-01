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

Flags: `--offline`, `--jev`, `--notify`, `--cassette PATH` (record/replay the model),
`--db DIR` (keep the fact log on disk).

## Requirements

- **beam-lisp main** at `~/code/undefine/beam-lisp` (override with `OMEGA_BL=/path/to/bin/bl`).
  `bin/bl` wraps it and puts `src/` on the search path. Always the latest (decision D12).
- **Live model:** an Anthropic Messages endpoint. The default is the local
  better-ccflare proxy at `http://localhost:8080`. It only routes requests whose
  first system block is the Claude Code identity line, which `omega.llm` sends.
  Override with `OMEGA_BASE_URL` / `OMEGA_MODEL` in `.env`. Set
  `OMEGA_BASE_URL=https://api.anthropic.com` plus `ANTHROPIC_API_KEY` for the
  direct API.
- **Jev:** `TYPESAFE_API_KEY` in omega's `.env`. Credentials are always read from
  omega's home, never from the project being worked on.

## Layout

| path | what |
|---|---|
| `src/omega/schema.bl` | the datom schema: actor, task, msg, trace, turn |
| `src/omega/env.bl` | one fact store per env; injectable clock and ids; `sense` = datom watch |
| `src/omega/actor.bl` | uniform actors (tasks and humans); mailboxes are facts |
| `src/omega/trace.bl` | open trace vocabulary and glossary; decay; reinforcing reads; claim policy |
| `src/omega/task.bl` | **the interface**: `open! say! steer! cancel! await view children tree` |
| `src/omega/loop.bl` | one turn: model → tools → … → answer; the `step` seam; scripted models |
| `src/omega/tools.bl` | read, write, edit (edits[]), bash, eval (harness), spawn, send, wait, trace, done |
| `src/omega/llm.bl` | Anthropic over OTP httpc; retries; cassettes. `llm/usage.bl` vendored from relay |
| `src/omega/jev.bl` | Jev typed decisions: questions as values, declared decisions with fail direction |
| `src/omega/ext.bl` | extensions as values: events, hooks (call-predicate, context, tool/after), tools |
| `src/omega/ext/notify.bl.md` | desktop notifications; click a button to answer a task's question |
| `src/omega/ext/jev_gate.bl.md` | Jev done-gate and scope check, with live evidence |
| `src/omega/cli.bl`, `bin/omega` | one task from the shell |
| `research/domain/` | the research basis (15 literate notes) and the decision register |
| `!tasks/plans/PLAN-001-…` | the decisions this version implements |

## Known beam-lisp gotchas (observed on main, 2026-10-01)

- Call arguments evaluate **right-to-left**: never sequence effects by argument position.
- `:true` / `:false` read as booleans. Use string keys.
- Not in core: `ffirst`, `take-last`, `false?`, `read-string` (data), `requiring-resolve`.
- `json/encode` refuses vectors (tuples), so use `omega.llm/jsonable`.
- Datom: a transaction map needs `:db/id`; a lookup-ref is not accepted as a ref value
  (resolve it first); negation is `[:not …]` / `missing?`.
