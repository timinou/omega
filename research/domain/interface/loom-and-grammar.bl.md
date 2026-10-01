# loom and the grammar of the web — the UI vocabulary omega inherits

> Literate beam-lisp: every ```` ```beam-lisp ```` block runs under
> `cd omega && bl run research/domain/interface/loom-and-grammar.bl.md`. ```` ```clojure ````
> blocks are design sketches (not run); ```` ```ts ```` etc. are quotes.

**Abstract.** `loom` is beam-lisp's "grammar of the web": a closed set of seven
value-primitives (mark, style, layout, encoding, data, event, reconcile) from which
any web UI is composed. A screen is a pure function `state → hiccup`; hiccup is plain
nested data, so it can be built, tested, diffed, transformed, linted and *rendered by
more than one back-end*. Events are data (`[:intent …]`, `[:assign …]`, `[:navigate …]`),
never closures. `loom.desktop` makes a native wry/WebKitGTK window one such back-end
(a pure `view` + a pure `on-event` reducer + one driver process). This file documents
the whole public surface as it exists today, what was observed by running it, and what
omega should take, adapt or drop. It is the foundation for `tui-ratatui.bl.md` (a ratatui
back-end with a loom-shaped API).

---

## 1. Sources

Everything below was read from these paths (OBSERVED), unless marked INFER.

**beam-lisp repl worktree** (`/home/user/code/undefine/beam-lisp--repl`; `beam-lisp`
main has the same `priv/lib/loom/*.bl` file set):

| path | lines read | what |
|---|---|---|
| `docs/grammar-of-the-web.md` | 1–311 (all) | THE grammar document (§3) |
| `priv/lib/loom/token.bl` | 1–332 | scale, theme, `sx`/`sx*`, sheet, `realize`/`with-sheet` |
| `priv/lib/loom/box.bl` | 1–167 | the one layout primitive |
| `priv/lib/loom/ui.bl` | 1–302 | atoms: button/field/… |
| `priv/lib/loom/parts.bl` | 1–669 (headers+doc comments, key bodies) | compound parts |
| `priv/lib/loom/form.bl` | 1–261 | `form-for` schema → form |
| `priv/lib/loom/transform.bl` | 1–144 | view-as-data transforms |
| `priv/lib/loom/desktop.bl` | 1–493 | wry render target, `app`/`bar`/`dropdown` |
| `priv/lib/wry.bl` | 1–183 | the window NIF surface |
| `native/wry_webview/{Cargo.toml,src/lib.rs}` | Cargo 1–40; lib.rs 1–70, 376–400, 535–560 | Rust crate |
| `priv/lib/live/hiccup.bl` | 1–100 | hiccup → HTML, `data-ev-*` |
| `priv/lib/live/diff.bl` | 1–60 | keyed hiccup diff → patch ops |
| `priv/lib/live/socket.bl` | 56–182 | event vocabulary + normalisation |
| `priv/lib/live/app.bl` | 1–30 | the "app is a value" shape |
| `examples/loom/*.bl` (box/ui/form/token/transform-gallery), `examples/desktop/{README.md,hello-app.bl,statusbar.bl}` | skimmed headers | showcases |
| `test/bl/loom/{box,ui,form,token,parts,transform,catalog}_test.bl` | `ui_test.bl` 1–40 | tests (a11y + no-ceiling contracts) |
| `docs/explorer.md` | 1–30 | the self-measuring catalog |
| `docs/design/form-first-interaction.md` | 1–20 | form-as-unit interaction contract (editor, not loom) |

**beam-lisp main tasks/memory** (`/home/user/code/undefine/beam-lisp`):
`!tasks/plans/PLAN-059-loom-grammar-of-the-web.org` (waves A–E, "no ceiling"),
`!tasks/plans/PLAN-061-loom-explorer.org` (catalog → explorer reframe),
`!tasks/plans/PLAN-002-loom-shell-a-native-wayland-bar-in-pure.org` (headers only: native Wayland bar),
`!tasks/features/FEAT-032-loom-desktop-wry-as-a-live-loom-render-t.org` (desktop spec, DONE),
`!tasks/plans/FUP-015-loom-form-for.org` (form-for, DONE),
`.spell/memory/concepts/loom--grammar-of-the-web-for-beam-lisp.org` (concept summary).

**Runtime used for the runnable block:** the installed `bl` (`beam-lisp 2026.4.0`,
`~/.local/share/drop/725ed831/lib/beam_lisp-2026.4.0/priv/lib/loom/`). NB: that
bundled loom is *older* than the repl worktree — see §2.8.

---

## 2. What loom is, and how it works

### 2.1 The one sentence and the seven parts (OBSERVED: `docs/grammar-of-the-web.md`)

> **Your app is a function. It takes the current state of the world and returns a
> picture of the screen. Everything else is derived from that.**

Faithful summary of the doc's seven parts:

1. **Mark** — one node of the picture: `[:button {:class "primary"} "Save"]`. HTML as data.
2. **Style** — a map of visual properties passed to `sx`, hashed to a tiny class + one remembered
   rule; identical styles collapse. Values come from a **scale** (`(space :4)`) but "a scale is
   a floor, not a ceiling": every prop also takes a raw value and a raw `:style` map always wins.
3. **Layout** — ONE primitive, `box`; every arrangement is options on it (`:dir :gap :align
   :grid :at` …). Breakpoints are `:at {:md {…}}`; hover/focus ride in `:on`; motion is a style
   (`keyframes` hashed like `sx`).
4. **Encoding** — the view function `(view world session) → mark`; pure.
5. **Data** — exactly three homes for state: **Shared** (durable, historical log), **Session**
   (this tab, private), **Local** (view-only bits).
6. **Event** — intent as data: `[:button {:on-click [:intent :save {:id 7}]} "Save"]`. Three
   verbs: `:intent` (change shared world), `:assign` (change this tab's state), `:navigate`
   (change the route).
7. **Reconcile** — old tree vs new tree → shortest keyed list of edits; the author never sees it.

Free consequences the doc claims (INFER-level benefits, but each is mechanically grounded below):
time-travel (view is a function of a log-structured world), one supervised process per viewer,
and provable rules (data-shaped parts can be checked).

**"Why the picture being data matters"**: retheme a subtree by walking it; audit a11y by
*querying* the tree; extend vocabulary with your own tag that expands to marks; prove a view pure.

**"The closed set, and why it is enough"** (table from the doc):

| you want | you compose |
|---|---|
| routing | `:navigate` sets a route; the view branches on it |
| a form | derive fields from a data schema; validate with a plain predicate |
| loading states | a view over a value that is still arriving |
| optimistic UI | one event that assigns now and requests the real change next |
| undo / redo | point the view at an earlier moment in the log |

**"Hierarchy — how much of the world one screen shows"** (from a 2026-09 French banking-QA
console redesign: 1 235 words/4 082 px → 347 words/one screen, nothing deleted):

- **Rule:** *"A screen answers one question. Every other question gets a link."*
- **Five moves**, each a Mark + `:navigate` (or platform state), no new part:
  tabs (`(tabs {:active id :tabs [{:id :href :label :count}]})`, URL `?onglet=`),
  filter pills (`:variant :pills`), disclosure (native `<details>`), facts (`<dl>` grid, 3–8
  attributes), table (row name is the link).
- **Selection belongs in the URL** (a `:navigate`, not an `:assign`) → shareable, bookmarkable,
  Back-button-able, testable with a GET, no session state. Unknown selection falls back to the
  first tab. *Disclosure opens what the reader came for* (failed criteria open, met ones fold).
- **Subtractions:** no section eyebrows duplicating nav; provenance once not per card; no mechanism
  prose; no cards-in-cards (hairline between rows); no read-only inputs posing as forms (use
  `facts`); one primary action per screen.
- **Trap:** a `nil` child renders fine server-side but becomes an empty text node when a *patch*
  applies, shifting every later child index → build optional children with `cond->`/`conj`/filter,
  never leave a `(when …)` placeholder in a patched subtree. (Note: `live.diff/splice-children`
  *does* drop nils so the differ sees the renderer's list; the trap is for the browser client.)
- **`sx*` expresses parent state without new selector features:** `:on {"is(details[open]>summary>*)"
  {:transform "rotate(90deg)"}}` — `:is(…)` is a pseudo-class taking a full selector.

### 2.2 Module map (OBSERVED)

| ns | file | role |
|---|---|---|
| `loom.token` | `token.bl` | tokens + theme + `sx`/`sx*`/`keyframes` + per-process sheet |
| `loom.box` | `box.bl` | `box` + named arrangements |
| `loom.ui` | `ui.bl` | atoms (a11y baked in) |
| `loom.parts` | `parts.bl` | compound parts |
| `loom.form` | `form.bl` | `form-for` |
| `loom.transform` | `transform.bl` | tree transforms/queries |
| `loom.desktop` | `desktop.bl` | native window back-end |
| `wry` | `wry.bl` | window NIF verbs |
| `live.hiccup` / `live.diff` / `live.socket` / `live.app` | `priv/lib/live/*.bl` | the web back-end (HTML, diff, event vocab, app value) |

### 2.3 Tokens (`loom.token`)

`(def tokens …)` is one nested map; categories and keys (values elided where long):

```clojure
{:color  {:bg :surface :surface-2 :surface-3 :border :border-2 :text :muted :faint
          :accent :accent-2 :accent-fg :danger :warning :success}      ; dark palette, hex strings
 :space  {:0 "0" :px "1px" :1 "4px" :2 "8px" :3 "12px" :4 "16px" :5 "24px" :6 "32px"
          :7 "48px" :8 "64px" :9 "96px" :10 "128px"}
 :radius {:none :sm "4px" :md "8px" :lg "14px" :xl "22px" :full "9999px"}
 :font   {:sans "system-ui,…" :mono "'SF Mono','JetBrains Mono',…"}
 :text   {:xs "12px" :sm "14px" :md "16px" :lg "20px" :xl "26px" :2xl "34px" :3xl "46px" :4xl "60px"}
 :weight {:normal "400" :medium "500" :semibold "600" :bold "700"}
 :leading{:tight "1.15" :normal "1.5" :relaxed "1.7"}
 :shadow {:none :sm :md :lg :xl}
 :motion {:fast "120ms" :base "200ms" :slow "320ms" :ease "cubic-bezier(…)" :spring "cubic-bezier(…)"}
 :screen {:sm "480px" :md "768px" :lg "1024px" :xl "1280px" :2xl "1536px"}}   ; min-width breakpoints
```

API (all `loom.token`):

| fn | contract |
|---|---|
| `(tok category key)` | resolve; **throws** on typo: `loom: no token :space / :99 — one of (…)` (OBSERVED) |
| `color space radius text weight shadow screen` | `(tok :cat k)` shorthands |
| `(len v)` | keyword → `:space` token · number → `"Npx"` · string → raw. `(len 13)`→`"13px"`, `(len "1.5rem")`→`"1.5rem"` (OBSERVED) |
| `(hue v)` | keyword → `:color` token · else raw string |
| `(install-theme! brand)` | deep-merge partial map over defaults, **per process** (`Process/put`); `(theme)` reads it |
| `(sx & maps)` | merge style maps (later wins) → class `"s<base36 phash2>"`; records `.cls{decls}` in the process sheet. Canonical (key-sorted) so same style ⇒ same class |
| `(sx* {:base :on :at})` | composite class: base rule + `.cls:<pseudo>{…}` + `@media(min-width)` blocks, cascade sorted small→large |
| `(keyframes {:from {…} :to {…}})` | hashed `@keyframes` name, same sheet |
| `reset-sheet! sheet-css sheet-classes css-for base-css style-tag` | the per-render atomic-CSS sheet; `css-for classes` ships only a patch's new rules |
| `(realize node)` | force lazy `for` children **in the calling process** (sx writes the process dict!) |
| `(with-sheet render-fn)` | reset sheet, run, `realize`, → `{:tree … :style [:style css]}` |

KEY GOTCHA (documented in-source + memory concept): `sx` is a side effect on the process
dictionary, so a lazy child realised later registers classes in the wrong process/sheet.
`with-sheet` realises first. **This is the one impure seam in an otherwise pure grammar** — a
non-CSS back-end (TUI) does not need it (see `tui-ratatui.bl.md`).

### 2.4 Layout (`loom.box`)

`(box {props} & children)` → hiccup. Props (OBSERVED, `box.bl` header + `box-css`):

| prop | meaning | CSS |
|---|---|---|
| `:dir` | `:col`(default)`:row :row-reverse :col-reverse` | `flex-direction` |
| `:gap` `:pad` | token / number / raw; `:pad` also `[y x]` / `[t r b l]` | `gap` `padding` |
| `:align` | `:start :center :end :stretch :baseline` | `align-items` |
| `:justify` | `:start :center :end :between :around :evenly` | `justify-content` |
| `:wrap` `:grow` `:shrink` `:basis` | flex self/children | `flex-*` |
| `:w :h :max-w :min-w :min-h` | token/number/raw, `:full` (100%), `:screen` (100vw/vh) | sizing |
| `:grid` | n (equal cols) · `"raw template"` · `:auto-fit` (+ `:min-col`, default 240) | `display:grid` |
| `:bg :fg :radius :shadow :border` | token-or-raw skin (`:border true` → 1px hairline) | skin |
| `:inline` | inline-flex | |
| `:at {:md {…box props…}}` | responsive override (it is itself a box map) | `@media (min-width)` |
| `:on {:hover {…css…}}` | stateful raw css | pseudo rules |
| `:style {…}` | raw css, **merged last, wins** | escape hatch |
| `:as` | tag (default `:div`) | |
| `:class` | author class **appended** | |
| *anything else* | forwarded to the element (`:id :on-click :data-* :aria-*`) | |

Named points (add *nothing* the raw box cannot say): `col` (`:dir :col :gap :4`), `row`
(`:dir :row :gap :3 :align :center`), `wrap`, `grid` (`:auto-fit :gap :4`), `center`, `(spacer [n])`.
Every box takes an optional leading opts map then children — a convention shared by every component
(`opts-of`/`body-of` in `ui.bl`).

**No-ceiling contract** (stated verbatim in PLAN-059 and tested in `ui_test.bl`): (1) every scale
prop takes token OR raw; (2) every primitive has a `:style` escape hatch merged last that wins;
(3) arbitrary attrs forward; (4) author `:class` appends; (5) named arrangements are overridable on
every axis.

### 2.5 Component vocabulary

All are pure fns `(opts? & children) → hiccup`, built on `box`, painted from tokens, a11y by
construction, events as `[:intent|:assign|:navigate …]` terms. Required inventory (public `defn`s of
the repl worktree):

**`loom.ui` — atoms**

| fn | opts | notes (OBSERVED) |
|---|---|---|
| `button` | `:variant :primary/:subtle/:ghost/:danger`, `:size :sm/:md/:lg`, `:disabled`, `:on-click` | disabled ⇒ real `disabled` + `aria-disabled` and **handler dropped** |
| `field` | `:name :label :value :type :multiline :hint :error` + passthrough (`:on-input` …) | real `<label for=id>`; error ⇒ `aria-invalid`, `aria-describedby`, `role=alert` |
| `checkbox` | `:name :label :checked` | labelled |
| `select` | `:name :value :options [[kw "Label"]…]` | |
| `card` | box opts | surface, border, radius :lg, pad :5, shadow :sm |
| `heading` | `(heading level & body)` 1–6 → `:3xl…:sm` | |
| `prose` | `:tone :default/:muted/:faint` | `<p>` |
| `link` | | `<a>` accent |
| `badge` | `:tone :default/:success/:danger/:warning/:accent` | pill |
| `alert` | `:tone :info/:success/:danger/:warning` | `role=alert`, left rule |
| `divider` `skeleton` | `skeleton {:w :h}` | `<hr>`, loading placeholder |

**`loom.parts` — compound** (public in repl worktree: `identity when-day kbd progress timeline
events tabs disclosure facts table dialog drawer toast empty-state error-state`)

| fn | shape |
|---|---|
| `identity` | `{:name :role :kind :person/:agent}` avatar (circle=person, square=agent) |
| `when-day` | YYYYMMDD long → `<time datetime title>` |
| `kbd` | keyboard hint |
| `progress` | `{:value :max :tone :label :caption :h}`; `role=progressbar` + `aria-value*` (OBSERVED) |
| `timeline` | `{:stages [{:name :status}]}` status ∈ `:done :running :pending :failed :planned` |
| `events` | `{:items [{:key :who :role :when :what :tone :meta}]}` — things that *happened* |
| `tabs` | **two shapes**: buttons (`:on-select` term, `role=tablist`, `aria-selected`) or link tabs (`:href` ⇒ `<nav>` of `<a>`, `aria-current="page"`, `:count`, `:variant :underline/:pills`) — one `:href` anywhere flips the whole part |
| `disclosure` | `{:summary :hint :open}` native `<details>` |
| `facts` | `(facts {:cols n} [[label value]…])` `<dl>` grid, nil value ⇒ em dash |
| `table` | cell-vectors `{:columns ["A"] :rows [["1"]]}` **or** maps `{:columns [{:key :label :align :render}] :rows [{…}] :row-key :on-row :sort {:col :dir :on-sort}}` |
| `dialog` | `{:id :title :open}`; `data-dialog`, `aria-modal`, open/close via data-attrs (no round trip) |
| `drawer` | `{:id :label :open :side :on-close}` scrim+panel; `:on-close` gives ✕/scrim/Esc |
| `toast` | `{:tone :message :action {:label :on-click}}` `aria-live=polite` |
| `empty-state` `error-state` | `{:icon :title :body :action}` — the reachable non-happy states |

**`loom.desktop` extras:** `dropdown {:open? :on-click :trigger :align :width :gap :style} & panel`,
`menu-item on-click label`.

### 2.6 Forms (`loom.form`)

`(form-for schema {:on-submit :values :errors :only :edit? :submit :submit-attrs :attrs :sections
:hints})` derives a `<form>` (a `box {:as :form}`) from a *schema value*, accepted in three shapes
(`as-attrs`): a datom attribute vector `[{:db/ident :person/name :db/valueType :db.type/string
:db/cardinality :db.cardinality/one :db/doc "…"}]`; a `defrecord` type/instance (kinds inferred from
values, refined by `:hints {field {:form/label :form/enum :db/valueType}}`); or `{:fields […]}`.
Field kind comes from `:db/valueType`; labels are humanised idents; `:form/section` groups; identity
attrs read-only with `:edit?`. `(effective-values schema values)` returns what the screen *shows*
(a select's first option counts as selected) — "the submit must carry THIS, not the raw locals".
Errors flow through `ui/field`, so they're aria-wired for free. OBSERVED output: `(form-for [name age]
{…})` → `[:form {…} field field submit-row]` (3 children).

### 2.7 Transforms (`loom.transform`) — the view is data

`retheme swaps tree` (postwalk value swap), `retarget-events f tree` (`f key term` for every `:on-*`),
`expand-aliases {tag (fn [attrs children])} tree` (custom tags as data rules), `(find-nodes pred
tree)`, `audit-missing-labels tree` (a11y linter as a query), `map-text f tree` (i18n/redaction);
helpers `element? tag-of attrs-of`. Built on `rewrite/postwalk` + specter. All OBSERVED running (§5).

### 2.8 Events and live updates

**Event vocabulary** (closed; `live/socket.bl` `event-heads`): `[:assign path source]` (this
socket's locals; path = key or key-vector; source = literal or `[:from :value]`), `[:intent op
payload]` (the only writes; the app maps `op → performer`, authorised by `live.app`),
`[:navigate "url"]` (target is **data/URL string, never keyword**: an atom-table-DoS and
`String.split(:atom)` crash were fixed — documented in `normalize-event`), or a *vector of terms*
(optimistic UI). `validate-event` throws `live: illegal event term …` for anything else at expansion
time. `normalize-event` is the single wire boundary (JSON strings → keywords). Payload may read live
local state with `[:live/local key-or-path]` to dodge keystroke races.

**Rendering of events:** `live.hiccup` strips `:on-EVENT` attrs and emits `data-ev-EVENT='<json>'`;
`:key` is stripped (diff-only). Observed: `[:button {:on-click [:intent :save {:id 7}]} "Save"]` →
`<button data-ev-click='["intent","save",{"id":7}]'>Save</button>`. Tag shorthand `:div#id.a.b` is
split at render. Special keys: `:on-keydown.enter` (composer gesture — fires with the field value and
clears it), `:on-keydown.escape` (used by `drawer`).

**Web back-end:** first paint = server HTML (`hiccup->html`); after connect, `live.diff` computes keyed
patch ops against the *value*: `[:set-attr path k v] [:remove-attr path k] [:text path s] [:replace path
subtree] [:insert path key subtree] [:remove path key] [:move path key idx]`, path = child-index vector
from root. Property pinned by tests: `(apply-ops (diff a b) a) == b`. `live.app` wraps it into an app
**value**: `{:home :routes [[pattern screen-fn]…] :principal :worlds :observe :intents :theme :assets}`
(route table with `:seg` params; guarded "worlds"; intents the only writes).

**Desktop back-end** (`loom.desktop`, OBSERVED): same loop, different transport.

```clojure
(d/app {:title "Counter" :width 360 :height 220
        :state 0
        :view     (fn [n] (ui/button {:on-click [:inc]} (str "count: " n)))
        :on-event (fn [n ev] (if (= (first ev) :inc) (+ n 1) n))
        :tick     {:every-ms 1000 :event [:tick]}})      ; optional
```

`view` pure `state → hiccup`; `on-event` pure `(state event) → state`; `mount` renders frame 0
*before* opening the window, spawns **one driver process owning the state**, `receive`s
`[:event ev] / [:tick ev] / :stop`; if `new-state != state` it re-renders and does two `wry/eval`s
(`__loom_style(css)` then `__loom_swap(html)`). The client hook (≈60 lines JS injected at mount)
delegates `click/input/change/keydown(Enter)` on `data-ev-*` → `bl.send(JSON)`; `input`/`change` events
become `[term value]`. **It swaps `#loom-root.innerHTML` wholesale** (no keyed diff yet; the code says
"Keyed diffing would avoid the swap … until a second consumer needs the diff") and saves/restores the
focused element's id+selection so a render mid-keystroke doesn't move the caret. Reserved event
`["__loom-height", h]` = auto-height surface resize. Parse: `parse-event` JSON → `keywordize-head`.

### 2.9 How to launch a desktop window (OBSERVED code; not launched here)

```clojure
(ns my.app (:require [loom.desktop :as d] [loom.ui :as ui] [loom.box :as b]))
(def app (d/app {:title "Hello" :width 720 :height 480 :state {:n 0}
                 :view (fn [s] (b/col {:pad :6} (ui/button {:on-click [:inc]} (str (:n s)))))
                 :on-event (fn [s ev] (if (= ev [:inc]) (update s :n inc) s))}))
(d/emit app [:inc])   ; drive from beam-lisp itself (same reducer path)
(d/stop app)          ; :stop to driver + wry/close
```

Run an example: `bl run examples/desktop/hello-app.bl` (needs the native backend and a display).
Spec keys of `d/mount`: `:state :view :on-event :title :width :height :decorations :always-on-top
:resizable :x :y :layer :anchor :exclusive :transparent :tick`. Presets: `d/app` (720×480, decorated,
resizable) and `d/bar` — frameless wlr-layer-shell strip (`:layer :top`, `:anchor [:top :left :right]`,
`:exclusive` pinned to bar height, `:transparent true`, `:height 34`) so a dropdown *overlays* tiled
windows rather than shoving them (auto-height grows the surface, reserved zone stays fixed).
`(d/available?)` ≡ `(wry/available?)` ≡ `(vm.native/available? "wry")` — a missing GUI toolchain reads
as ABSENT, never crashes at require time. On this host `wry/available?` returned `true` with
`WAYLAND_DISPLAY=wayland-1` (OBSERVED, `bl run`).

**wry surface** (`priv/lib/wry.bl`): `(wry/open {:title :html|:url :width :height :on-message :decorations
:always-on-top :resizable :x :y :layer :anchor :exclusive :transparent})` → `Window{handle receiver}`;
`(wry/eval w js)`; `(wry/resize w width height)`; `(wry/close w)`. Four NIFs declared by
`(defnative "wry_webview" (webview-open 15) (webview-eval 2) (webview-resize 3) (webview-close 1))`.
Rust: one OS thread per window running `tao` loop (`with_any_thread(true)`), `EventLoopProxy` handed
back; IPC `bl.send(x)` → `window.ipc.postMessage` → `OwnedEnv.send_and_clear` of `{:wry-ipc body}` to a
receiver process that calls `:on-message`. Scope note in source: *one window per `open`*; concurrent
windows are "a real next step" (GTK global init is per-thread) — **not claimed**.

---

## 3. What omega should take / adapt / drop

| item | verdict | reason |
|---|---|---|
| **View = pure fn `state → hiccup`; events = closed data vocabulary** | **TAKE, verbatim** | Matches the task-as-value philosophy; a task's UI is inspectable/replayable/testable without a renderer. It is also the *only* thing making a TUI back-end possible (`tui-ratatui.bl.md`). |
| `[:intent op payload]` / `[:assign …]` / `[:navigate …]` | **TAKE, adapt meaning** | For omega, `:intent` ≈ "message to a task / write a trace to the environment"; `:navigate` ≈ "focus another task"; `:assign` stays UI-local. Same three verbs, omega-specific performer table. |
| `live.app` "app as a value" (routes, principal, worlds, intents) | **ADAPT** | Route table = task directory; "worlds" = guarded views of the stigmergic environment; `:principal` = which task/agent is viewing. Keep the *guarded-reads* idea. |
| token scale + per-process theme | **TAKE the data, ADAPT the lowering** | Tokens as data are renderer-agnostic; only `sx` (CSS hashing) is web-specific. Impeccable.style aesthetic = a brand map installed with `install-theme!`. Need a terminal sub-scale (cells, not px). |
| `box` algebra | **TAKE (props), ADAPT (lowering)** | `:dir :gap :pad :align :justify :grow :w :h :grid` are flex-like and map to ratatui `Layout` fairly well; `:at` breakpoints map to terminal columns; `:on :hover` and raw `:style` don't. Decide a portable prop subset (open Q1). |
| `ui`/`parts` vocabulary | **TAKE the names + opts shapes** | button/field/badge/alert/table/tabs/progress/timeline/events/facts/disclosure/dialog/toast/empty-state map to coding-agent needs (tool-call cards, task lists, diffs-as-table). Drop only decoration-only pieces (`skeleton`, `kbd` stays useful). |
| a11y-by-construction (disabled drops handler, labels tied, `role=alert`) | **TAKE** | Cheap, and gives the agent a *semantic* tree to introspect; screen-reader parity in TUI is an open Q. |
| `loom.transform` (retheme / retarget / audit / expand-aliases) | **TAKE** | An agent developing omega can lint and rewrite a view as data. `expand-aliases` is how omega adds `:omega/task-card`. |
| `form-for` from schema | **TAKE** | Typed decisions (Jev) already produce schemas — a Jev decision schema → a form for human override is natural. |
| Seven-part "closed set" discipline + five hierarchy moves | **TAKE as design rules** | "A screen answers one question; every other question gets a link" is exactly the right rule for many concurrent tasks. |
| `sx` atomic-CSS + process-dict sheet + `realize` | **KEEP web-only, ISOLATE** | An impure seam; confine it behind a back-end so TUI/test back-ends never see it. |
| `loom.desktop` wholesale `innerHTML` swap + JS hook | **ADAPT** | Fine for a prototype; omega should reuse `live.diff` ops over `wry/eval` (or `evaluate`-side patcher) so focus/scroll/video survive. Also unify with `live.socket` so web and desktop share one `mount`. |
| Dependence on `datom` for "Shared" state | **DEFER** | The grammar's "world is a log" is attractive for trace/stigmergy, but omega's environment design (other research files) decides it. |
| `d/bar` wlr-layer-shell | **TAKE as optional** | A task-status bar is a plausible omega surface (PLAN-002). Linux/Wayland-only; keep optional. |
| French strings (`"Fermer"`) hard-coded in `drawer` | **DROP/parametrise** | Observed in `parts.bl`; i18n via `map-text` or an option. |

Pitfalls to avoid (observed): installed `bl` bundle may lag the repl worktree — the shipped
`2026.4.0` loom has `parts` **without `disclosure`/`facts`** (`undefined var: loom.parts/disclosure`,
OBSERVED) though the worktree has both. omega should pin the beam-lisp it targets.

---

## 4. beam-lisp mapping

| need | existing | gap |
|---|---|---|
| tree value/diff | `live.hiccup`, `live.diff` (`priv/lib/live/`) | desktop doesn't use diff yet |
| per-viewer process | `live.socket`, `loom.desktop/driver-loop` (`spawn` + `receive`) | no shared supervision of N windows; wry is 1-window/`open` in practice |
| window | `wry` + `native/wry_webview` (Rustler 0.38, `defnative`) | single-window caveat; Linux-only crate (`cfg(target_os="linux")`) |
| native loading policy | `priv/std/vm/native.bl` (`vm.native/declare`, `available?`, host-module naming `BeamLisp.Native.<Camel>`) | — see `tui-ratatui.bl.md` |
| process patterns for actors/tasks | `priv/std/proc.bl` + `proc/{bus,fence,flow,pipeline,queue,reg,sched,server,super,table,tick}.bl` | omega-specific task protocol is new |
| tree transforms | `rewrite`, `specter`, `optics` (`priv/std/`) | — |
| self-catalog | `tooling/catalog.bl`, `docs/explorer.md` (`^:catalog` defns → datalog) | reusable for an omega component explorer |
| a11y/query | `transform/find-nodes` | no TUI-level a11y story |

## 5. Runnable: build a loom tree as a value and print it

Loads fine under `bl run` from the omega dir (OBSERVED; first-run ≈12 s on this host — the loom
namespaces compile on first require). Classes are content hashes, so output is deterministic.

```beam-lisp
(ns omega.research.loom-tour
  (:require [loom.box :as b] [loom.ui :as ui] [loom.token :as t]
            [loom.parts :as p] [loom.form :as f] [loom.transform :as tr]
            [live.hiccup :as h]))

(defn view [tasks]
  (b/col {:gap :4 :pad :5}
    (ui/heading 1 "Tasks")
    (b/row {:gap :2}
      (ui/button {:variant :primary :on-click [:intent :task/new {}]} "New task")
      (ui/badge {:tone :accent} (str (count tasks) " open")))
    (p/table {:columns ["Task" "State"] :rows tasks})))

(def tree (view [["fix parser" "running"] ["write docs" "waiting"]]))
(println "root:" (first tree) (keys (second tree)))
(println "children:" (map first (drop 2 tree)))
(println "full tree:" (pr-str tree))

;; the event is DATA living in the tree, not a closure
(assert (= [:intent :task/new {}] (get (second (nth (nth tree 3) 2)) :on-click)))

;; the web back-end turns that same data into a marker
(def html (h/hiccup->html [:button {:on-click [:intent :task/new {:id 7}]} "New"]))
(println html)
(assert (.contains html "data-ev-click"))

;; tokens: scale-or-raw, typos fail loud
(println "tokens:" (t/space :4) (t/len 13) (t/len "1.5rem") (t/color :accent))
(println "typo:" (try (t/space :99) (catch e :threw)))
(println "box-css:" (pr-str (b/box-css {:dir :row :gap :3 :pad [:2 :4] :align :center})))

;; with-sheet: tree + collected CSS from one render
(def r (t/with-sheet (fn [] (view [["a" "b"]]))))
(println "with-sheet keys:" (keys r))

;; form-for derives a form from a schema value
(def form (f/form-for [{:db/ident :person/name :db/valueType :db.type/string
                        :db/cardinality :db.cardinality/one}
                       {:db/ident :person/age :db/valueType :db.type/long
                        :db/cardinality :db.cardinality/one}]
                      {:on-submit [:intent :person/save] :errors {:person/name "required"}}))
(println "form:" (first form) "children:" (- (count form) 2))

;; the tree is data ⇒ query/rewrite it
(println "unlabelled inputs:"
         (count (tr/audit-missing-labels
                  [:div [:input {:name "x"}] (ui/field {:name :email :label "Email"})])))
(println "retarget:" (pr-str (tr/retarget-events (fn [k ev] [:audit ev]) [:button {:on-click [:go]} "x"])))
(println "map-text:" (pr-str (tr/map-text String/upcase [:p "hi"])))
```

Observed output (abridged): `root: :div (:class)`, `children: (:h1 :div :table)`,
`<button data-ev-click='["intent","task/new",{"id":7}]'>New</button>`,
`tokens: 16px 13px 1.5rem #5b8def`, `typo: :threw`,
`box-css: {:display "flex", :padding "8px 16px", :gap "12px", :align-items "center", :flex-direction "row"}`,
`form: :form children: 3`, `unlabelled inputs: 1`,
`retarget: [:button {:on-click [:audit [:go]]} "x"]`, `map-text: [:p "HI"]`.

A **TUI back-end can read the very same `tree`**, but note the box's `:class` hashes already erased
`:gap :4 :pad :5` into CSS (see §6/§7 and `tui-ratatui.bl.md`): a terminal renderer must either run *before*
`box`/`sx` lowering (consuming the box props) or parse the sheet. That is the core design tension.

---

## 6. Interactions and observability

How a human or an agent can peek at / drive loom today (OBSERVED unless noted):

- **REPL / `bl run`:** every component is a pure fn → call it, `pr-str` the result. Zero setup. §5.
- **Static HTML:** `(h/hiccup->html tree)`; the CSS via `(t/with-sheet …)` → `(:style r)`.
- **Live web:** `bl serve examples/loom/ui-gallery.bl` (port 4049) renders each `^:catalog` defn live.
- **Explorer/catalog** (`docs/explorer.md`, PLAN-061): reads library+examples into a datom db and answers
  *which public fns have no example*, coverage, co-occurrence, escape-hatch use, a11y/unkeyed-list lint,
  as a live datalog-driven loom page (BL_CATALOG_LIB / BL_CATALOG_DIR knobs). An agent can query this to
  see what UI vocabulary exists and what's undemonstrated.
- **Desktop:** `bl run examples/desktop/hello-app.bl`; `(d/emit app ev)` drives the reducer from the REPL;
  state lives in one process so `:sys`-style inspection (`sys/get_state`-like) of the driver is plausible
  (INFER; the driver is a bare `spawn`+`receive`, not a gen_server, so no `sys` support without change).
- **Tests:** `bl test test/bl/loom/ui_test.bl` — a11y guarantees + no-ceiling contract per component;
  `test/bl/live/diff_test` pins `apply-ops ∘ diff = id`. A headless desktop smoke asserts via `wry/eval` round
  trip (FEAT-032 acceptance).
- **Screenshot-driven review:** PLAN-059 waves require screenshot-reviewed galleries (an agent-with-eyes loop).
- **Gap:** no first-class "give me the current *tree* of window X" for desktop; `render-frame` is private.
  Omega should expose `(snapshot app) → {:state :tree :css}` — trivially cheap since all three are in hand.

---

## 7. Open questions for the user

1. **One tree, two lowerings — where does lowering happen?** (a) Keep loom as-is: components emit
   hiccup with CSS classes baked by `box`; TUI parses/ignores them (lossy, brittle). (b) Make `box` etc.
   emit a *semantic* intermediate (`[:box {:dir :row :gap 3} …]`, tokens unresolved), with web and TUI each
   lowering it (clean; needs refactoring `loom.box`/`ui` or an omega-owned layer atop). (c) Fork: omega gets
   its own `omega.ui` with the same API that returns the semantic form. Tradeoff: (b)/(c) is what makes `tui-ratatui.bl.md`
   tractable; (a) is free now but cannot be a real TUI. Preference?
2. **Do omega's task views live on the `live.*` socket model (per-viewer process + diff) or the simpler
   `loom.desktop` `view/on-event` reducer?** The reducer is far simpler and fits "task = process"; `live.app`
   adds routes/principals/worlds/intents. Option: adopt `desktop`'s contract as the canonical one and make
   `live` a transport of it.
3. **Mapping of the three event verbs to stigmergy.** Is `:intent` a message to *another task* (`proc` send),
   a trace written to the shared environment, or both? Is `:navigate` "focus task X"? Does `:assign` stay
   strictly UI-local? Decide before building any view.
4. **State homes:** loom has Shared/Session/Local. omega has task-local, shared-environment (traces), and UI. Is
   the environment a datom log (time-travel for free) or `proc/table`/`reg` (cheaper, no history)?
5. **Reconcile on desktop:** keep wholesale `innerHTML` swap (simple, loses scroll/selection except caret
   hack) or implement the `live.diff` patch protocol over `wry/eval` (needs a client-side apply in the hook)?
   An agent chat transcript with long scrollback strongly favours diffing.
6. **Which beam-lisp is the baseline?** The shipped `bl 2026.4.0` bundle lacks `disclosure`/`facts` that the repl
   worktree has. Pin to the worktree build, or vendor `loom` into omega?
7. **Multiple windows / concurrency:** wry is one-window-per-`open` by the crate's own admission. Is omega one
   window with internal panes (tasks as tabs/panels — works today) or many OS windows (needs crate work)?
8. **Theming/aesthetic:** install impeccable.style as a `brand` map via `install-theme!` (web) — and does the TUI
   consume the same brand (colours via truecolor; spacing quantised to cells)? Define the cell-quantisation rule.
9. **Accessibility target for TUI:** the web side gets ARIA free; what is the TUI equivalent (focus order +
   a semantic dump an agent/screen reader can read)? Cheap option: keep the semantic tree inspectable.
10. **i18n/branding leakage** (French labels baked into `drawer`/`parts`): parametrise via `map-text` or props?
