# How it fits: bl-ed + omega after the spikes

*2026-10-04. One page to read on top of the separate notes. It has three parts:*
- *§1–3: how the 17 spikes integrate into one architecture, one user experience and one developer
  experience;*
- *§4: the beam-lisp syntax proposed for the sandbox;*
- *§5: every open question, with the lean that stands unless you answer.*

*`clojure` fences are design sketches (not run); `text` fences are illustrations. Sources:*
- *`../interface/bl-ed.bl.md` (the design, §15 for spike results);*
- *`../interface/checkpoints-and-the-live-image.bl.md`;*
- *`../tools/beam-in-charge.bl.md`;*
- *`spikes/README.md`.*

---

## 0. The vision, restated in one paragraph

**A Lisp machine for working with agents.** One world holds code, data and work as live objects:
- the documents are the specs;
- a task is a cell whose result is a live reference;
- agents are second cursors in the human's buffers;
- every effect, whether a keystroke, an agent edit or a python script's file write, is a fact
  with an author;
- history is native and per step.

The machine is in charge. The BEAM supervises, records, gates and asks; the OS processes and the
models do the work under it. Consoles (bl-ed, CLI, web) show views of the world; they hold no
authority.

The spikes did not change this vision. They changed *where the walls go*.

---

## 1. Architecture: one harness VM, supervised worker VMs, consoles

```text
                    ┌──────────────────────── HARNESS VM (the world; never jailed, on the pinned bl) ───────────────────────┐
 consoles           │                                                                                                      │
 ┌──────────┐ views │  omega.task      task = defserver; loop threads turns as a value (C8)      ── facts ──▶  datom store │
 │ bl-ed    │◀──────┤  omega.loop      append-only, byte-stable requests + :tail (prompt cache)                   (one schema │
 │ CLI      │ ops·  │  omega.edit      RULES table (occurrences, empty-old, atomic, claims, preview)              incl. ed,   │
 │ web/MCP  │ attend│  buffer servers  one per open file: published layer + per-human overlay, convergent ops     effects,   │
 └──────────┘ ─────▶│  claims          advisory; conflicts reported to the model (C9)                             history)   │
                    │  historian       one process; :tool/after snapshot (~4 ms) + async commit (~55 ms)                     │
                    │  omega.jail      per task: policy table → floor + mediation; effect facts; :ask to consoles            │
                    │  file port (C6)  every read/write/edit goes through the buffer servers, never the disk directly         │
                    └──────▲──────────────────────────────▲───────────────────────────────────▲────────────────────────────────┘
                           │ erpc (prelude = thin stubs)   │ port lines (effects, verdicts)   │ dist: eval · reload · ward
            ┌──────────────┴──────────┐     ┌──────────────┴───────────┐        ┌──────────────┴──────────────────────┐
            │ EVAL NODE (per world)    │     │ sh CELL (per call)        │        │ TARGET VM (per beam-lisp project)  │
            │ jailed: Landlock floor   │     │ notify → sh -c "python …" │        │ the project's app, its defservers, │
            │ runs the model's cells   │     │ Landlock + seccomp-notify │        │ its datom conn; reload per var;    │
            │ holds no authority       │     │ every write/exec/connect  │        │ ward gate; may also be jailed      │
            └──────────────────────────┘     │ is a message first        │        └─────────────────────────────────────┘
                                             └───────────────────────────┘
       builds: realm — one VM per (tree, build); beam-lisp itself = generations, the harness stays on the pin
```

**Three rules hold it together.** Each one came out of a spike.

1. **Authority lives in one place: the harness.**
   - Buffer servers, claims, the historian, the policy and the store are all there.
   - Everything else (eval nodes, `sh` cells, target VMs) is a supervised worker that asks or
     reports.
   - This is the CADR's machine/console split carried one level down: worker VMs are to the
     harness what consoles are to the world.
   - Spikes: `file-port` (C6 makes every file op a call to the buffer servers),
     `step-checkpoint` and `async-checkpoint` (a single historian), and `beam-jail` (a whole
     node can be jailed while the harness is not).
2. **Every effect is a fact with an author, in one shape.**
   - The `:source` of an effect says how it was caught:

     | source | how it was caught |
     |---|---|
     | `:edit` | the edit/write tools |
     | `:syscall` | the jail's notify |
     | `:trace` | BEAM file calls in a cell |
     | `:scan` | `:pass` dirs (build output) |
     | `:eval` | image changes from a cell |
     | `:external` | a human or daemon, with no cell running |

   - History, effect references ("this cell is not re-runnable"), the agent's tool results and
     the human's cards all read the same facts.
   - Spikes: `fs-capture`, `beam-jail`, `live-image`.
3. **Walls are kernel or VM boundaries; never conventions.**
   - Landlock is the write floor, because notify alone let 724–747 of 3,000 races through.
   - A separate VM holds the project's image, because forks leaked and a shared registry has no
     per-task view.
   - The pin protects the harness from the beam-lisp it edits.
   - Advisory mechanisms (claims, attention, intents) live *inside* those walls and are reported,
     never trusted for safety.

### 1.1 What each spike contributed

| spike | finding | lands in |
|---|---|---|
| `hot-task`, `turn-read-cost`, `c8-turn-cache` | long tasks slowed themselves (1.2 → 2.7 s/step); fix = thread turns as a value | **built**: C8 in `omega.loop` (65.7 → 16.7 s on 120 steps) |
| `prompt-cache` | requests are already byte-stable; volatile lines go in `:tail`; 15–23% of input cost | FEAT-012 (W0) |
| `c9-claim-conflict`, `claims-advisory` | claims are advisory; tell the second writer | **built**: C9, `omega.edit/RULES :claims` |
| `file-port` | C6 is 29 lines; eval cells see the port | **built**: C6 |
| `convergence` | §5.3's rebase diverged on 63% of pairs; atomic ops + split + tiebreak → 0/6000 | FEAT-004 (W1) |
| `buffer-overlay` | the human's unpublished text stays off disk; agents see the published layer | FEAT-004 (W1) |
| `task-cell` | `:task` works as a package with its own span kind | FEAT-006 (W1c) |
| `history` | native history, ~55 ms per checkpoint, no jj | FEAT-005 (W1b) |
| `step-checkpoint`, `async-checkpoint` | a `:tool/after` hook; snapshot inline, commit async | FEAT-005 |
| `task-refs` | per-task refs do not fix gate blame; a per-path gate does | FEAT-005 (E23) |
| `fs-capture` | BEAM-side writes traced exactly; `sh` needs more | FEAT-005, then superseded for `sh` by the jail |
| `live-image` | var hashes give an exact `:image` diff; state cannot be restored | FEAT-005 + FUP-009 |
| `beam-jail` | the whole `sh` tree's effects arrive as messages before they happen; Landlock enforces | **new work** (§4, Q block SB) |

---

## 2. UX: one task, end to end, as the human sees it

The setting: a human in bl-ed has `plan.org` open, writes a plan in prose and drops a task cell
under it.

```org
* TODO Hex literals in the reader
Python's int() needs base 16 for 0x; keep the decimal path untouched.
#+begin_task :id hex :scope reader.py test/test_reader.py :profile careful
Make read_number accept 0x hex literals. Keep decimals working.
#+end_task
```

| moment | what the human sees | what happens underneath | from |
|---|---|---|---|
| `C-Enter` on the cell | a **card** appears in place of `#+RESULTS`; its height is its urgency | `task/open!` with the heading body as the spec (`:context heading`); profile `careful` picks model, jail and reload policy | §3, `task-cell` |
| the agent starts | a coloured **second cursor** in `reader.py`, if the human has it open | the agent's `edit` goes through the file port to the buffer server; ops are convergent; the human's unsaved text stays in their overlay | C6, `buffer-overlay`, `convergence` |
| the agent runs `(sh "pytest -q")` | the card ticks: *"ran pytest · wrote .pytest_cache (pass) · 0 denied"* | the `sh` cell runs under `notify`; effects arrive as facts; the build cache is in-BPF `:pass` | `beam-jail` |
| the agent's script tries `pip install` | an **ask** on the card: *"t-hex wants to connect to pypi.org:443 (pip). Allow once · for this task · deny"*; the process is paused in the kernel | `:connect :inet :ask`; 60 s timeout → deny; the answer can become a rule | `beam-jail`, §4.4 |
| the human edits the same function | the agent's next tool result says *"you also hold reader.py with the human (pending, unpublished)"*; its edit on overlay-only text is refused (`:overlay`) | claims + the RULES table; attention lines go into the request `:tail`, so the cache prefix survives | C9, `buffer-overlay`, `prompt-cache` |
| each step ends | the sidebar's step list grows: *"step 7 · reader.py +12 −3 · gate ✓ (test_reader)"* | `:tool/after` snapshot → historian → one change; per-path gate | `history`, `async-checkpoint` |
| a step breaks something | the step is red but recorded; *"revert step 9"* is a button | E18: checkpoint even when the gate fails; revert = a new change | `history` |
| (beam-lisp project) a step changes `shop.price` | *"changed `total`, added `extra` · reloaded · shop.cart kept its state"* | the `:image` part; reload per var in the target VM; a ward gate | `live-image`, checkpoint doc |
| the task ends | the TODO turns DONE; the card collapses to a reference you can reopen; the cell is not re-runnable (it changed files) and offers *copy as new* | TODO sync; effect references | §3.6, §7 |

**The UX principles the spikes earned:**
- **The human is told, not protected by silence.** Every report is honest:
  - denied effects;
  - claim conflicts;
  - stale state after a restore;
  - drift between the image and the files.
- **Asks are rare and specific.** The kernel pauses exactly one syscall. The human answers a
  concrete question ("pypi.org:443"), never "allow bash?".
- **Nothing the human typed is published by an agent.** The overlay keeps unpublished text off
  disk, and `sh` cells see only the published layer, so a script cannot read half-typed code.

---

## 3. DX: what a developer (or an agent writing omega packages) touches

| need | where it lives | shape |
|---|---|---|
| change how edits behave | `omega.edit/RULES`, `:edit-rules` | a map of named rules |
| change what processes may do | `omega.jail/JAIL`, `:jail` (§4) | a map: `:floor` + `:mediate` rows |
| per-project config | `env.bl` `:omega {…}` (C3, FEAT-002) | data |
| per-task overrides | the task cell's `:profile` | a profile name → a map in config |
| react to steps | ext hooks `:tool/before` `:tool/after` `:context`, event `:step/end` (C5) | fns |
| query what happened | `(q …)` over the store: `:effect/*`, `:change/*`, `:task/*` | datalog |
| test offline | `:step` is a function; cassettes; scripted models | as today |

**One idea in every row: policy is data, mechanism is code.** The edit rules, the jail, the
reload policy and the cache contract are all tables someone can tweak after real use. That is the
request you made for the edit logic, applied everywhere.

---

## 4. The beam-lisp side of the sandbox: syntax

Three layers, from the substrate up. Each is usable without the one above it.

### 4.1 The substrate primitive: `jail` (in beam-lisp std if SB-Q5 says so; omega first)

```clojure
(ns my.tool (:require [jail]))

;; one-shot: run a command under a floor, collect its effects
(jail/run ["sh" "-c" "python gen.py && sed -i s/a/b/ cfg.toml"]
  {:cwd   root
   :floor {:write [root :tmp "/dev"]          ; Landlock — kernel-enforced, fixed at exec
           :read-deny ["~/.ssh" "~/.aws" "~/.config/gh"]
           :net   :none}                      ; :none (empty netns) | :proxy | :host
   :watch #{:write :unlink :rename :mkdir :exec :connect}   ; which syscalls become events
   :pass  ["_build" "target" "node_modules"]  ; allowed inside BPF: no event, no cost
   :decide (fn [ev] (if (= :connect (:op ev)) [:deny "network is off"] [:allow]))})
;; ⇒ {:exit 0
;;    :out "…"
;;    :effects [{:op :exec   :path "/usr/bin/python3" :pid 4123}
;;              {:op :write  :path "/p/data/a.json"   :pid 4123 :verdict :allow}
;;              {:op :rename :path "/p/sedX1" :to "/p/cfg.toml" :pid 4130 :verdict :allow}]}
```

- `:decide` runs in the caller's process and returns `[:allow]`, `[:deny why]`, or `[:ask why]`.
- **`:ask` makes the call asynchronous.** The ev is handed to whoever the caller names, and the
  syscall stays paused until they answer.

```clojure
;; streaming: a supervised process you receive effects from
(def j (jail/spawn ["sh" "-c" cmd] {:floor … :watch …}))   ; ⇒ a jail handle (a pid)
(receive
  [:jail/effect j ev] (jail/answer j ev (policy ev))          ; :allow | [:deny why]
  [:jail/exit j code out] …)

;; a whole jailed BEAM node, for eval cells
(def n (jail/node {:name "omega-eval-w3" :floor {:write [root :tmp]} :net :proxy}))
(erpc/call n 'clojure.core/+ [1 2])                           ; ⇒ 3, computed under the floor
(jail/stop n)
```

`jail/spawn` returns a process, so it links, monitors and can sit under a supervisor like any
other. A jail is an OTP citizen, not a shell wrapper.

### 4.2 omega's policy: one table, like `omega.edit/RULES`

```clojure
(ns omega.jail)

(def JAIL
  "What a task's OS processes and eval cells may do. Every key is a tunable rule.
   :floor is enforced by the kernel; :mediate rows are decided in BEAM, first match wins."
  {:floor   {:write     [:project :task-tmp "/dev"]
             :read-deny [:secrets]                       ; ~/.ssh ~/.aws .env* outside the project …
             :net       :proxy
             :limits    {:mem "4G" :tasks 512 :runtime-s 600}}   ; cgroup, rendered like relay's profile
   :mediate [[:exec    :any        :record]
             [:write   :build-dirs :pass]                ; compiled into BPF: free
             [:write   :project    :record]
             [:unlink  :project    :record]
             [:connect :unix       :allow]
             [:connect [:host "pypi.org" "files.pythonhosted.org"] :allow]
             [:connect :inet       :ask]]
   :ask     {:timeout-ms 60000 :on-timeout :deny :remember :task}
   :report  {:to-model #{:deny :ask} :list-max 20}})

(defn jail [sys] (merge-with merge JAIL (:jail sys)))     ; same as (rules sys) in omega.edit
```

Profiles are named overrides:

```clojure
;; env.bl
{:name "shop"
 :omega {:jail     {:mediate+ [[:connect [:host "registry.npmjs.org"] :allow]]}
         :profiles {:careful {:jail {:floor {:net :none}}}
                    :plan    {:jail {:floor {:write [:task-tmp]}}}   ; plan mode = read-only, kernel-enforced (D10)
                    :yolo    {:jail :off}}                           ; explicit, shown on the card in red
         :reload   :manual}}
```

### 4.3 What the model writes: nothing new

The prelude keeps its shape. The jail is invisible until it matters.

```clojure
(sh "python gen.py")
;; ⇒ {:out "…" :exit 0
;;    :effects "wrote data/a.json, data/b.json · ran python3"}

(sh "curl https://example.com/x.json -o x.json")
;; ⇒ {:out "curl: (7) Failed to connect …" :exit 7
;;    :effects "DENIED: connect example.com:443 (network is :proxy; host not allowed) — ask with (sh … {:ask :net})"}

(sh "pip install requests" {:ask :net})        ; the model may REQUEST an ask; the human decides
(effects)                                      ; this cell's effects as data
(effects {:task "t-hex" :op :connect})         ; any query over :effect/* facts
```

**Eval cells:** with SB-Q3's eval node, `(read …)`, `(edit …)` and `(write …)` in the cell are
thin stubs that `erpc` back to the harness (to the file port, buffer servers and claims). The
model's own code (loops, string work, its own `File/write!`) runs under the floor. Nothing in the
model's syntax changes; the stubs are generated from the prelude.

### 4.4 The facts

```clojure
{:effect/op      :write                 ; :write :unlink :rename :mkdir :exec :connect :image
 :effect/path    "data/a.json"          ; project-relative when inside
 :effect/to      nil                    ; rename target
 :effect/pid     4123
 :effect/cell    "t-hex/7/toolu_01…"    ; C4 cell id
 :effect/task    "t-hex"
 :effect/source  :syscall               ; :edit :syscall :trace :scan :eval :external
 :effect/verdict :allow                 ; :allow :deny :ask→:allow/:deny :pass
 :effect/rule    [:write :project :record]
 :effect/by      nil}                   ; the human who answered an ask
```

The historian folds a step's effects into its change. FEAT-010's "this cell changed the world"
reads them. The card counts them.

---

## 5. Every open question

The **lean** stands unless you answer. IDs are stable so you can answer by ID.
- **CP** = checkpoints and the live image;
- **SB** = sandbox;
- **IN** = integration, new in this note.

### CP — checkpoints and the live image (`checkpoints-and-the-live-image.bl.md` §9)

| ID | question | options | lean (default) | why |
|---|---|---|---|---|
| CP-Q1 | Where does a beam-lisp project's app run? | (i) inside the harness image · (ii) its own target VM via realm · (iii) the project chooses | **(iii), defaulting to (ii)**; (i) refused when the project is beam-lisp itself | one global var registry, forks that leak, and never-unloaded modules make (i) unsafe as a default; (ii) keeps the live feel over distribution |
| CP-Q2 | Default reload policy after a checkpoint | `:manual` · `:on-checkpoint` · `:on-write` | **`:manual`; `:on-checkpoint` per project** | an agent's half-done edits should not run in an app the human is using unless asked |
| CP-Q3 | Evals into a project namespace (code live but not in any file) | allow, record as drift, offer write-back · refuse (agents must edit files) · ignore | **allow + record + offer write-back** | keeps the REPL workflow, makes the gap visible |
| CP-Q4 | Reload granularity | whole namespace (`reload/commit` today) · coherence-check the bundle, apply per var (needs an upstream beam-lisp change) | **per var after a bundle check** | whole-ns eval is superlinear (4.2 s at 100 fns); the bundle check keeps PLAN-056's coherence guarantee |
| CP-Q5 | Live state on "back to step N" | warn only · warn + offer restart of named servers / the target VM · project-provided migrations | **warn + offer restart now; migrations in FUP-009** | nothing can rewind state; restart is the honest default |
| CP-Q6 | Modifying beam-lisp itself: when does the heavy gate (build + seed check) run? | every step · per batch (agent says "ready", or idle) | **per batch; source checkpoints stay per step** | a boot-tier build costs minutes |
| CP-Q7 | Who moves omega's pin onto a new beam-lisp? | the agent · the human, with an evidence button | **human only** | a bad pin breaks the tool you repair it with |
| CP-Q8 | Per-task images | never · a target VM per task when asked (`:isolate`) | **later, as a VM per task** | falls out of CP-Q1 (ii); would share mechanism with test isolation (E17 b) |
| CP-Q9 | The §15.9 scope split: what goes into FEAT-005 vs FUP-009 | `:image` part + opt-in reload + `run-sandboxed` ward gate in FEAT-005; restore, process state, stale closures, macros, purge in FUP-009 · move restore into FEAT-005 · move everything image-related to FUP-009 | **as proposed** (first option) | the recorded part is cheap and exact; restore has the holes |

### SB — sandbox (`beam-in-charge.bl.md` §6)

| ID | question | options | lean (default) | why |
|---|---|---|---|---|
| SB-Q1 | Default floor for agent `sh` | none (today, D10) · Landlock project-write + task tmp, no inet · + network via a proxy and secrets read-denied | **Landlock project-write + task tmp; net via proxy; secrets read-denied**; per-project override | the floor costs ~0; reads of `~/.ssh` are the real exfiltration risk |
| SB-Q2 | What is mediated by default | nothing · record writes/execs/connects · record + ask for inet | **record + ask for inet; build dirs `:pass`** | records make history exact; inet is the only effect worth interrupting a human for |
| SB-Q3 | Where eval cells (the model's beam-lisp) run | in the harness VM (call trace + capability gate) · a jailed eval node per world · per task | **a jailed eval node per world first**, per task later | the kernel floor covers everything the model's code does, NIFs included; a crashed cell costs a node restart, not bl-ed |
| SB-Q4 | Speculative steps on a rootless overlay (run, see the whole diff, then merge or drop) | no · opt-in per task · default | **opt-in (`:speculative true`)** | also gives test isolation; adds a merge step through the buffer servers (IN-Q3) |
| SB-Q5 | Where the `jail` primitive lives | omega (`priv/jail/notify.c`) · beam-lisp std (`jail` ns next to `System/cmd`) | **beam-lisp std, prototyped in omega first** | relay, spell and omega all spawn processes; one floor for all three |
| SB-Q6 | relay's systemd-run floor | replace · compose (systemd-run outside for cgroups, notify inside for Landlock + mediation) | **compose** | relay's cgroup caps and adversarial tests stay valid |

### IN — integration (new; raised by putting the pieces side by side)

| ID | question | options | lean (default) | why |
|---|---|---|---|---|
| IN-Q1 | Is the eval node (SB-Q3) also the target VM (CP-Q1) for a beam-lisp project? | separate VMs · one VM per project for both | **one per project**, with the model's cells in their own task namespaces | the model's cells usually *want* the project's code loaded; one VM halves the boot cost and the mental model; the harness still holds all authority |
| IN-Q2 | Do prelude calls from a jailed node go back to the harness over `erpc`? | yes, generated stubs (read/write/edit/claims/history stay in the harness) · move buffer servers into the node | **yes, stubs** | authority stays in one place (rule 1); costs a sub-ms hop per call; C6 already made the file port the single entry point |
| IN-Q3 | How does a speculative overlay (SB-Q4) merge? | copy the upper dir to disk (buffer servers adopt it as `:external`) · replay it as ops through the buffer servers (`:source :syscall`, attributed) | **replay as ops** | an open buffer converges instead of being overwritten; attribution survives |
| IN-Q4 | Which wave does the jail land in? | W1 next to history (FEAT-005), as a FEAT · after W6 · only after SB decisions | **a new FEAT in W1b, next to FEAT-005**; FEAT-005's post-`sh` scan shrinks to `:pass` dirs | the jail is how history gets exact `sh` effects; building the scan first would be a parallel implementation to remove later |
| IN-Q5 | macOS | out of scope · degrade to relay's shape + scan | **degrade** | Landlock and seccomp-notify have no macOS equivalent; Seatbelt gives a floor without per-syscall questions |

**After you answer, I will:**
- record the answers in the register (bl-ed §13);
- update FEAT-005 and FUP-009;
- file the jail FEAT (with IN-Q4's wave);
- adjust the PLAN-003 wave table.
