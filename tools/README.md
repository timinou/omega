# tools/ — namespaces an omega task loads into the live VM

An omega task's `eval` runs **inside the Omega BEAM VM** (`omega.w.<world>.<task>`).
That is the main reason Beam-Lisp beats bash for harness work. Bash sees text from outside the process.
An eval sees the running system as data: processes, ETS, datoms, namespaces. Its results are
maps you can sort, group and join, and `defn`s persist across calls.

| bash | beam-lisp eval |
|---|---|
| `ps`/`grep` over text | `(erlang/processes)` → maps, `group-by`, `sort-by` |
| every stage re-parses strings | values stay structured end-to-end |
| one process per pipe stage | one program, one round trip |
| state = temp files | state = `def`s in the task namespace, or a named ns |
| `&` + exit codes | `spawn`/`wait` return results |
| `sed -i` partial edits | `edit` exact, all-or-nothing |
| still best for: one-liners, git, nix | call it via `(sh ...)` → `{:out :exit}` |

## Loading a tool namespace

There is no `load-file`/`require`/`eval` in a task ns. Use the harness that runs evals:

```clojure
(defn load-tool [f ns] (dissoc (harness/eval-cell {:ns ns :root (File/cwd!) :path f} (read f) 60000) :stdout))
(load-tool "tools/introspect.bl" "introspect")
(introspect/report)
```

The namespace stays loaded in the VM after your task ends, so other tasks can call `introspect/...` directly.
Reload it after editing the file.

## Interop gotchas (beam-lisp v2026.9)

- An Erlang list argument needs `(list :a :b)`. A vector `[:a :b]` gives "invalid item list".
- Tuples: `(nth t 1)`. Charlists, e.g. `(os/getpid)`: `(List/to_string x)`. Ints: `String/to_integer`.
- `erlang/process_info` returns `()` (not nil) for a dead pid, so guard with `seq?`.
- `sys/get_state` on a large-state process can hang the cell until the 120 s kill. Avoid it on hot servers.

## Files

- `introspect.bl`: memory and process introspection: `vm`, `top`, `by-kind`, `queues`, `ets-top`,
  `tasks`, `garbage` (GC a process class and measure what was reclaimable), `report`.
- `nav.bl`, `lens.bl`: regex indexers over source and schema (offline; do not need the VM).

## Finding: Omega VM memory (2026, uptime 1d10h)

`erlang/memory` total was 7.17 GB (6.8 GB in processes); RSS was 3.9 GB. Grouped `by-kind`:

| kind | n | MB | after GC |
|---|---|---|---|
| `Supervisor.Default` | 110 | 4631 | **0.3** (all dead heap) |
| `ThousandIsland.Acceptor` | 100 | 917 | ~1096 (live) |
| `ThousandIsland.AcceptorSupervisor` | 100 | 790 | 790 (live) |

After one GC pass the total was 2.38 GB and RSS 1.84 GB. Causes:
1. Idle supervisors never trigger GC, so heap built at start-up stays (`fullsweep_after` 65535).
2. Bandit/ThousandIsland default to **100 acceptors** per listener. Each acceptor and each acceptor
   supervisor holds its own ~8–11 MB copy of the server config. The size suggests the plug closure
   from `web/serve` (beam-lisp `priv/lib/web.bl`) captures a large environment. Fixes: pass
   `:thousand_island_options [num_acceptors: 4..10]`, keep the plug closure small (capture
   names, not values), or hibernate idle supervisors. Recheck with `(introspect/by-kind)`.
