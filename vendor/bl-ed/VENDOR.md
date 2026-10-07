# bl-ed, vendored

These files come from `beam-lisp/apps/bl-ed` at beam-lisp main `55f0a2af` (the last commit
touching it was `b637e2bf`, split cells). They are vendored here so that omega's UX slice
(`research/domain/interface/ux-slice.bl.md`) and its document providers
(`research/domain/interface/providers/`) can change editor and server code in one repo. This is
temporary, by the user's decision on 2026-10-04.

omega's pin `94700545` contains everything bl-ed needs (`bl.doc.spans`, `system.place`,
`js.eval`), so **the editor is built and served by omega's own pinned `bl`**. The page, the server
and omega's world run on one beam-lisp.

## What differs from upstream
| file | change | why |
|---|---|---|
| `build.sh` | compiles with omega's `bin/bl`; the in-page language comes from `$BL_TREE` (default `../beam-lisp`), which must be checked out at the pin (it refuses otherwise); writes to `vendor/bl-ed/web/out` | the in-page language is compiled from beam-lisp source paths |
| `src/bl_ed/serve.bl` (new) + `serve.bl` | the server is a LIBRARY (`bl-ed.serve/start!`) with `/api/doc`, `/api/rev` (long-poll), rev-checked `/api/save`, `scheme:` providers, `/api/intent`; `serve.bl` is a thin script over it | omega starts the same server in its own VM with its providers (one VM, no bridge) |
| `src/bl_ed/image.bl` (new) | the `bl:` provider: namespaces and per-var state (matches / changed / live-only / not loaded / lazy) against the source, reload through `reload/commit` | generic beam-lisp, useful without omega |
| `ed/pkg.bl` (new) | packages: a loaded module's layers (`:commands :keys :intercept :on-event :adopt :render`), never merged into the editor's tables, so `unuse` is exact; `ed/use` / `ed/unuse` / `ed/packages` on the `:` line; `:use` event; `:load-package` effect | FUP-010's seam (2026-10-04) |
| `ed/frame.bl` (new) | frames: a layout value (`:panes` editor/view, `:links`, `:focus`) brought to life as `{:layout :editors :focus :effects}`; `handle`/`take-effects`/`render` pure; links emit effects tagged `{:pane}`; `space w w h l o` (C-w closes a Firefox tab); `ed/layout` / `ed/layouts` on the `:` line; a frame of one pane renders exactly `ed.main/render` | design: research/domain/interface/frames.bl.md |
| `ed/docs.bl` (new) | documents that are not files: visit, `C-o` back, read-only views, refresh by rev, minibuffer prompts; a refresh keeps an open prompt (2026-10-04: it dropped your draft on every rev) and your PLACE (`row-map`: the cursor follows its object, the view maps through the text change, a reader who scrolled away is not pulled back) | generic |
| `ed/keymap.bl` | presentations: the row under the cursor may BE an object; its type's keys win on that row (`:presentation-keys`, `:object-at`) | generic |
| `ed/main.bl` | `handle` = package intercept → core → package on-event (+ adopt after a fresh document); `render` = a package's `:render` or the text, `:packages` in the view; `:doc :cards :intent-result` events; render carries `:card :agent? :object`, `:cards :doc-rev :virtual?`; status `:read-only? :asks :back`; `:prompt` minibuffer kind; package install (`install`, replaced by FUP-010); `render` split into `line-context` / `line-view` / `render-rows` (no behaviour change; the seam presentations draw through, PLAN-004) | |
| `ed/commands.bl` | `save` sends `:base` (the loaded rev); refuses on read-only views | lost-update safety |
| `ed/omega.bl` (new) | omega's console half (E28): task cells, cards, presentation commands, `space a o/s/n/q/i` | moves into omega's package with FUP-010 |
| `web/host.mjs` | effects `:visit :intent`; save with base; long-poll watchers for the shown document and the cards; boot through `/api/doc`; card drawing; status chips | |
| `web/theme.css` | `✦` agent mark, card tones, presentation row | |
| `test/frame.test.mjs` (new) | 8 drive tests of frames: one pane ≡ ed.main, arrange keeps your editor, :select link → one visit for the right pane, effects/answers per pane, `space w w` skips views + `space w o`, views draw from their pane, unknown layout, unuse spreads and ends its layout | |
| `test/pkg.test.mjs` (new) | 3 drive tests of packages: use/unuse exact, intercept/on-event/adopt/render, `ed/use` → effect (fail on the pre-seam build) | |
| `test/omega.test.mjs` (new) | 11 drive tests of the console contract (+1 2026-10-04: a refresh keeps the draft) | |
| `proof/` | upstream's 1.6 MB not copied; ours are `10-` … `15-` (2026-10-04, real browser run) | |

### DWIM navigation seam (2026-10-05)

- `ed/view.bl` (new): one visible-source topology from the existing outline/fold spans,
  shared by plain rendering and navigation; folded intervals are walked once. A bounded
  derived memo keyed by structure/folds/row count avoids rebuilding that topology for counts
  and reveal; source-row resolution is logarithmic. Package
  contributions `:provides {:navigation {:rows fn :reveal fn :outline? fn}}` are consulted
  latest-first, with nil declining and false explicitly disabling source-outline policy.
  Navigation rows are distinct ascending source rows; exact wrapped-column navigation is
  not claimed. The plain renderer continues to use source visibility, not package row lists.
- `ed/core.bl`: `scroll-to-cursor` delegates to the shared reveal operation. Plain reveal
  measures visible ranks (not source-row distance); presentation packages can reveal in
  their own slot coordinates. It does not unfold sections or rewrite selections.
- `ed/main.bl`: drawing delegates to `view/visible-rows`, removing the private fold predicate.
  The palette and `ed/commands` list include package layers, and command labels preserve
  namespaces so `dwim/down` is searchable and distinguishable from other packages' commands.
- `web/pkg/dwim.mjs` is generated by `spikes/dwim/build.sh`, importing the package from the
  page's shared `out/`. No host navigation implementation or extra page was added.

Interaction policy and its contract tests live outside the generic editor in `spikes/dwim/`.
The present package contributes its slot/source topology, task granularity for the rail,
projection-aware reveal, and whether its presentation uses source-heading folds. It defers rail
keys when a package advertises `:navigation-policy`, preserving counts and multi-head semantics
in either load order. Its derived navigation rows reuse `ed.memo/identity-pair` against the read
tree or layout slots; explicit omega folds outrank automatic focus detail. Deferred
selection/search/peek/action features are documented in `spikes/dwim/vision.bl.md`.

Every later change made here is listed in this table, so that it can be upstreamed.

## Build, run, test
```sh
bin/bl-ed build                    # ~3 min cold (the in-page language), ~25 s for the editor
bin/bl-ed --offline                # omega's world + bl-ed in ONE VM; open the printed URL
bin/bl-ed                          # the same with the live model
BLED_OUT=vendor/bl-ed/web/out BLED_ROOT=../beam-lisp \
  node --test vendor/bl-ed/test/drive.test.mjs vendor/bl-ed/test/omega.test.mjs
```
The drive tests' round-trip corpus is the beam-lisp tree's `.bl.org` files, hence `BLED_ROOT`.
Verified 2026-10-04 on the pin: drive tests 42/42 (19 upstream + 12 omega + 3 packages + 8 frames); omega's suite
18/18 files (incl. `ed_test`, `ed_image_test`); a real browser run (proof/10–15).

`web/host.mjs` is a FRAME host (holds an `ed.frame`, paints each pane into `#panes`; the first editor pane is the original `#editor`, others clone its skeleton; view panes have painters by kind — `minimap`); per-pane node lookup is by class (`.lines .gutter .page …`, ids kept for the first pane). It draws what a package's presentation returns: ornament rows (`:ornament? :src`, a click lands on `:src`), `:size`/`:role` rows, frames under the lines (`#frames`), an inline minibuffer (`:inline?`), `S-Enter`, wheel by screen rows (`:scroll-slots`), and loads packages (`:load-package` → `import('./pkg/<name>.mjs')`; `?use=a,b` at boot). `fitHeight` subtracts the page's padding and refits on resize (the clipped-last-row trap below is fixed). `web/pkg/` holds package loaders (generated, e.g. `spikes/present/build.sh pkg`).

**Host traps found on the way** (this workstation):
- `build.sh` refuses unless `../beam-lisp` is AT the pin. To rebuild only the editor modules (the
  in-page language unchanged): `bin/bl js build ed.main -p vendor/bl-ed --host eval-ed,eval-cells --out vendor/bl-ed/web/out`.
- `fitHeight` in `web/host.mjs` counts `#page`'s top padding as rows and measures before the status
  line lays out: the last row is clipped by a few px (found by spikes/present-pipeline.bl.md; fixed in the spike's host only).
- the shell's `kill` builtin rejects `-9`, so `kill -9` does nothing. Use `/bin/kill -KILL`, or a
  stale server keeps its port and every "restart" silently serves old code.
- `edit`/`create` on a script resets its mode; `chmod +x bin/bl bin/bl-ed vendor/bl-ed/build.sh`
  after touching them.

## Leaving
Two ways out, whichever comes first:
1. Upstream the changes listed above to `beam-lisp/apps/bl-ed` and delete this directory.
2. Move the omega parts into omega's package (FUP-010), with bl-ed loading them live.

## Smooth loading and scrolling (PLAN-007)

- `ed/memo.bl`: bounded, identity-keyed LRU for pure two-input derived values. `ed/frame.bl` reuses unchanged editor/view models across frame updates; the presentation package uses the same primitive for its body/reveal/minimap model. A cache holds eight snapshots, not unbounded edit history.
- `web/host.mjs`: parallel document/editor/package startup; initial layout uses `frame/arrange` directly. The command-line language starts after the first display. Input received before boot is replayed in order. Synchronous evaluation hooks return a readiness sentinel, never a Promise.
- `ed/main.bl` / `ed/commands.bl`: an unavailable evaluator parks the command draft or local cell, emits `:await-language`, and resumes once on a matching token/context. Escape, changed drafts, changed cells and navigation cancel stale work; load failure retains the draft for retry.
- Visits are latest-request-wins per pane, abort superseded reads, retain the previous picture with loading status, and reject stale background refreshes. URL updates preserve package/layout/theme boot parameters.
- Watcher bookkeeping shares the painted frame. Unchanged panes retain their DOM; the minimap retains its bars and updates only the lens when scrolling. Geometry is measured on resize, not after clearing/rebuilding its body each frame.
- Wheel easing is elapsed-time based; continuous trackpad deltas and reduced-motion input are applied directly. Disposal cancels the pane's animation/request state. The cold-start path shows loading/failure status and bounds the initial document fetch.
- `build.sh` now builds `ed.frame`, not only `ed.main`: a clean output directory must contain the frame module imported by the host.
- Regression gates: editor/host/frame/pkg/omega drive tests (65), presentation scrolling/cache tests (12), and the existing default-presentation equivalence corpus. The equivalence runner now accepts `--corpus` and exits nonzero for mismatches or an empty corpus.

The implementation and measured outcomes are tracked in `research/domain/interface/loading-and-macros.bl.md`; throughput targets are not implied by passing functional tests.


Cold-image HTTP gate: `bl-ed.serve` explicitly requires `clojure.re`. Resolving an unqualified `re-matches` before its regex literal loads that library failed the first virtual-path request in a fresh packaged VM, while warm suites hid it. `test/serve-cold.test.mjs` starts a fresh ephemeral fixture, checks the first virtual HTTP read without retrying it, then verifies an appended turn changes the document rev. No live-world writes are involved.

Workspace slice (2026-10-07): `ed/frame.bl` consumes generic `:frame-focus` effects (spatial, clamped, editor panes only) and asks package `:provides :selection` callbacks for object identities when no provider object occupies the source row. `ed/docs.bl` accepts `:goto {:block id}` for exact current-source block-ID arrival. `ed/omega.bl` forwards an optional single-token `:cwd` task-header attribute through its existing task/open intent. The host preserves keyboard focus when moving the input sink between panes. The workspace package, attached-folder providers and task context remain above the generic editor. Proof and drive contract: `spikes/workspace/workspace.bl.md`.

### 2026-10-07 — clipboard image prototype support

For `spikes/images` (`?use=images`): the host leaves native Ctrl/Cmd+V to the
browser, reads PNG/JPEG/WebP clipboard files only when a package provides
`:clipboard {:images true}`, and emits pane-targeted `:paste-image` events.
The package decides insertion and drawing; the host performs `:asset-store`
effects and paints generic `:image` segments in sized presentation rows.
Local previews are immediate after clipboard decoding; saves await referenced
asset uploads and report a failed upload instead of saving a dangling reference.
The server stores SHA-256-addressed bytes under the served root's `.assets/`,
checks names and digests, and exposes POST `/api/assets` and GET
`/api/assets/<digest>.<png|jpg|webp>`. Theme rules fit images without upscaling.
No omega concepts were added to `ed.*`.

### 2026-10-07 — source positions on reused presentation rows

When folding removes one of two identical image ornaments, the remaining
ornament can reuse its DOM slot because its visual signature is unchanged.
The host now updates `data-row`/`data-src` even when reusing a line, so clicks
and inspection target its current source position. Verified by
`spikes/images/test/folding-browser.mjs`: two references to the same image,
nested heading fold/unfold, and source toggle in the real offline editor.
The image package now keeps the standard section tree and default fold policy
instead of flattening the document; no core BL folding changes were needed.

### 2026-10-07 — browser observation prototype

For `spikes/browser`: generic `:image` view painter consumes package-provided
`{:src :alt :refresh-ms}` data. Optional image refresh stops when its pane is
removed; the host carries no browser/session/Omega knowledge. Frame pane
skeletons omit the single input sink before cloning, avoiding visible duplicate
textareas after their IDs are removed. Browser lifecycle, task ownership,
providers and intents remain in the spike. Contract and screenshots:
`spikes/browser/browser.bl.md`. Vendor drive suite: 66/66; presentation default
equivalence checker unchanged and green on the welcome and browser documents.

Standalone image-package build gate: `ed/main.bl` moves the `eval-command`
header back to its evaluator body, the pending-language branch into that
body's `cond`, and the language-answer event pair before the click branch.
These minimal repairs prevent misplaced forms in the prior committed source
from breaking a clean build. Other workspace/editor changes are excluded.

The presentation package likewise moves its resize event branch from `draw`
(where `ev` is unbound) into `intercept`, keeping the standalone build valid.


### 2026-10-07 — workspace place/reference/buffer extensions

`ed/pkg.bl` avoids introducing a nil pkg-state key when removing a stateless
package, and supports an optional pure `:on-unuse` cleanup hook. `ed/docs.bl`
provides package-owned prompts, cancelled on that package’s removal while
foreign drafts remain. `ed/frame.bl`
collects cleanup effects from every synchronized pane before layout collapse.
The web host transports provider data, assigns client identity/monotonic request
sequences, carries optional returned save text, and offers generic session
leave/resume events. The serve host passes client metadata to provider writes
and returns optional merged text or provider errors. No place/task/buffer
vocabulary is introduced below the packages.

Domain implementations and schema ownership remain in `spikes/workspace`.
Source/editor/backend checks are documented there. The complete real-editor
agent-browser drive passed on offline port 8798, including used/unloaded
screenshots for each package. All 66 vendor tests, including cold HTTP startup,
and the unchanged 36-variant presentation equivalence check passed. The earlier
committed workspace screenshots remain historical proof for the earlier slice.

### 2026-10-07 — workbench layout transitions and initial metadata

The generic host now carries provider data on initial load, as it already did
on visits, and clears stale loading attributes when a pane DOM node is reused.
`ed/frame.bl` preserves explicit target panes on package effects and accepts a
pure `:frame-layout` effect with named editor retention, optional visits and
focus. It refuses to discard unsaved text or prompt drafts or duplicate an
editor into two panes. New editors start without copied transient package state.
This is domain-free; the workbench declares the layouts and transitions.
The added frame contract test and all 67 vendor tests pass; the unchanged
presentation checker passes 36 variants. Real-editor proof is in
`spikes/workspace/workbench.bl.md`.

2026-10-07: `web/host.mjs` preserves input focus while synchronizing pane DOM order.
Moving a pane containing the textarea otherwise focused the body and dropped the
next shortcut. The offline workbench artifact tour checks active input focus and
a real paragraph edit immediately after its layout transition.

2026-10-07: presentations may attach a named `:command` to a segment, or return
an `:actions` overlay of named commands. The host paints accessible buttons and
routes pointer/Enter activation through the generic `:command` event. Core
command lookup and the read-only edit guard apply; it never evaluates segment
text. Qualified keyword names retain their namespaces. Command identity enters
the paint signature so an updated action cannot retain a stale pointer target.
Host and drive tests verify names, user command lookup and read-only refusal.
The action overlay uses compact key/name/help rows and remains bounded by the
viewport. Domain menus and action composition stay in packages.


### 2026-10-07 — declarative file-local packages

The host reads `#+USE: installed,bare,names` within a document's first twelve
lines on boot and ordinary visits. It imports package values, then installs them
through the same frame `:use` events as explicit use. No document code or remote
module references are evaluated. An explicit unload suppresses that file-local
package for subsequent refreshes/visits in this browser session; explicit use
reenables it. Domain layouts stay in their packages. `document-packages.mjs` and
its tests pin declaration ordering, boundaries and unload suppression. Existing
package host resource disposal remains responsible for unload cleanup.

2026-10-07: layout `:keep` accepts an ordered vector of candidate source panes.
The frame retains the first existing editor, allowing a package to keep a
conversation across repeated file/folder transitions without copying its draft.
The existing duplicate-editor and draft-discard guards still apply. A frame
contract test covers both initial and subsequent transitions.
Named command buttons position their source row while a command prompt is open,
so a contextual answer can target its actual object without losing the draft.
Workbench guards commands that would replace an owned prompt; the offline slice
4 tour answers a real task while drafting, then retains that draft as a follow-up.

Card watches include references from every visible editor pane and deliver card
refreshes to each pane. A retained plan therefore updates task status while its
conversation has focus, rather than waiting for focus to return to the plan.
The workbench browser tour verifies the terminal reference in the unfocused plan.

2026-10-07: ordinary visits and named focus effects accept ordered pane candidates.
The frame resolves them before host IO; visit effects refuse to replace an
unsaved target file or nonempty prompt. Same-address visits preserve that draft
without resetting it. The generic frame test covers two/three-pane resolution,
untouched working text, prompt retention and file-draft refusal. Workbench's
final navigation tour switches tasks while retaining a plan, then proves a
second task switch preserves a pending reply. Domain policy remains in the
package; frame decisions use only editor state and effect values.
