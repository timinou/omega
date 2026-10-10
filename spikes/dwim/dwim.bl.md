# DWIM package: visible outline navigation

**Implemented first slice, 2026-10-05.** The complete interaction vision is in
[`vision.bl.md`](vision.bl.md); that document deliberately distinguishes the implemented
foundation from future selection, search, peek and action features.

References: [PLAN-006](../../!tasks/plans/PLAN-006-dwim-visible-navigation-source-grounded.org),
[FEAT-022](../../!tasks/features/FEAT-022-dwim-package-visible-outline-navigation.org), and the
[package contract](../../research/domain/interface/packages.bl.md).

## 1. The interaction contract

### Visible vertical movement

`j` and `k` step between distinct visible **source rows**, preserving a remembered goal
column across short lines and direction changes. A closed section contributes its heading,
not its hidden body. Closed ancestors hide their descendants; reopening an ancestor preserves
any deliberately closed children. Document boundaries clamp; movement never wraps.
Normal `h/l` also resolve a hidden head to its visible outline representative before acting.

A cursor already inside hidden source (for example after `Tab` folds its containing section)
is resolved directionally: `k` reaches the preceding visible heading; `j` reaches the first
visible row after the section. Entering an object list from its title reaches its first object,
not its second. Counts repeat these steps against the current topology.

This slice is **not exact wrapped-display-line movement**: multiple wrapped slots belonging
to one source row are one vertical target. Exact source-column mapping remains future work.

### Contextual horizontal movement

In normal mode, on a source heading whose presentation uses source folds:

| Context | `h` | `l` |
|---|---|---|
| Expanded heading | Collapse | Enter first visible contents |
| Collapsed heading | Parent heading, or stay if none | Expand in place |
| Expanded empty section | Collapse | Stay |
| Ordinary text | Previous character | Next character |

The text/default and omega outline presentations support this policy. Conversation and rail
presentations own a different visual structure and explicitly decline source-heading folds:
`h/l` there retain their prior character-motion policy rather than modifying invisible folds.
These are normal-mode interactions; **select-mode `h/l` always extend by characters**.
Arrow-key bindings and insert-mode typing are unchanged.

### Selections, columns and state

All heads use the existing source-position selection representation. Normal movement follows
heads with anchors; select movement preserves anchors. Counts and every selection are handled;
the primary selection is retained. Duplicate heads on one heading resolve against one snapshot,
so one command cannot double-toggle a shared section. If a simultaneous parent collapse hides
another head, that head is placed on its visible representative.

Goal columns are per selection under `[:pkg-state "dwim"]`. A horizontal command, explicit
click (even at an unchanged clamped head), text change, document event or intervening command
invalidates the remembered goal. DWIM does not add goal fields to the editor or selection maps.

**Selection across a folded section still includes hidden source.** Movement does not redefine
copy, delete or change semantics. A small visible section can represent a large selected range.

## 2. One visibility model, not a parallel editor

The old mismatch was:

```text
j/k → ed.motion/up/down → source row ±1
render → independently hide folded rows
```

The implementation keeps raw source motions intact and adds a removable policy over the shared
visibility affordance:

```text
keymap → named DWIM command → ed.view/rows → source selection → ed.view/reveal
plain render → ed.view/visible-rows
present render/navigation → pp.present/screen-of → slots and source mappings
```

[`ed/view.bl`](../../vendor/bl-ed/ed/view.bl) extracts fold visibility from the old private
renderer predicate. An ordered interval walk merges nested/adjacent hidden spans and skips
whole folded bodies; it does not parse a second outline or scan every heading for each row.
`row-index` provides shared logarithmic source-row resolution. A single-entry derived topology
memo is keyed by structure, folds and source-row count, never by cursor or viewport; counted
movement stops once selections and relevant fold state are stationary. Plain reveal measures visible
ranks with the existing three-row margin, rather than numeric source distance. Reveal changes
only the viewport: it does not unfold or rewrite a selection.

Packages can contribute:

```clojure
:provides {:navigation {:rows     (fn [ed] ascending-distinct-source-rows-or-nil)
                        :reveal   (fn [ed] editor-or-nil)
                        :outline? (fn [ed] boolean-or-nil)}}
```

Callbacks are consulted latest-package-first. Nil declines; an empty row vector accepts an
empty topology, and false explicitly disables source-heading interaction. Plain rendering always
uses source visibility, not a package's navigation row list. No contribution is merged into
shared tables.

The present package supplies navigation from its **full projection**, never the clipped viewport
`:lines`. Its row-list memo is keyed by read-tree identity for the rail and layout-slot identity
elsewhere, using the shared `ed.memo/identity-pair` helper. Counted movement therefore reuses
existing read/projection stages. Its rail supplies task-object source rows, so each task remains
one target in either
package load order. DWIM advertises `:provides {:navigation-policy true}`; present then
contributes its topology without competing for `j/k`, so counts and multi-head behavior also
remain independent of load order. With no navigation policy loaded, present's original rail
bindings remain available. Existing frame selection links still emit one visit for the selected task;
DWIM does not manipulate another pane. Conversation supplies distinct presented source rows.
Projection-aware reveal preserves an already-visible wrapped source row, fractional anchors,
sticky/docked visibility and composer input; it brings off-screen targets into slot space.
The viewport must have room for a body slot: this slice does not change the renderer's sizing
policy when fixed headings/composers consume its entire height.
In the omega fisheye presentation, deliberate heading folds now take precedence over automatic
focus detail; otherwise a focused heading could not remain visibly closed.

## 3. Package and source map

- [`dwim/main.bl`](dwim/main.bl): one exported `bl-package`, four commands, normal/select key
  layers and goal-state invalidation. No raw-key interception, renderer, private page, or IO.
- [`build.sh`](build.sh): compiles into the real editor's output and installs its generated
  `vendor/bl-ed/web/pkg/dwim.mjs` loader. Every package shares the page's runtime and editor.
- [`dwim/selftest.bl`](dwim/selftest.bl): the same ten pure checks on the BEAM and JS.
- [`test/drive.test.mjs`](test/drive.test.mjs): event-driven contract and integration tests.
- [`test/outline.bl.org`](test/outline.bl.org): reproducible real-editor proof fixture.

All behavior is plain BL maps/functions. There are no JS navigation algorithms, DOM traversal,
server round trips per key, or user `defmacro` requirements. Generic vendored changes are recorded
in [`VENDOR.md`](../../vendor/bl-ed/VENDOR.md).

The palette, help and `ed/commands` list now include package commands and preserve their namespaces:
`dwim/down` is discoverable rather than an ambiguous `down` label. User bindings and command
definitions remain above package layers.

## 4. Build and load

With the editor's language runtime built (`bin/bl-ed build`, with `BL_TREE` pointing at the
project's pinned BL source worktree when necessary):

Existing browser tabs cache ES modules. Save writable buffers and reload once to pick up the
generic editor seam; thereafter use/unuse switches the package layer without a page reload.

```sh
spikes/dwim/build.sh
# Optional: coexist with presentations and the inbox layout.
spikes/present/build.sh pkg
```

```text
?file=outline.bl.org&use=dwim
?use=present,dwim&layout=inbox
:(ed/use "dwim")
:(ed/unuse "dwim")
```

Unload removes its keys, commands and goal state in every editor pane. It does **not** reverse
your intervening navigation, deliberate folds, or edits. Without the package, `j/k` again use
raw source motions. Immediately using/unusing it does not adopt or overwrite editor keys.

## 5. Proof and reproduction

Real-editor proof used an offline memory world on **8792**, never the running world on 8790.
The launcher currently prepends its own `--root` and takes the first value; run it *from* the
temporary root to guarantee isolation:

```sh
root=$PWD
mkdir -p /tmp/omega-dwim-proof
cp spikes/dwim/test/outline.bl.org /tmp/omega-dwim-proof/
(cd /tmp/omega-dwim-proof && "$root/bin/bl-ed" --offline --memory --port 8792)
# Open http://127.0.0.1:8792/?file=outline.bl.org&use=dwim
```

Native keyboard trace: `2j` reaches source row 2; `h` folds it; `j` reaches source row 10 (screen
line 11), skipping rows 3–9. `k` returns to row 2. `:(ed/unuse "dwim")` removes the layer and
state without changing the fold or source. A following `j` runs `:move-down`, reaching raw row 3.

- [Used, folded section skipped](proof/01-used-folded-j.png).
- [After unload, folds preserved](proof/02-unused-folds-preserved.png).
- [Asserted native input/state trace](proof/trace.json).

Verification commands:

```sh
bin/bl js build dwim.selftest -p vendor/bl-ed -p spikes/dwim \
  --host eval-ed,eval-cells --out vendor/bl-ed/web/out
bin/bl run spikes/dwim/test/check.bl -p vendor/bl-ed -p spikes/dwim
bin/bl js build pp.check -p vendor/bl-ed -p spikes/present \
  --host eval-ed,eval-cells --out vendor/bl-ed/web/out
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=<pinned-bl-tree> PP_OUT=vendor/bl-ed/web/out \
  node --test spikes/dwim/test/drive.test.mjs vendor/bl-ed/test/*.test.mjs \
  spikes/present/test/scroll.test.mjs
PP_OUT=vendor/bl-ed/web/out node spikes/present/test/check.mjs \
  spikes/dwim/test/outline.bl.org vendor/bl-ed/web/welcome.bl.org \
  vendor/bl-ed/web/split-demo.bl.org spikes/present/web/welcome.bl.org
```

### Observed results (2026-10-05)

| Proof | Result |
|---|---|
| Full editor/language build on current pin `b4861edf` | Passed, with `BL_TREE=/home/user/.cache/bl/build-trees/b4861edf5db1` |
| DWIM and integration drive checks | 40/40 passed |
| Vendored editor drive/package/frame/host/server checks | 66/66 passed |
| Present scrolling checks | 12/12 passed |
| Combined Node suite | **118/118 passed**, zero skipped |
| Shared BL contract on BEAM and JS | 10/10 checks each |
| Unchanged `spikes/present/test/check.mjs` | Four documents, **36 scroll/fold variants**, every `:bad` list empty |
| Scoped `git diff --check` and checker source unchanged | Passed |
| Real editor on offline memory port 8792, current pin | Native `2j h j k`, API unload, baseline raw `j`, then API use passed |

The real-page assertion verified head `[10 0]`, fold `#{2}`, the DWIM layer present, DOM source
row 10 drawn, and rows 3–9 absent. After native API unload, the head was `[2 0]`, packages empty,
goal state nil, and fold `#{2}` retained. Raw `j` then reached `[3 0]` via `:move-down`.
`:(ed/use "dwim")` loaded the same package again at runtime without altering the fold or head.
The two linked screenshots were refreshed against this current-pin build.

The repository pin changed concurrently from `94700545` to `b4861edf`. Initial checks used the
established image while the new pin's cold build was locked; final full builds, BEAM checks,
Node gates and real-browser proof all used **`b4861edf`**. No pin or external work was rolled back.
The equivalence checker itself remains unchanged.

## 6. Deferred vision

No page/screen-end movement, contextual selection/growth, search reveal, temporary folds, peek,
attention trail, context action menu, or resolved-target explanation is implemented by this slice.
Their purpose, reuse opportunities, costs and safety boundaries are documented in full in
[`vision.bl.md`](vision.bl.md). The first additions recommended there are contextual selection
and search arrival, after this foundation is proven.
