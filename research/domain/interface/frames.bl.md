# Frames: several panes in one bl-ed window

*Design + decisions, 2026-10-04. Built: `vendor/bl-ed/ed/frame.bl`, the frame host in
`vendor/bl-ed/web/host.mjs`, `vendor/bl-ed/test/frame.test.mjs`. First layout: `inbox` in
`spikes/present/pp/inbox.bl`. Package contract: [`packages.bl.md`](packages.bl.md).*

## 1. What it is

A **frame** is one window holding several **panes**, wired together: a Genera program frame
(Zmail's summary pane drives its message pane), or an Emacs window configuration whose windows
know about each other. A **layout** describes the frame as a plain value. Packages provide
layouts, and `:(ed/layout "inbox")` brings one to life.

```clojure
(def inbox
  {:name  "inbox"
   :doc   "Tasks on the left; the one you are on, as a conversation; its minimap."
   :panes [{:id :rail :doc "omega:overview"   :width [:ch 38]}   ; an EDITOR pane
           {:id :main :doc :linked            :width :fill}      ; filled by a link
           {:id :map  :view [:minimap :main]  :width [:ch 24]}]  ; a VIEW pane
   :links [{:from :rail :on :select :to :main :do :visit}]
   :focus :rail})
```

| key | values | meaning |
|---|---|---|
| `:panes` | vector, left → right | layout order (v1: one row of columns) |
| `:id` | keyword | how links, focus and effects name the pane |
| `:doc` | path · `:linked` | an editor pane's first document; `:linked` = a link fills it |
| `:view` | `[kind pane-id]` | a VIEW of another pane, drawn by `(:provides {:views {kind fn}})` |
| `:width` | `[:ch n]` · `:fill` · `[:fr n]` | cells · the rest · a share of the rest |
| `:links` | `{:from :on :to :do}` | v1: `:on :select` + `:do :visit` |
| `:focus` | pane id | where keys go first |

Using it: `?use=present&layout=inbox`, or `:(ed/use "present")` then `:(ed/layout "inbox")`.
`:(ed/layout nil)` / `space w o` returns to one pane. `space w w` / `space w l` / `space w h` move focus.
`:(ed/layouts)` lists what the loaded packages provide.

## 2. Two kinds of pane, and only two

- **Editor pane:** a whole bl-ed editor (`ed`): document, cursor, history, keys, presentation.
  Everything bl-ed does in one pane, it does in each.
- **View pane:** no document, no cursor, no keys. A pure function of another pane, recomputed on
  every draw (`[:minimap :main]` → `((:views provides) :minimap) (editor :main)`). It can SEND
  events to the pane it views: dragging the minimap sends `{:type :scroll-to-slot :pane :main :y n}`.
  It is never focused.

Why a view and not an editor for the minimap (decision F1): a minimap has nothing to edit and
nothing to remember. As an editor it would need a document to show, a presentation that draws
someone else's document, and focus rules to skip it. As a view it is one function (`minimap`),
one painter (`viewPainters.minimap`), and one event.

## 3. The frame value and its rules

```clojure
frame = {:layout  layout
         :editors {id ed}      ; editor panes only
         :focus   id
         :effects [effect]}    ; every pane's effects, tagged {:pane id}
```

1. **Keys go to the focused editor.** `space w` is the frame's prefix (normal/select mode); only `w h l o` after it are taken, `space w (` etc. stay the editor's.
2. **An event tagged `{:pane id}` goes to that pane.** That covers a host answer to a pane's effect,
   a view acting on its pane, a wheel over a pane, and a late answer for a pane that no longer
   exists (dropped).
3. **Links only emit effects** (decision F2). After an event changes pane P, the frame compares the
   object under P's cursor before and after. If it changed, each `{:from P :on :select}` link emits
   `{:kind :visit :pane to :path (link-path obj)}`. A link never edits another pane's state. Every
   interaction is data: testable headless, replayable, visible in the effect log. `link-path`
   asks the package that owns the object's type: `(:provides {:links {"omega/task" f}})`.
4. **Packages are frame-wide** (decision F4). Using or removing a package in one pane does the same
   in every editor pane (`pkg/use` / `pkg/unuse` per pane, so each stays exact). Removing the
   package that provided the active layout returns to one pane, so nothing it drew is left.
5. **One pane is today's bl-ed.** `(frame/single ed)` renders exactly `ed.main/render` (pinned by a
   test), and the host draws one pane into the original `#editor` with the original ids.
6. **Arranging keeps your editor.** `arrange` puts the focused editor (document, cursor, history)
   into the layout's pane with the same `:doc`, or else its first `:linked` pane. The other editor
   panes start blank, inherit the packages and the user's tables, and fetch their `:doc`.
   `unarrange` keeps the focused editor under its pane id.

## 4. The host

`web/host.mjs` holds a frame instead of an editor.

- `draw` = `syncPanes` (the DOM follows the layout) + `paint(pane)` per editor pane + `paintView`
  per view pane + `chrome` (status, echo, minibuffer, overlay of the focused pane).
- `paint` is the old `draw` body, with every node looked up by class inside the pane
  (`.lines .gutter .page .frames .selections .caret`).
- The original `#editor` element always serves the first editor pane; other editor panes clone its
  skeleton.
- Effects carry `:pane`, and answers come back with it (`toPane`). One rev watch runs per editor
  pane's document. A resize sends `:height` and `{:cols {pane n}}`.
- The URL keeps `?layout=` across visits.

## 5. Decisions

| id | decision | why | alternative left open |
|---|---|---|---|
| F1 | the minimap is a VIEW, not an editor pane | nothing to edit or remember; one fn + one painter + one event | if views need keys later, a view may declare `:keys` for the pane it views |
| F2 | links emit effects; they never edit another pane | interactions are data (tests, replay, logs); the host already performs visits | a direct `:do :scroll` (mirror scroll) can be an event to the target pane, still data |
| F3 | one row of columns in v1 | parity with the mockup first; `{:rows […]}` can nest later without changing v1 | splits below, tabs |
| F4 | packages are frame-wide | unloading stays exact; a document already picks its drawing by `:adopt` | per-pane `:use` if a real need appears |
| F5 | one design language, theme.css only (no `:css` in packages yet) | one look while the shapes settle | `:css` per package, injected and removed with it |
| F6 | the first editor pane reuses the original `#editor` DOM | one pane = byte-identical page; existing CSS and tests keep working | — |
| F8 | the window prefix is `space w` (not `C-w`) | `C-w` closes the tab in Firefox; the leader is the bl-ed way. `space w (` (wrap) still works: only the 3rd key `w h l o` is taken, and only in a multi-pane frame | — |
| F7 | `:owns` on a package: editor keys its `:adopt` sets, removed by `unuse` | `:presentation`/`:modes` would outlive the package (found live, 2026-10-04) | — |

## 6. Verified (2026-10-04)

- `test/frame.test.mjs` (8): one pane ≡ ed.main (key for key); arrange keeps your editor and cursor;
  a `:select` link emits exactly one visit for the right pane and none when leaving objects;
  answers per pane leave the others identical; `space w w` skips views and `space w o` keeps the editor;
  a view draws from its pane; unknown layout / `(ed/layout nil)`; unusing a package spreads and
  ends its layout. Drive tests 41/41 (19 + 11 + 3 + 8).
- Real bl-ed on the live world (read-only; drafts cancelled):
  - `?use=present&layout=inbox` boots three panes (proof/23);
  - `j` in the rail opens the task in `:main`;
  - `space w w`, then `J` in `:main` jumps threads;
  - the minimap's top maps to row 0 and its bottom to the end of the document;
  - `i` drafts in `:main`'s docked composer (proof/24);
  - `:(ed/unuse "present")` returns to one pane, plain org, no frames;
  - `use` + `layout` again rebuilds the panes;
  - `space w o` keeps the conversation pane.
- One pane renders as before: proof/21, compared against the session's first screenshot of `task:t-5`.

## 7. Not done

- `:on :scroll` links (mirror scrolling between editor panes) are designed (F2) but not built; the
  minimap scrolls through its own event.
- Rows of panes, tabs, saved window configurations.
- `space a o` opening the inbox instead of a single overview (a key in the omega package, once
  `ed/omega.bl` is a package: FUP-010).
- Pane resize by dragging the hairline.

## Retaining editors across package layout transitions

A package can emit `{:kind :frame-layout :layout "name" :keep {destination source}
:visits {pane {:path address :goto optional}} :focus pane}`. Names resolve against
installed package layouts. `:origin` as a source means the emitting pane; nil
requests a fresh editor. Unspecified destinations retain the same pane ID when
it exists. Retained editors keep their cursor, source, prompt and package state.
The frame refuses to discard unsaved text or nonempty prompts, or duplicate one
editor into two panes. Discarded clean editors receive `:session-leave` for pure
cleanup effects. Ordinary effects may specify `:pane` explicitly; otherwise the
frame tags them with their emitting editor. This is layout policy, not IO.

A `:keep` source may also be a vector, such as `:aside [:aside :main]`.
The first existing source editor is retained; `:origin` resolves within the vector
as usual. This expresses an initial transition from a two-pane layout and later
transitions within an expanded layout with the same declaration. It never
copies an editor, and all existing draft and uniqueness checks still apply.

Ordinary `:visit` effects may use an ordered vector for `:pane`, for example
`[:aside :main]`. The frame resolves the first existing editor before passing
it to the host. `{:kind :frame-focus :target [:aside :main]}` uses the same
selection; directional focus remains available. Visits refuse to replace an
unsaved file or nonempty prompt in the target editor. Revisiting the same
address while it has a draft is a no-op, retaining the draft. This also applies
to visits emitted by selection links, so browsing cannot silently erase a
conversation draft.
