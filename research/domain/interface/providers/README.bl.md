# Document providers: the world as documents you can read, act on, and stay in

*2026-10-04. Design, **now built** (`../ux-slice.bl.md` §8 records the departures: one VM instead of
a bridge, presentations, rev long-poll). What it contains:*
- *§1 the vision;*
- *§2 the protocol all providers share;*
- *§3 what bl-ed needs (five small, generic changes);*
- *§4 the provider index, the build order and the cuts that make this feasible.*

*One file per provider in this directory.*

*Grounding (OBSERVED on 2026-10-04):*
- *vendored bl-ed at `vendor/bl-ed` (from beam-lisp main `55f0a2af`; drive tests 19/19 when built
  by main);*
- *omega main;*
- *the pin `2360b32e`.*

*`clojure`/`text` fences are design sketches.*

| provider | file | one line |
|---|---|---|
| `omega:scratch` | [`scratch.bl.md`](scratch.bl.md) | the one writable virtual document: homeless tasks and your notes |
| `omega:overview` | [`overview.bl.md`](overview.bl.md) | every task, grouped by urgency; `RET` goes home |
| `task:<id>` | [`task.bl.md`](task.bl.md) | a task as a livebook: its turns, cells, traces, messages; the composer |
| `q:<id>` | [`q.bl.md`](q.bl.md) | a datalog query over the world as a live org table |
| `effects:<id>` | [`effects.bl.md`](effects.bl.md) | what a task (or a cell) did to the world, one row per effect |
| `bl:<ns>` | [`bl.bl.md`](bl.bl.md) | a namespace as the live image holds it: vars, drift, reload |

---

## 1. Why documents, and why this is the vision and not a side feature

The design centre is a Lisp machine as its creators would build it in 2026. Two ideas from that
lineage carry this design:
- **Genera's presentations.** Anything on screen *is* the object it shows. Pointing at it offers
  that object's commands.
- **Emacs's special buffers** (dired, magit, `*Help*`). A tool is a buffer that renders state as
  text and binds keys on its rows.

bl-ed already has the substrate both need:
- one text model;
- named commands in a table;
- keymaps as data;
- effects as data;
- a live `:` line running the real language.

**The thesis: every view of omega is a document.**
- The overview, a task's transcript, a query and an effect log are org text. The same editor moves
  over them with the same motions (`] h`, `/`, `m s`, the outline, the palette).
- There is no second UI toolkit to learn, theme or test.
- omega's web UI (`omega.ui.*`) remains for people not in an editor. Both read the **same
  projections** (`omega.ui.model/snapshot`, `task-detail`), so they cannot disagree.

This is also how the rest of the design reaches the human without new machinery:

| design element | reaches the human as |
|---|---|
| task cards (FEAT-015) | a presentation on the result row; the same presentation on every overview row |
| the sidebar (bl-ed §4.2, FEAT-009) | `task:<id>` (a split window later; visiting it first) |
| the journal / home cells (E7) | `RET` on any task row jumps home, wherever home is |
| `q` in the prelude | `q:` shows the same query as a live table |
| sandbox effect facts (how-it-fits §4.4) | `effects:` |
| live image, drift, reload (checkpoint doc) | `bl:` |
| D1, the console holds no authority | views are **read-only** text; every write is an intent to the owner |

---

## 2. The protocol: providers answer the routes bl-ed already speaks

**The cheapest protocol is the one that already exists.** bl-ed's page performs four effects
against four routes (`web/host.mjs:85-125`, `serve.bl` router):

| effect (page) | route | today's owner |
|---|---|---|
| boot / visit | `GET /api/file?path=` | files under `BLED_ROOT` |
| `:save` | `POST /api/save {path text}` | files |
| `:eval-cell` | `POST /api/eval {path id text}` → `{text result}` | `bl.doc/run-doc` |
| `:place` | `POST /api/place {path text}` → `{cells {id {place why}}}` | `system.place` |

A provider is a **handler for a path scheme** on those same routes, plus one cheap route for
freshness:

| route | new | meaning |
|---|---|---|
| `GET /api/rev?path=&since=` | yes | long-poll: answers `{rev}` as soon as `rev ≠ since`, or after 25 s with the same rev |

`serve.bl` keeps its file handlers for plain paths. A path `scheme:name` dispatches through **one
table**:

```clojure
;; design sketch — vendor/bl-ed/serve.bl
(def providers
  "scheme → provider. A provider is a map of fns, or {:forward url} to another VM that
   answers the same five routes for that scheme. Data, so a package adds one entry."
  {"omega"   {:forward :omega}          ; the omega bridge (FEAT-014), URL from .omega/url
   "task"    {:forward :omega}
   "q"       {:forward :omega}
   "effects" {:forward :omega}
   "bl"      bl-ed.providers.bl/provider})   ; this VM's own image (bl.bl.md)
```

### 2.1 What a provider implements

```clojure
;; design sketch — the whole contract. Only :read and :rev are required.
{:read  (fn [name params] {:text s :rev r :read-only? b :objects [obj …] :title s})
 :rev   (fn [name params] r)                     ; MUST be cheap: no rendering
 :write (fn [name text base-rev] {:rev r} | {:conflict r})   ; only writable documents
 :eval  (fn [name cell-id text] {:result s :text s?})       ; cells the provider runs
 :place (fn [name text] {cell-id {:place p :why s}})}       ; how the gutter marks its cells
```

- **`:text` is org.** It goes through the same `bl.doc.spans` partition, so outline, folding, cells
  and results all work with no provider-specific editor code.
- **`:objects`** is the presentation map: `[{:row r :type :omega/task :key "t-41"} …]`. A row is the
  object it shows (§3.3).
- **`:rev`** is opaque. Two equal revs mean equal text, so the page reloads only when it changes.
- **`:read-only? true`** for every provider except `omega:scratch`.

### 2.2 Freshness: long-poll on rev, regenerate only on change

```text
page                     serve.bl / bridge                      world
 │ GET /api/rev?path=omega:overview&since=r7 ─▶  :rev  ─▶  (cheap: basis-t moved? then hash text)
 │                                               …blocks until rev≠r7 or 25 s…
 │◀─ {rev r8} ───────────────────────────────────┤
 │ GET /api/file?path=omega:overview ────────────▶ :read (cached per rev)
 │◀─ text, objects ──────────────────────────────┤
 │ dispatch :load (cursor kept)
```

- **Zero idle cost.** One parked request per visible virtual document; nothing renders while nothing
  changes.
- **`rev` for omega's providers is two-stage:**
  1. the store's `basis-t` (one read) says whether *anything* changed;
  2. only then is the text regenerated and its hash compared.

  So an unrelated commit (another task's trace) costs one render of this view, never a reload of
  the page.
- **Wake-up:** the bridge subscribes once with `env/sense` (on the pin: `datom/watch` over the
  commit stream) and wakes parked polls. Until that is wired, an in-VM 250 ms `basis-t` check is
  correct and cheap.
- **The card poll of FEAT-015 folds into this.** Cards long-poll the rev of `omega:tasks?ids=…`, an
  internal document whose text is the rows as edn. It is one mechanism, not two.

### 2.3 Writes are intents, never text diffs

**The cut that makes this feasible:** a provider never has to map an edited text back onto facts.
- **Views are read-only.** The editor refuses an edit with a message naming what to do instead
  (§3.2).
- **Acting on a row** is a command of its presentation type, and the command emits an intent
  effect (`:task-answer`, `:task-say`, …) to the owner.
- **Changing a cell** in a view: `c` on the cell copies it into `omega:scratch` with its context
  (namespace, task) in the header. You edit and run it there. **There is exactly one writable
  virtual document.**
- **Running a cell in a view** needs no edit: `C-Enter` sends it to the provider's `:eval` (for
  example, re-running an agent's cell as yourself in `task:`, which becomes a steer).

---

## 3. What bl-ed needs: five generic changes, each useful without omega

All of them go in `vendor/bl-ed` (recorded in `VENDOR.md` for upstreaming). Sizes are estimates.

| # | change | where | size | also useful for |
|---|---|---|---|---|
| B1 | **visit** another document: a `:visit {path}` effect and event (new editor value, keeping registers, user commands, keymaps); `C-o` / `C-i` back and forward; the dirty check before leaving | `ed/main.bl`, `ed/core.bl`, `host.mjs` | ~60 lines | opening files from the outline or palette, following links |
| B2 | **read-only documents**: `:read-only?` in the editor value; `c/apply-edits` refuses with `"read-only: c copies a cell to scratch"`; cell eval is still allowed | `ed/core.bl` | ~15 lines | viewing generated files, frozen docs |
| B3 | **presentations**: `:objects` → a `{row → {:type :key}}` index; a contextual keymap per type merged into `km/keymap-of` when the cursor row has an object; render carries `:present` for styling | `ed/keymap.bl`, `ed/main.bl` | ~50 lines | FEAT-015's card row *is* the `:omega/task` presentation |
| B4 | **refresh**: `:rev` in the editor value; host long-polls `/api/rev` while the document is virtual; a change → `:load` (cursor kept; for read-only documents, history reset rather than an undo step) | `host.mjs`, `ed/main.bl` | ~40 lines | live files changed on disk |
| B5 | **scheme routing** in `serve.bl`: the provider table (§2), forwarding, `/api/rev` | `serve.bl` | ~70 lines | any non-file source |

**B3 subsumes FEAT-015's "card-row contextual keymap" (E27).** The card is drawn for the
`:omega/task` presentation on a result row; the same type on an overview row gets the same keys.
`y` / `n` / `RET` / `f` / `t` mean the same thing everywhere a task appears.

---

## 4. Index, order, feasibility

### 4.1 Provider summary

| provider | host | data (exists?) | writable | runs cells | status |
|---|---|---|---|---|---|
| `omega:scratch` | bridge | `.omega/scratch.bl.org` | **yes** | yes (as `:task` cells and as task-namespace evals) | FEAT-016 |
| `omega:overview` | bridge | `model/snapshot` ✓ + bridge homes index | no | no | FEAT-017 |
| `task:<id>` | bridge | `model/task-detail` ✓ (`loop/turns`, `tr/all`, `actor/messages`) | no | yes (steer) | FEAT-018 |
| `q:<id>` | bridge | `env/q` ✓ | no | the query cell itself | FEAT-019 |
| `bl:<ns>` | serve.bl (bl-ed's VM) or a target VM | `reload/namespaces`, `drift`, `journal` ✓ on main and pin | no | yes (eval into the ns, recorded as drift) | FEAT-020 |
| `effects:<id>` | bridge | v0: cells' tool calls from turns; v1: `:effect/*` facts (the jail) | no | no | FEAT-021 |

### 4.2 Build order

```text
FEAT-014 bridge ─┐
FEAT-013 spans ──┴─▶ FEAT-015 cards (B3) ─▶ FEAT-016 protocol B1 B2 B4 B5 + scratch
                                                  ├─▶ FEAT-017 overview ─┐
                                                  ├─▶ FEAT-018 task ─────┼─▶ FEAT-019 q
                                                  ├─▶ FEAT-020 bl        │
                                                  └─▶ FEAT-021 effects (v0 now; v1 after the jail FEAT)
```

overview, task and bl are independent of each other once the protocol lands, so they can be built
in parallel.

### 4.3 What was cut to make it feasible, and what each cut costs

| cut | instead | cost |
|---|---|---|
| editable views with text→fact write-back | read-only views + intents + copy-to-scratch | one more keystroke to edit an agent's cell; no reverse-mapping code anywhere |
| a socket / push protocol before W2 | long-poll on `rev` over existing HTTP | ≤ one round trip of latency; replaced by FEAT-007's socket without changing providers (only `:rev` delivery moves) |
| per-view fine-grained invalidation | `basis-t` gate + text hash | one extra render per unrelated commit, while the view is visible |
| windows / splits (bl-ed §10.5) | visiting + `C-o` back | the sidebar is a visit, not a split, until windows land |
| streaming deltas in `task:` | refresh at turn boundaries | you see a turn when it is recorded, not as it streams |
| provider code hot-loaded into the page | console commands compiled into vendored bl-ed (E28) | rebuild bl-ed to change console behaviour, until FUP-010 |
| omega schema additions | bridge-owned side files under `.omega/` (scratch text, homes index, query texts) | the indexes are not datalog-queryable until they move into the store with C1 |

### 4.4 Modularity rules

1. **bl-ed knows schemes, not omega.** B1–B5 contain no omega names. `omega` appears only in the
   provider table and in `ed/omega.bl` (the presentation commands).
2. **A provider is a pure function of the world, plus a rev.** `:read` composes an existing
   projection with a renderer. The renderer is a separate, pure `(projection) → {:text :objects}`
   fn, unit-testable without a VM, bridge or page.
3. **One projection, two renderers.** `omega.ui.model` feeds both the web UI's hiccup and the
   providers' org. A new field shows up in both or neither.
4. **Presentation types are shared vocabulary:** `:omega/task`, `:omega/msg` (an ask),
   `:omega/cell`, `:omega/effect`, `:bl/var`, `:bl/ns`. A type's commands live in one table. Any
   provider that emits a row of that type gets them.
5. **Paths are stable names.** `task:t-41` means the same thing in a link, a `#+RESULTS` reference, a
   palette entry and a test.
