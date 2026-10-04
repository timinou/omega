# Checkpoints and the live image

*A reading document. Written 2026-10-04 to make the design clear before more is built. It gathers
what the spikes measured (`spikes/history`, `async-checkpoint`, `fs-capture`, `live-image`) and what
beam-lisp already has (reload, ward, realm, the pin), and adds one new idea: the three things a
checkpoint covers are kept apart. Claims that come from a run are marked OBSERVED; the rest is
design. The decisions still open for you are collected in §9.*

---

## 1. The one idea: four things change, and they are not the same kind of thing

When an agent works on code, four different things can change. A checkpoint system goes wrong
when it treats them as one.

| # | thing | example | where it lives | made from | can we go back exactly? |
|---|---|---|---|---|---|
| 1 | **source** | `src/shop/price.bl`, `README.md` | files on disk | people and agents typing | **yes**: history keeps every version |
| 2 | **image code** | the var `shop.price/total` as it runs right now | the VM's var registry plus loaded modules | *derived* from source by eval/reload | **yes for code, with known holes** (§5) |
| 3 | **live state** | the cart a `defserver` holds, a datom conn's head, ETS, mailboxes | processes inside a running VM | *made by running code*, not from source | **no**: you can restart or migrate, not rewind |
| 4 | **builds** | beam-lisp's seed, AOT beams, compiler floor, a release drop | build directories | *derived* from source by a build | **yes, by switching**: an old build is a directory you start again |

Everything else in this document follows from this table:

- **Source is the durable record.** It is what history stores, what git exports, and what a human
  reviews.
- **Image code is a cache of source**, plus whatever someone evaluated without writing it down.
  That second part is *drift* (§6).
- **Live state is not a function of anything.** No checkpoint can bring it back. An honest system
  says so (OBSERVED in `live-image`: a redefined `defserver` keeps the state the old code built).
- **Builds are generations.** For an ordinary project they do not exist. For beam-lisp itself they
  are the whole problem (§7).

A checkpoint is therefore a record that *points at* all four: "after step 12, the source was tree
T, the image held these var hashes, it ran on build B, and these processes were alive". Only the
first three can be restored, each by its own method.

---

## 2. What a checkpoint is today (designed, partly built)

One **change** per agent tool step, written by one **historian** process (E6′, E22).

```text
 agent step ─▶ tool runs ─▶ :tool/after hook (inline, ~5 ms)
                              │ snapshot: texts the step wrote (edit/write)
                              │           + paths the cell touched (fs-capture: trace / scan)
                              ▼
                         cast to the historian (async)
                              │
                              ▼
                 historian: CAS objects + one change
                   parents · who/why/when · touched paths (+ :source)
                   gate verdict (per path) · line blame
```

Measured (OBSERVED):

| piece | number | spike |
|---|---|---|
| a checkpoint on the durable store | ~55 ms p50, flat over 1200 steps | `history` |
| cost on the agent's side (snapshot + cast) | ~4–5 ms p50, against 70–130 ms blocking | `async-checkpoint` |
| catching writes made from BEAM (`File/*`, `:file`, raw handles) | exact, under 1 ms per cell | `fs-capture` |
| catching writes made by `sh` children (python, sed, git) | a stat scan after the cell: 60–140 ms per 2,000 files | `fs-capture` |

What it does **not** hold yet: anything about the image (things 2–4). That is what this document
adds.

---

## 3. Three situations, three amounts of work

| situation | what a checkpoint must cover | new work |
|---|---|---|
| **A. An ordinary project** (Python, Rust, docs) | source only | none beyond §2 |
| **B. A beam-lisp project** (an app written in beam-lisp, possibly running) | source + image code, plus a note on live state | the `:image` part, a reload policy, and a ward gate (§4–6) |
| **C. beam-lisp itself** (the compiler, the std lib, the runtime omega runs on) | source + builds + the image of a *test* VM | generations and promotion (§7) |

Situation A is done by design. The rest of this document is about B and C.

---

## 4. Situation B: where does the project's code run?

This decides everything else, so it comes first.

### 4.1 Two places it could run

```text
  (i) one image                          (ii) a harness image + a target image
  ┌──────────────────────────────┐        ┌──────────────────┐   dist    ┌──────────────────┐
  │ bl-ed · omega · historian    │        │ bl-ed · omega    │◀────────▶│ the project's app │
  │ the project's app            │        │ historian        │  erpc /   │ its defservers    │
  │ (all one var registry)       │        │                  │  reload   │ its datom conn    │
  └──────────────────────────────┘        └──────────────────┘           └──────────────────┘
```

**(i) One image** is the Lisp-machine picture: the editor, the agent and the app share one world,
and a redefinition is visible everywhere at once. It is beautiful, and on today's beam-lisp it is
dangerous. All OBSERVED in `live-image` unless marked:

- **The registry is global.** An agent's bad reload of `shop.price` is also a bad reload for the
  human's running app. There is no per-task image.
- **Forks leak.** `env/fork` and `ward/run` on an existing namespace name rewrote the real var.
- **Old code is never unloaded.** About 4 modules stay loaded per redefinition (+241 after 60
  redefinitions of one var), so a long agent session in the editor's own VM grows without bound.
- **Crashes are shared.** A cell that eats the heap or wedges a scheduler takes bl-ed with it.
  The cell has a heap limit and a deadline, but a runaway `defserver` it starts does not.
- **A release image refuses reload.** Mutating reload is off unless `BEAM_LISP_RELOAD=1`.

**(ii) A harness image plus a target image** is how SLIME talks to an inferior Lisp, and how
realm already thinks: *one warm VM per tree and build* (PLAN-158).
- The project's app runs in its **own** VM, the target.
- omega and bl-ed run in the harness VM and reach the target over Erlang distribution: `erpc` for
  eval, and `reload/stage` + `reload/commit` for reload.

### 4.2 Recommendation: (ii) by default, (i) as an explicit choice

- **The default is a target VM per project**, started through realm. The agent's mistakes cost
  the target, never the editor.
  - Restarting the target is the honest "undo" for live state (§5.3).
  - The target can run inside the jail from the sandboxing document (the jailed peer node there
    is OBSERVED to work).
- **(i) stays available** for small, self-contained work, such as a beam-lisp scratch project or
  hacking bl-ed's own packages. It is a project declaration, like realm's `:vm "shared"`: never
  silent, always shown in the UI.
- Both use the same checkpoint record. Only the place the image part is *read from* and *applied
  to* changes.

> **Why not (i) for everything, as the Lisp machine did?** Genera had one image and one user. We
> have several agents writing at once, on a runtime that keeps every old body module. (ii) gives
> back the Lisp-machine *experience*: the editor sees the running app live, redefinitions apply in
> milliseconds, and a monitor shows the image changing. The cost is one distribution hop
> (sub-millisecond on one host). FUP-009's "per-task images" become possible later by giving a
> task its own target VM.

---

## 5. The image part of a checkpoint

### 5.1 What is recorded

Every change that touches beam-lisp code gets an `:image` part next to its files:

```text
:image {:vars     {shop.price/total {:hash "9f…" :prev "41…"}   ; changed
                   shop.price/tax   {:hash nil   :prev "c3…"}   ; removed
                   shop.price/extra {:hash "7a…" :prev nil}}    ; added
        :target   "realm:<tree>-<build>"                         ; which image
        :reloaded [shop.price]          ; only if the policy applied it (§5.2)
        :gate     {:ward :passed :ms 96}
        :state    {:servers [shop.cart] :note "kept state; handlers changed"}}
```

- **Hashes are of source forms, never of compiled code.** A var's hash is the hash of its reader
  form with positions stripped. Whitespace and comments change nothing (OBSERVED: a
  whitespace-only re-eval changed 0 vars). The compiled AST cannot be hashed: gensyms and module
  names differ on every eval (OBSERVED).
- **The var text goes into the same content store as file text**, so restore needs nothing new.
- **"Removed" comes from the namespace's own var list** (`own_names`), because plain eval never
  removes a var (OBSERVED).
- **Both ways a step changes code produce the same record:**
  - a file edit: the historian hashes the forms of the file's new text;
  - an eval cell: the forms the cell evaluated (see §6 for why these differ).
- **`:state` is a warning, not a snapshot.** It lists the live `defserver`s whose handler code
  changed: "these kept their old state under new code". That is the one live-state fact we can
  compute cheaply.

### 5.2 When the live image follows the source (the reload policy)

The question: after a step changes `price.bl`, does the running target pick up the change?

| policy | what happens | good for | risk |
|---|---|---|---|
| `:manual` | nothing until the human presses *reload*; bl-ed shows "image is 3 steps behind" | careful work on a stateful app | the human tests stale code without noticing |
| `:on-checkpoint` (proposed, opt-in) | after each change whose gate passed, reload the touched namespaces; record `:reloaded`, or `:held` with reasons | the normal agent loop on a dev app | new handlers on old state (§5.3) |
| `:on-write` | every save reloads (beam-lisp's reload watcher) | a human typing | an agent's half-finished multi-file edit is live for a moment |

- **Recommendation: `:manual` by default, `:on-checkpoint` per project.** A failed gate never
  reloads (E18 still checkpoints the step, but the image stays on the last good code).
- **How a reload is done** matters for speed (OBSERVED: whole-namespace eval is superlinear: 100
  functions took 4.2 s, one var 25–200 ms):
  1. Run beam-lisp's **coherence check** on the bundle of touched namespaces: dangling references,
     unkept `declare`s, removals still called elsewhere. An incoherent bundle is *held* and the
     old code keeps serving. That is beam-lisp's own reload contract (PLAN-056) and exactly what
     an agent's half-done edit needs.
  2. **Apply only the vars whose hash changed** (plus `undefine_var` for removed ones), rather
     than re-evaluating whole namespaces.
  - Step 2 is not what `reload/commit` does today: it evaluates the whole staged namespace. So
    "coherence-check the bundle, apply per var" is an upstream ask (§9, Q4).
- **Two tasks, one image:** the second task's `:prev` will not match the image's current hash for
  that var, and that mismatch is detectable. It is reported in the tool result like a claim
  conflict (C9), not prevented (OBSERVED: there is no per-task image).

### 5.3 What "back to step 12" does, honestly

| layer | restore method | exact? | cost |
|---|---|---|---|
| source | history checks out step 12's tree (as a new change, so step 13+ stay reachable) | yes | ms |
| image code | re-evaluate step 12's text of each var whose hash differs now; `undefine_var` vars added since | yes for vars | 15–31 ms for 3 vars (OBSERVED) |
| image code, holes | closures made by old code keep their old body; a changed **macro** changes callers whose own hashes did not change; old modules stay loaded | **no** | — |
| live state | not restored. Offer: restart the named servers (supervisor), restart the target VM, or run a migration the project provides (`reload.migrate`) | — | seconds |
| datom heads | not rewound. A held `db` value is a correct snapshot (OBSERVED); offer "read as of step 12", never a rewind | — | — |

**The UI rule:** the restore button says *"Restored code to step 12. State was not restored: 2
servers kept their state (restart them?)"*. A system that silently claims more than this is lying
to the human at exactly the moment they are debugging.

Macros need one more record: a change to a macro also lists the vars that expand it. These are
found by scanning the target's namespaces at checkpoint time. Then "what changed" is honest for
macro edits too (FUP-009, item 6).

### 5.4 The gate for a beam-lisp step is a ward, not a shell

For a beam-lisp project, "does this step break things?" is cheaper and better answered *inside a
VM* than by `sh bl test`, which boots a fresh VM each time.
- `reload.ward/run-sandboxed` runs the modified source and the project's tests in a forked
  registry under a unique namespace prefix: ~80–110 ms warm, 7–8 s on first use (OBSERVED).
- **Only `run-sandboxed`.** Plain `ward/run` and a same-namespace `env/fork` changed the live
  var (OBSERVED). A lint in the package refuses the other forms.
- Run the ward in the **target** VM, so it sees the project's dependencies. It still cannot see
  live processes or the real datom conn: a green ward tests code, not state.

---

## 6. Drift: when the image and the source disagree

beam-lisp's reload design states its thesis plainly: *"the running image is the single source of
truth; a `.bl` file on disk is a live handle to it"* (PLAN-056). omega's history says the opposite
about what is durable: files are the record. Both are right about different things, and drift is
where they meet.

**Drift = image code that no source file spells.** It appears in three ways:
1. An agent cell evaluates `(defn total …)` **into a project namespace** without editing the file.
2. A human evaluates a form in bl-ed's REPL.
3. A reload was held or failed, so the file is ahead of the image.

`reload/drift` covers (3): files newer than the image. Nothing covers (1) and (2) yet.

**Proposal:**
- **Evals into a task's own namespace** (`omega.w.<world>.<task>`) are scratch. They are not part
  of the project image, are not recorded as image changes, and disappear with the task. This is
  already how codemode works.
- **Evals into a project namespace** are recorded as image changes with `:source :eval` and shown
  as drift: "`shop.price/total` is live but not in `price.bl`". bl-ed offers **write back** (put
  the form into the file at the var's position; that becomes a normal file change) or **discard**
  (re-evaluate the file's version).
- **A checkpoint never hides drift.** The `:image` part records the image's hashes, the file part
  records the files' hashes, and a difference between the two is visible in the change.

That keeps beam-lisp's thesis (the image is live and authoritative *now*) and omega's (only what
is written down survives). The human sees the gap and closes it on purpose.

---

## 7. Situation C: when the agent modifies beam-lisp itself

This is the case that needs the most care: the thing being edited is the thing that runs the
editor.

### 7.1 Why it is different

beam-lisp is not one artefact. A checkout holds several layers that become live in different ways
(OBSERVED in `docs/dev/which-bl.md` and this machine's history):

| layer | example | becomes live by | cost of a change |
|---|---|---|---|
| std/lib `.bl` | `priv/std/reload.bl`, `priv/std/bl/env.bl` | AOT-compiled from source on demand under `./bin/bl`; **invisible** under the drop `./bl` for the namespaces the drop ships as beams | seconds |
| the Elixir half | `lib/beam_lisp/*.ex` | only `bl build`'s `:ex` stage; `bin/bl` warns "the Elixir half is STALE" | a build |
| the boot tier / compiler | `priv/boot/*`, the compiler | a rebuild against the committed **compiler floor**; uncommitted edits made *every* run recompile the boot tier for minutes (OBSERVED, which is why omega pins) | minutes |
| the seed | `priv/bootstrap/seed/*.beam` | regenerated and checked (`bl seed --check`); a foreign seed breaks every `bl` (BUG-089) | long; risky |
| a drop / release | the 143 MB `./bl` | a packaged build in an immutable directory | a release |

On top of that, **omega does not run on the beam-lisp checkout at all**. It runs on a pinned
build: `env.bl` says `:bl "commit:2360b32e"`, and `bin/bl` resolves it through the launcher. That
pin is the single most important safety property for situation C, and it already exists.

### 7.2 The rule: the harness never runs on the tree it edits

```text
  harness VM (omega + bl-ed)          target VMs (the beam-lisp tree being edited)
  runs build P (the pin)              run builds made FROM the edited tree
  ┌───────────────────────┐          ┌──────────────────────────────────────────┐
  │ never reloaded by     │  starts  │ gen 1: ./bin/bl on the working tree       │
  │ the agent's edits     │────────▶│ gen 2: after a rebuild (boot tier changed) │
  │                       │  checks  │ gen 3: …                                   │
  └───────────────────────┘          └──────────────────────────────────────────┘
              ▲                                         │
              └──── promotion: a human moves the pin ◀──┘   (§7.4)
```

- **Edits to the beam-lisp tree are tested in target VMs started from that tree**, never by
  reloading the harness. This is situation B's (ii) made mandatory: (i) is refused when the
  project *is* the harness's own runtime.
- **The kind of target depends on the layer touched**:
  - only std/lib `.bl` changed: the target can stay warm and be hot-reloaded per checkpoint,
    exactly as in situation B;
  - the Elixir half, the boot tier, the compiler or the seed changed: the target must be a **new
    generation**, meaning build, check, then start a fresh VM. The old target is not reloaded into
    the new world.
- realm already provides the mechanism: *one VM per tree and build*, builds as immutable
  directories, and drain/stop/idle-exit. A generation is a realm build.

### 7.3 A checkpoint in situation C

```text
:build {:tree     "beam-lisp@<tree hash of this change>"
        :layers   [:std :elixir]            ; which layers the step touched
        :gen      "realm:beam-lisp-<build-key>"   ; the build the gate ran on
        :reuse    false                     ; true = warm target, hot-reloaded
        :gate     {:seed-check :passed :tests {:passed 412 :failed 0} :ms 184000}}
:image {…}                                  ; as §5, for std/lib .bl changes in a warm target
```

- **The gate is layered, cheapest first:**
  1. a ward in the warm target, for std/lib changes;
  2. `bl test` on the affected files in a fresh VM of the edited tree;
  3. the full build plus `bl seed --check`, only when the boot tier, the compiler or the seed
     changed.
  Each verdict is recorded. A failing gate still checkpoints (E18).
- **Restore is cheap because builds are directories.** "Back to step 12" means: check out step
  12's tree (source) and start a VM on step 12's build if realm still has it, else rebuild. No
  reload is involved, so none of §5.3's holes apply to the boot tier.
- **Build cost is the real constraint, and it shapes the loop.**
  - A boot-tier step costs minutes (OBSERVED on this host, worse under memory pressure: zram,
    `clang++` builds).
  - So in situation C a checkpoint per *tool step* stays (it is cheap: source only), but the
    **heavy gate runs per batch**: when the agent says "ready", or at idle.
  - The step list shows which steps were covered by which generation's gate.

### 7.4 Promotion: moving the harness onto the new beam-lisp

The agent can build, test and checkpoint a new beam-lisp. It must **not** switch omega onto it.
Moving the pin is a human-tier decision, like a git commit to main, because a bad pin breaks the
tool the human uses to repair it.

The ritual already exists (omega's memory note on the pin):
1. `bin/bl test test/` with `BL_USE=commit:<sha>`;
2. `bin/omega-headless` with the same;
3. edit `env.bl`'s `:bl`;
4. restart.

The checkpoint system's job here is to make the ritual a button with evidence:
- "build `<sha>` passed the omega suite and a headless task; promote?";
- one fact on the change: `:promoted-at`;
- a **rollback** that is just the old pin, because the old build directory is still there.

### 7.5 The traps worth naming (all OBSERVED on this machine)

- **Two `bl`s in one checkout run different code.** `./bl` (the drop) ignores edits to namespaces
  it ships as beams. Every gate must name `./bin/bl` explicitly.
- **A cold cache after anyone edits `priv/boot/*`** ("compiler_key_mismatch; using it to rebuild")
  is normal, not an error. The UI should say "rebuilding the floor (minutes)", not look hung.
- **Uncommitted boot-tier edits in a shared checkout** make *every* run, by anyone, recompile for
  minutes. Agents doing situation C work need their own worktree (realm keys VMs by tree, so this
  falls out).
- **Builds in `/tmp` hit the tmpfs quota** mid-build and leave `build/` half-written. Build
  directories go off `/tmp`.
- **Git hooks leak `GIT_DIR` into detached children** (realm step 7). Any background build or
  drain started from an agent step must scrub the git environment.

---

## 8. How it fits together: one change, all four layers

```text
 step 14 of task t-7 (situation B, policy :on-checkpoint, target VM T)
   1. the agent edits src/shop/price.bl (edit tool) and runs (sh "python gen.py") (writes data.json)
   2. :tool/after → snapshot {price.bl text} + fs-capture {data.json :source :scan} → cast
   3. historian: CAS objects; change C14
        :files  {src/shop/price.bl :source :trace, data.json :source :scan}
        :image  {:vars {shop.price/total changed, shop.price/extra added} :target T}
   4. gate (per path): ward run-sandboxed in T over price.bl + its tests → :passed 96 ms
   5. policy: coherence check {shop.price} → ok → apply 2 vars in T → :reloaded [shop.price]
        :state {:servers [shop.cart] :note "handlers changed, state kept"}
   6. bl-ed: "C14 · changed total, added extra · reloaded · shop.cart kept its state"
```

Undoing C14 later: the files come back from the CAS, the two vars are re-evaluated in T (or
`extra` is undefined), and the human is told `shop.cart`'s state is whatever C14's code made it,
with a one-click restart of that server.

---

## 9. Decisions open for you

Each has a recommendation; none is built yet.

| # | question | options | lean | why |
|---|---|---|---|---|
| **Q1** | Where does a beam-lisp project's app run? | (i) in the harness image · (ii) in its own target VM (realm) · (iii) project's choice | **(iii), defaulting to (ii)**; (i) refused when the project is beam-lisp itself | one global registry, leaking forks and unpurged modules make (i) unsafe as a default; (ii) keeps the live feel |
| **Q2** | Default reload policy | `:manual` · `:on-checkpoint` · `:on-write` | **`:manual`, `:on-checkpoint` per project** | the agent's half-done edits should not run in an app the human is using unless asked |
| **Q3** | Drift: evals into project namespaces | allow + record + offer write-back · refuse (agents must edit files) · ignore | **allow + record + offer write-back** | keeps the Lisp-machine REPL workflow and makes the gap visible |
| **Q4** | Reload granularity | whole namespace (`reload/commit` today) · coherence-check the bundle then apply per var (upstream change) | **per var after a bundle check** | whole-ns eval is superlinear (4.2 s at 100 fns); the bundle check keeps PLAN-056's guarantee |
| **Q5** | Live state on restore | warn only · warn + offer restart · project-provided migrations | **warn + offer restart now; migrations later (FUP-009)** | nothing can rewind state; restart is the honest default |
| **Q6** | beam-lisp itself: heavy gate cadence | every step · per batch ("ready" / idle) | **per batch; source checkpoints stay per step** | a boot-tier build costs minutes |
| **Q7** | Promotion of a new beam-lisp under omega | agent may promote · human only, with an evidence button | **human only** | a bad pin breaks the tool you repair it with |
| **Q8** | Per-task images | never · a target VM per task when asked (`:isolate`) | **later, as a target VM per task** | falls out of Q1 (ii) at the cost of a VM per task; E17 (b)'s test isolation could share the mechanism |

## 10. Where things are

- Measurements: `spikes/history.bl.md`, `async-checkpoint.bl.md`, `fs-capture.bl.md`,
  `live-image.bl.md` (each ends with `## Findings`).
- Decisions so far: `research/domain/interface/bl-ed.bl.md` §15 (E6′, E18, E22, E23; §15.9 for the
  image scope split).
- Items:
  - FEAT-005: history, capture, the `:image` part, the ward gate;
  - FUP-009: image restore, state, stale closures, macros, module purge;
  - FEAT-001: the re-pin ritual.
- beam-lisp:
  - `examples/reload/00-README.md` (the reload ladder);
  - `!tasks/plans/PLAN-056-*` (coherent reload);
  - `docs/dev/which-bl.md` (the two `bl`s);
  - realm's `PLAN-158-realms-*` (one VM per tree and build).
