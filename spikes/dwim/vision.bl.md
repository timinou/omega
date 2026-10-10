# DWIM: the relationship between attention and the presented document (vision)

> **Design / vision note, 2026-10-05.** Captures the complete interaction vision agreed with the
> user, ahead of the targeted first slice documented in [`dwim.bl.md`](dwim.bl.md). Plan:
> [PLAN-006](../../!tasks/plans/PLAN-006-dwim-visible-navigation-source-grounded.org) (DONE). Feature:
> [FEAT-022](../../!tasks/features/FEAT-022-dwim-package-visible-outline-navigation.org).
> Contracts it rests on: [`research/domain/interface/packages.bl.md`](../../research/domain/interface/packages.bl.md)
> (packages and frames), [`frames.bl.md`](../../research/domain/interface/frames.bl.md).
>
> **Status: first-slice foundation implemented; broader vision deferred.** The verified navigation
> package, shared visibility/reveal seam and proof are documented in [`dwim.bl.md`](dwim.bl.md).
> The seven leverage features below are a roadmap, not a claim that their full behavior is built.
> In particular, exact wrapped-line motion, contextual selection, search arrival, temporary reveal,
> peek, attention history, action menus and resolved-target explanations remain future scope.

## 1. The question

Today, folding state affects **drawing** but not **movement**. `j`/`k` step through source rows
(`ed.motion/up`, `ed.motion/down`), while `ed.main/visible-rows` filters folded section bodies only
when rendering. Motion and drawing hold different notions of adjacency, so the cursor spends
keystrokes inside things the user cannot see.

DWIM (Do What I Mean) is the layer that owns **the relationship between attention and the presented
document**. Its question:

> “Given what I am looking at, what does this interaction mean?”

The decisive boundary:

> **DWIM resolves the target; the package that owns the target supplies its meaning.**

DWIM must not become a bag of omega-specific shortcuts. Generic topology lives in bl-ed; domain
meaning lives in the package that owns the object.

## 2. The one shared notion: “the thing here”

Once navigation can identify a visible thing, its source span, its parent and its displayed
location, a whole family of interactions becomes variations of one operation:

```text
locate → move          (j/k, page, home/end, add-cursor-below, counts)
locate → select        (contextual selection, grow/shrink)
locate → reveal        (search arrival, diagnostics, outline jumps, visits)
locate → inspect       (peek, detail override)
locate → offer actions (contextual action menu, keyboard and pointer)
```

That is the vision: **one shared notion of “the thing here,”** reused by rendering and movement
alike. The seven features in §4 are seven expressions of this affordance, not seven independent
features.

## 3. Architecture (A–D)

The implementation is maximalist in leverage and minimal in machinery: a generic affordance in
bl-ed, a removable policy package, domain contributions from omega, and all behaviour as plain BL
data.

### A. bl-ed: one shared visibility model

Extract the existing fold-visibility logic into a small **generic affordance used by both rendering
and navigation**. For ordinary documents it answers:

```text
visible predecessor / successor
containing heading / parent
collapsed? / expandable?
```

It reuses the existing outline and section spans (`ed.org/structure` over `bl.doc.spans`) — **no
second parser, no independent fold interpretation.**

For presented documents, navigation consumes the **existing presentation projection** instead
(`pp.present/screen-of`: slots, frames, sticky rows, `slot-row` source mappings, index).

Crucial distinction:

> Share the document **projection** — not the viewport's rendered `:lines`.

`render`'s `:lines` is clipped viewport output and contains fixed decorations (sticky headings,
docked composer). Deriving navigation from it would make movement stop at screen edges or wander
into duplicated sticky headings.

### B. DWIM package: policy, not another editor

The interaction ships as a removable bl-ed package (plain `bl-package` map of data and functions, per
`packages.bl.md`):

```clojure
(def bl-package
  {:name "dwim"
   :doc  "Navigate the visible document."
   :commands {...}
   :keys {:normal {"j" :dwim/down "k" :dwim/up
                   "h" :dwim/left "l" :dwim/right}
          :select {...}}})
```

Command names are **proposed, not existing APIs.**

The commands:

1. Resolve the active navigation topology (fold visibility for plain documents; the presentation
   projection for presented ones).
2. Compute the destination or the contextual fold action.
3. Update selections through existing `ed.core` primitives.
4. Reveal the destination in that topology's coordinates.

**Use command bindings, not a raw-key interceptor.** That preserves counts, key descriptions,
prefixes and user remapping, and lets existing composer interception keep owning typed text.

Package rules stay intact:

- Layers, never mutation of `:user-keys` / `:user-commands` — the editor consults loaded packages.
- Remembered goal column / display focus lives under `(:pkg-state ed)` keyed by `"dwim"`.
- Unloading removes the policy and package state — **not** the user's intervening edits or
  navigation.
- Ordinary text editing stays ordinary text editing.

### C. Present / omega: contribute meaning

The present package supplies navigation derived from `screen-of`. Omega supplies domain meaning:

```text
outline → visible rows and section hierarchy
rail    → task objects
thread  → presented conversation structure
```

The rail's existing `j/k` task-to-task exception (`pp.main/rail-keys` → `next-task` /
`prev-task`) becomes an instance of the same navigation contract rather than a permanent special
case.

**No task/thread knowledge enters generic `ed.*`.** Changing the rail selection still activates the
existing frame link (`ed.frame` route to the focused pane, react to object-selection change);
navigation does not directly manipulate another pane.

### D. Beam-Lisp-maximalist: behaviour is inspectable data

All policy and movement live in plain BL maps/functions:

```text
(editor, navigation intent) → editor′ + effects
```

Same source executable on the BEAM and compiled for the browser. **No** JS navigation algorithm,
**no** DOM traversal, **no** server round-trip per keystroke, **no** build-dependent macro machinery
(`bl js build` drops user `defmacro`s, so map literals are canonical — `packages.bl.md` §9). The
browser paints and delivers events; **Lisp owns what movement means.**

## 4. The seven leverage features

### 4.1 Every movement respects the picture

Beyond `hjkl`:

- Page up/down moves through **displayed** content, not an arbitrary number of source lines.
- First/last goes to the first/last navigable target, not an invisible document trailer.
- Screen top/middle/bottom targets exclude sticky duplicates and decorations.
- “Add cursor below” adds it at the **next visible editable line**, never inside a folded section.
- Counts mean repeated **visible** steps: `5j` crosses five visible targets.

*Marginal cost:* low once topology and reveal exist. Exact wrapped-line movement still requires the
column mapping discussed in §5.

*Why it matters:* less spectacular than the others, but the editor stops contradicting itself.

### 4.2 “Select this” understands what *this* is

On a heading, select its section; on a Lisp form, select the form; on a code cell, select its code;
on a task card, select the task’s represented source span. The editor already has form, section and
cell selection commands — DWIM dispatches to them rather than introducing another implementation.

A distinct **grow-selection** walks containment:

```text
word → form → cell → section → document   (illustrative)
```

The actual chain follows **containment**, not a hard-coded sequence. **Shrink** walks back through
selection history.

- *Cheap:* contextual selection reusing existing commands.
- *New work:* a consistent containment adapter and reversible growth history.

**Safety:** a selected folded section includes its hidden source. The UI must communicate that;
“looks small” must not mean “deletes little.”

### 4.3 Search lands somewhere you can actually see

Today search finds source positions. DWIM could own **arrival**:

```text
search finds hidden match
  → reveal the containing path
  → place the match comfortably in view
```

Not “unfold everything” — open only what is necessary. The delightful version is **temporary
reveal**: search inside a collapsed section, inspect the match, leave, and your deliberately folded
outline remains folded. That needs a separate, package-owned reveal overlay consumed by the shared
projection, **not** destructive rewriting of the user's fold choices.

The same arrival operation serves diagnostics, outline jumps and visits — one fix improves every
route into a document.

- *Cheap:* projection-aware arrival.
- *Not free:* temporary reveal and its lifetime rules.

### 4.4 Peek without losing your place

A collapsed section, summarized result or task reference gets a **peek**:

```text
peek → show enough detail
back → restore the previous reading position and presentation
```

Borrowing detail rather than changing the workspace. Within one document the presentation already
has detail levels; an explicit detail override is the missing policy. Cross-document peeking
additionally needs visit/effect coordination.

**No second page or private viewer.** Same editor, same presentations, same frame.

- *Cheap:* a per-object detail override reusing `lod-of`.
- *Not free:* peek lifetime/pop rules and cross-document visit coordination.

### 4.5 Back follows attention, not just document visits

Jump from an outline heading to a cell, search elsewhere, inspect a task. “Back” should retrace
**meaningful jumps** — not every `j`.

```text
location = document + object identity + source fallback + view anchor
```

Groundwork exists: `ed.docs` has document-back behaviour and preserves provider-object identity
across refreshes. DWIM can extend it into a small **attention trail**:

- Record deliberate jumps.
- Do not record ordinary stepping.
- Prefer stable object identity after updates.
- Fall back to source position when necessary.

This matters in omega because the document changes while you read: “your place” should mean *this
task/turn*, not row 83. Provider objects already have identity; **stable identities for every
syntax-derived object are not yet guaranteed** — hence the source-position fallback and a view
anchor.

### 4.6 Keyboard and pointer acquire the same vocabulary

A card under the mouse and a card reached with `j` should be the same target. That buys click to
focus, keyboard to navigate, a contextual action menu, and consistent help for the focused object —
presentations become actionable objects, not decorative text (a Genera-like payoff).

DWIM asks the target's owning package for available actions:

```text
task   → inspect, open, reply
cell   → inspect source, evaluate
result → expand, inspect
```

Proposed contributions. Existing type-specific bindings and frame links provide groundwork.

**Default activation stays conservative:** opening or expanding is reasonable; evaluating code or
changing task state must stay explicit. “DWIM” is not permission to surprise the user with side
effects.

- *Cheap:* reuse the resolved target for pointer focus and existing per-type bindings.
- *New work:* the action-menu contribution surface and owner-supplied action tables.

### 4.7 Navigation can explain itself

Because resolution is data, “What would this key do here?” can answer:

```text
j → next visible heading: B
    27 source rows skipped inside folded A

l → expand section A
```

The existing describe-key mechanism identifies commands; a resolver adds the **resolved target and
reason**. Low marginal cost, unusually good DX: users, drive tests and agents diagnose behaviour
without reverse-engineering the screen.

## 5. Cheap reuse vs new work

| capability | status | note |
|---|---|---|
| Movement through visible rows (`j`/`k`) | **cheap** | reuse existing fold visibility + section spans |
| Contextual selection (heading/form/cell/card) | **cheap** | dispatch to existing selection commands |
| Projection-aware arrival / reveal | **cheap** | reuse `screen-of` source mappings |
| Contextual `h`/`l` on headings | **cheap** | reuse existing fold-toggle + heading spans |
| Contextual action menu wiring | moderate | needs owner-supplied action tables |
| Screen/page/home/end/count motions | moderate | fall out of topology; wrapped-line precision does not |
| Grow/shrink via **containment history** | **new work** | containment adapters + reversible history |
| **Exact wrapped-column mapping** | **new work / absent** | synthetic presentation slots often carry only a source *row*; exact displayed-line walking is not available today |
| **Temporary reveal overlay + lifetime** | **new work** | must preserve deliberate folds; own lifecycle |
| **Peek lifecycle** | **new work** | detail borrow/pop rules; cross-document coordination |
| **Attention trail** | moderate | extend `ed.docs` back; stable identities not universal |
| **Stable identity for every syntax node** | **not guaranteed** | source fallback + view anchor required |

Exact wrapped-line movement is explicitly **not** in the first slice. Current synthetic slots often
identify only their source row, so a documented gap, not an assumed capability.

## 6. Boundaries

The split the user agreed to:

```text
DWIM owns:
  contextual targeting
  navigation and selection policy
  arrival / reveal
  temporary attention state
  interaction explanations

bl-ed owns:
  source text, selections, edits, history
  generic visibility / projection affordances

present owns:
  layout, wrapping, detail levels
  screen ↔ source mappings

omega owns:
  task / thread identity
  domain actions

host owns:
  events, painting, effects
```

DWIM does **not** own search matching, parsers, rendering, task workflows or edit semantics. It
coordinates existing capabilities.

Adherence to the package contract (`packages.bl.md`, `AGENTS.md`):

- **No user table mutation.** Never write into `:user-commands` / `:user-keys`; contributions are
  consulted as layers.
- **State per name.** Everything DWIM remembers lives under `(:pkg-state ed)` keyed `"dwim"`.
- **Exact unload.** `:(ed/unuse "dwim")` removes the policy and the package state — never the user's
  intervening edits or navigation.
- **Screens are layouts.** Any frame integration goes through a `:provides {:layouts …}` value for
  `ed/frame.bl`, never a page of DWIM's own.

**Do not build a universal interaction framework up front.** Extend the target contract only when a
second real consumer needs the field.

## 7. The showcase

Imagine this sequence:

1. `j` moves through a folded outline as drawn.
2. `l` opens a section.
3. “Select this” selects its cell.
4. Search reaches a hidden match through temporary reveal.
5. Back restores your reading position.
6. In the inbox, the same navigation vocabulary moves task-to-task; existing frame links show the
   selected task.
7. Context help offers that task's actions.

The surprise is not seven independent features; it is seven expressions of one affordance.

## 8. Safety and intended scope

- **Selections remain source spans.** Selecting across a folded section can still include hidden
  text. DWIM movement must never silently redefine deletion/edit semantics, and the UI must
  communicate when a selection includes hidden source.
- **Dangerous side effects stay explicit.** Evaluating code or changing task state is never a
  default DWIM activation.
- **Roadmap, not shipped scope.** Only the foundation in [`dwim.bl.md`](dwim.bl.md) is
  implemented. Each additional interaction needs its own contract and verification.

## 9. Proof

The first slice's executed commands, real-editor screenshots and results are recorded in
[`dwim.bl.md`](dwim.bl.md) → *Proof and reproduction*. Future-vision features are not yet
implemented or verified; they acquire proof obligations when they enter scope.
