# Packages and frames: how a bl-ed extension is written

*Design, 2026-10-04. The contract every spike under `spikes/` that touches the editor must follow
(AGENTS.md → "Spikes"). Built so far: `vendor/bl-ed/ed/pkg.bl` (packages, commit c3e0f25), with
the presentation spike as the first package. Designed here, NOT built: frames (§5–§7). Plan: PLAN-004.*

The question this answers: a spike shows an idea. How does it have to be written so the idea
loads into the REAL editor as a module, comes out again exactly, and composes with everything
else, instead of being a page of its own that has to be rewritten later?

## 1. Principles

1. **Everything is a value.** A package, a mode, a presentation, a frame layout: plain BL maps
   of data and functions. No registration side effects, no mutable registries, no classes. You can
   print it, diff it, test it and build it in a REPL.
2. **Layers, never merges.** The editor CONSULTS loaded packages on every lookup (commands, keys,
   events, drawing) and never copies them into its own tables. Unloading = dissoc the layer, so it
   is exact by construction. (Emacs minor modes leak because `define-key` mutates a shared map.
   This design is the fix.)
3. **The editor stays a pure function of events.** A package adds functions of `ed`; it never
   performs IO. It returns effects (`c/effect`) the host performs, like the core does.
4. **Data first, sugar second.** The JS build drops user `defmacro`s (they run only on the BEAM and
   in the page's `:` evaluator; verified 2026-10-04, see §9). So the canonical form of everything
   is a map literal, and any macro must expand to exactly that map.
5. **One implementation.** A spike's page (if it has one) loads the SAME package value through
   `pkg/use` as `?use=` does. A spike that renders through its own private loop is not done.
6. **Generic below, domain above.** `ed.*` and `pp.present`/`pp.frame` know nothing about omega.
   Domain knowledge (tasks, threads, the rail) lives in a domain package.

## 2. The package: syntax

```clojure
(ns my.thing
  (:require [ed.core :as c]))

(def bl-package                     ; the one export a module must have
  {:name     "thing"                ; unique; :(ed/unuse "thing") removes it
   :doc      "One line: what it adds."
   :requires ["present"]            ; packages that must be used first (by name)

   :commands {:thing/hi {:doc "Say hi." :run (fn [ed] (c/message ed "hi"))}}
   :keys     {:normal {"g h" :thing/hi}}         ; or (fn [ed] {...}): keys per document

   ;; hooks, in the order ed.main/handle calls them for one event
   :intercept (fn [ed ev] nil)      ; take the event BEFORE the core (return ed) or pass (nil)
   :on-event  (fn [old new ev] new) ; after the core: react to what it DID (old → new)
   :adopt     (fn [ed] ed)          ; a fresh document arrived (visit, refresh): set it up
   :render    (fn [ed] nil)         ; draw this document (a view model) or pass (nil)

   ;; contributions other packages consume (data, by convention keyed by name)
   :provides {:presentations {"conversation" conversation}
              :modes         {:follow follow}
              :layouts       {"inbox" inbox}}})       ; §5
```

Rules:

- **Export name `bl-package`.** `package` is a reserved word in JS; the compiled export would be
  mangled to `d_package$R` (proof/19 shows that failure). The host accepts `d_bl_package`, or
  `package` from a hand-written ES module.
- **State** a package keeps per editor lives under `(:pkg-state ed)` keyed by its `:name`
  (`unuse` drops it), or on the document (`:presentation`, `:modes`): whatever `:adopt` set,
  re-set on every fresh document.
- **Precedence:** user (`ed/bind`, `ed/defcmd`) > later package > earlier package > core.
- **Names:** commands `:<pkg>/<verb>`; event types the package invents `:<pkg>/<noun>`; CSS
  classes it needs go in `theme.css` under its section (a package cannot ship CSS yet; see §8).

### Optional sugar (only where macros run)

```clojure
(defpackage thing "One line."
  :commands {...} :keys {...})
;; ≡ (def bl-package (merge {:name "thing" :doc "One line."} {:commands {...} :keys {...}}))
```

Use the map form in anything compiled with `bl js build`. Sugar is for the `:` line and the BEAM.

## 3. Modes and presentations (what packages carry)

```clojure
(def follow                                   ; a MODE: a named reaction, toggled per document
  {:name :follow :lighter "⇣ follow"
   :doc "Keep the newest turn in view while you are at the tail."
   :on-event (fn [old new ev] new)})

(def conversation                             ; a PRESENTATION: how a document is drawn
  {:name "conversation"
   :read       read-conv                      ; text → object tree (default pp.read/read-doc)
   :readtable  [...]                          ; syntax → object types
   :table      {:conv/thread present-thread}  ; type → presenter
   :isa        {...} :around []               ; type lineage, advice
   :lod-of     (fn [ed tree] lod)             ; detail per object
   :focus-of   (fn [ed tree] key)             ; what invalidates the layout cache
   :fill? true :sticky-heads? true})
```

A package's `:adopt` picks the presentation and modes for a document (by scheme or path) and
puts them on the editor. Its `:render` calls `pp.present/render`, and its `:on-event` folds the
active modes. That is exactly what `pp.main/bl-package` does today.

## 4. The event contract (what packages may send and receive)

| event | from | meaning |
|---|---|---|
| `{:type :use :package p}` / `{:type :use :package nil :message s}` | host | a module loaded / failed |
| `{:type :scroll-slots :delta n}` | host (wheel) | scroll by SCREEN rows (a presentation answers; the core ignores it) |
| `{:type :scroll-to-slot :y n}` | host (minimap) | put screen row n at the top |
| `{:type :key :key "S-Enter"}` | host | shift-enter (new line in a draft) |

| effect | to | meaning |
|---|---|---|
| `{:kind :load-package :name s}` | host | import `./pkg/<s>.mjs` (or a URL), answer `:use` |
| `{:kind :visit :path p}` · `{:kind :intent …}` | host | as before |

Hosts ignore events and effects they don't know; the core ignores event types it doesn't know.
That is how a package adds its own (`:thing/…`) without touching either.

## 5. Frames: the three-pane screen (DESIGN)

The spike's `pp.frame` showed the shape. This section makes it a first-class part of bl-ed so
the one-screen overview runs IN bl-ed, loaded by a package, not in `frame.html`.

### 5.1 What a frame is

A Genera **program frame** (Zmail: summary pane + message pane): one window, several panes, each
pane a whole editor, plus links that let one pane drive another. In Emacs terms: a window
configuration whose windows are wired together. Today bl-ed's host holds ONE `ed`. With frames, the
host holds ONE frame. A frame of one pane is today's bl-ed, exactly, and that is the equivalence
test for the cutover.

### 5.2 Syntax: a layout is a value

```clojure
(def inbox                                    ; a LAYOUT (a package :provides it)
  {:name  "inbox"
   :doc   "Tasks on the left, the selected one in the middle, its minimap on the right."
   :panes [{:id :rail :doc "omega:overview"   :width [:ch 38]}
           {:id :main :doc :linked            :width :fill}     ; whatever :rail selects
           {:id :map  :view [:minimap :main]  :width [:ch 24]}] ; a VIEW of another pane
   :links [{:from :rail :on :select :to :main :do :visit}       ; selection opens
           {:from :map  :on :scroll :to :main :do :scroll}]     ; minimap scrolls main
   :focus :rail})
```

The vocabulary, deliberately small:

| key | values | meaning |
|---|---|---|
| `:panes` | vector, left → right | order is layout order (v1: one row of columns) |
| `:id` | keyword | how links, focus and effects name the pane |
| `:doc` | path · `:linked` | the document the pane shows at start; `:linked` = filled by a link (not `:follow`, which is a mode) |
| `:view` | `[kind pane-id]` | not an editor: a VIEW computed from another pane (`:minimap`) |
| `:width` | `[:ch n]` · `:fill` · `[:fr n]` | cells, the rest, or a share of the rest |
| `:links` | `{:from :on :to :do}` | when `:from` emits `:on`, do `:do` in `:to` |
| `:on` | `:select` · `:scroll` | the object under the cursor changed · the view scrolled |
| `:do` | `:visit` · `:scroll` | open the link-path of the selected object · mirror the scroll |
| `:focus` | pane id | where keys go at start |

Views are not editors: a minimap has no cursor and no text, so it is a pure function of another
pane (`pp.present/minimap`). Every pane that IS an editor carries the user's and packages' keys as
usual: a package used in a frame is used in every pane (layers, §1.2), and its `:adopt` sets each
pane's document up.

### 5.3 Using a layout

```clojure
:(ed/layout "inbox")      ; arrange the window as the layout says (packages provide layouts)
:(ed/layout nil)          ; back to one pane (the focused one)
?use=omega&layout=inbox   ; at boot
```

Keys (core, always on): `C-w w` next pane · `C-w h` / `C-w l` left/right · `C-w o` only this pane
(Vim's window keys). `space a o` with an `inbox` layout available opens it instead of a single
overview, so the three screens become one.

### 5.4 How it runs: the frame is a pure function too

```clojure
;; ed/frame.bl (new, generic)
frame  = {:panes {id ed} :views {id [kind of]} :layout layout :focus id :effects []}

(frame/handle fr ev)          ; ev with {:pane id} goes to that pane (a host answer to its effect);
                              ; keys go to the focused pane; C-w … moves focus;
                              ; after a pane changes, its links fire (select → visit effect …)
(frame/take-effects fr)       ; every pane's effects, tagged {:pane id}
(frame/render fr)             ; {:panes [{:id :width :focus? :view} …]}, :view = ed.main/render or a view's model
```

- **Link semantics.** After an event changes pane P, compare P's selection before and after (the
  object under the cursor: type + key). If it changed, every `{:from P :on :select}` link runs.
  `:visit` emits `{:kind :visit :pane to :path (link-path obj)}`, so the host fetches into THAT
  pane. A link never touches another pane's state directly; it emits effects/events. Pure, and
  testable as data.
- **`link-path`.** The object knows where it leads: a provider object `{:type "omega/task" :key
  "t-1"}` leads to `task:t-1`. Who maps types to paths? The PACKAGE that owns the type, through
  `:provides {:links {"omega/task" (fn [o] (str "task:" (:key o)))}}`. The frame stays generic.
- **Effects are tagged** `{:pane id}`, and the host's answers carry it back, so a `:visit` lands in
  the pane that asked. Rev watches are per pane (one long-poll per shown document).
- **`:resize`** carries `:height` and `{:cols {pane n}}`. Each pane learns its width (the measure
  a presentation wraps to).

### 5.5 The host

`web/host.mjs` becomes a frame host: `paint(pane)` is today's paint function, called per pane into
its own `#pane-<id>` element. A view kind (`:minimap`) has its own painter. One `sink` takes keys and
dispatches to the frame. The single-pane case (no layout) renders exactly today's DOM: the
equivalence gate for the cutover.

## 6. The frame spike, rewritten in this format

What changes from `spikes/present` round 2 (frame.html + frame.mjs, ~250 lines of host):

```clojure
;; spikes/present/pp/inbox.bl — the WHOLE domain part of the three-pane screen
(ns pp.inbox)

(def inbox
  {:name "inbox"
   :doc "omega's one screen: tasks | the selected task | its minimap."
   :panes [{:id :rail :doc "omega:overview" :width [:ch 38]}
           {:id :main :doc :linked :width :fill}
           {:id :map  :view [:minimap :main] :width [:ch 24]}]
   :links [{:from :rail :on :select :to :main :do :visit}
           {:from :map :on :scroll :to :main :do :scroll}]
   :focus :rail})

;; and in pp.main/bl-package:
;;   :provides {:layouts {"inbox" inbox}
;;              :links   {"omega/task" (fn [o] (str "task:" (:key o)))}
;;              :presentations {...} :modes {...}}
```

- `pp.frame` (generic) moves to `vendor/bl-ed/ed/frame.bl`; its hard-wired `:links {rail pane}` and
  `:link-path` become the layout's `:links` and the package's `:provides :links`.
- `frame.mjs` disappears: `web/host.mjs` is the frame host (§5.5). `frame.html`/`frame.css` go too;
  the minimap painter and pane CSS move into the host and `theme.css`.
- The proof becomes: real bl-ed, `?use=present&layout=inbox`, the same screenshots as proof/15–18,
  plus `:(ed/layout nil)` back to one pane, and `:(ed/unuse "present")` removing the layout.

## 7. Tests that pin the frame contract (to write with it)

1. A frame of one pane ≡ `ed.main`: same view model after the same event script (drive suite run
   through `frame/handle`).
2. `:select` link: `j` in `:rail` over a task row → exactly one `{:kind :visit :pane :main :path "task:t-1"}`.
3. Effects tagged by pane; an answer with `{:pane :main}` changes only `:main`.
4. `C-w w` cycles focus over EDITOR panes only (views are skipped).
5. `(ed/layout nil)` keeps the focused pane's editor (cursor, history) intact.
6. Unusing the package that provided the active layout falls back to one pane.

## 8. Open questions

- **CSS from packages.** Today a package's classes live in `theme.css`. Options: a `:css` string
  the host injects into a `<style data-pkg=name>` (removed on unuse), or roles only (the host
  maps `:role` → classes it already has). Leaning to `:css`: it keeps unload exact.
- **Rows of panes** (a split below): v1 is columns only. A `:panes` entry could be a nested
  `{:rows [...]}` later without breaking the v1 shape.
- **Hot reload of a package** = `use` again by the same name (replaces the layer). Works today for
  commands/keys/hooks; a frame layout in use would need re-layout. Defer.
- **`:requires`** is declared but not enforced yet (`ed/use` should load missing ones first).

## 9. Facts this design rests on (verified 2026-10-04)

- `bl js build` drops user `defmacro`s: a namespace using `(d/defmode …)` or a same-file
  `defmacro` fails with `unresolved name(s)` (tried `/tmp/pp/mac`). The same code runs on the BEAM
  (`bin/bl run`: `[:follow "⇣"]`), and the page's `:` evaluator expands macros (js.eval links at
  run time). ∴ map literals are canonical (§1.4).
- Package layers make `unuse` exact: `vendor/bl-ed/test/pkg.test.mjs` pins it (fails on the
  pre-seam build).
- A package compiled into the page's `out/` shares the page's single `ed.*` instance (siblings
  import by relative path), so a module does not duplicate the editor.
