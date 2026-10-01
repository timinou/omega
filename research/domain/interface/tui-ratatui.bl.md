# A beam-lisp ratatui wrapper whose API mirrors loom

> Literate beam-lisp: ```` ```beam-lisp ```` blocks run under
> `cd omega && bl run research/domain/interface/tui-ratatui.bl.md`; ```` ```clojure ````
> blocks are design sketches (not run); ```` ```rust ````/```` ```elixir ````/```` ```ts ````
> are quotes or illustrations of other projects.

**Abstract.** omega wants a TUI front-end whose API mirrors `loom` (`loom-and-grammar.bl.md`) so that one
view function — `state → hiccup`, events as data — can drive either a wry webview or a
terminal. ratatui is an immediate-mode Rust renderer: each frame the app redraws every
widget into a cell `Buffer`, and ratatui diffs against the previous buffer. loom is a
retained-ish, declarative tree. The bridge is therefore "BEAM owns state + the tree;
a thin Rust NIF owns the terminal, layout solving and cell diffing". This document
(1) summarises ratatui's model, (2) summarises how beam-lisp already ships Rust NIFs
(`wry_webview` is the closest precedent), (3) surveys existing BEAM TUI options — one of
which, **ex_ratatui**, already did exactly this for Elixir and is the strongest prior art,
(4) maps every loom primitive to a ratatui widget/layout, flags what cannot map, and
(5) proposes the state/render split and an API sketch. Two small runnable blocks prove the
two hardest *pure-beam-lisp* parts: a constraint-style layout solver and a loom-tree→semantic-node
lowering that recovers `:gap`/`:dir` from the real loom output.

---

## 1. Sources

**ratatui** (fetched 2026-10-01, via `fetch`):
- https://ratatui.rs/concepts/rendering/under-the-hood/ — `Terminal::draw`, `Frame`, `Buffer`, `Cell`, double-buffer diff, `Widget::render(self, area, buf)`.
- https://ratatui.rs/concepts/layout/ — `Layout`, `Constraint::{Length,Percentage,Ratio,Min,Max,Fill}`, `Flex`, Cassowary, Taffy PoC note.
- https://ratatui.rs/concepts/widgets/ — built-in widgets list, `Widget`/`StatefulWidget`/`WidgetRef`.
- https://ratatui.rs/concepts/event-handling/ — events are backend's (crossterm), three structuring patterns.

**BEAM TUI options:**
- https://github.com/mcass19/ex_ratatui (README fetched via raw.githubusercontent.com, `main`), https://hex.pm/packages/ex_ratatui, https://elixirforum.com/t/exratatui-elixir-bindings-for-the-rust-ratatui-terminal-ui-library/74403 (search hits).
- https://raw.githubusercontent.com/mcass19/ex_ratatui/main/guides/internals/architecture.md (NIF bridge + process trees).
- https://raw.githubusercontent.com/mcass19/ex_ratatui/main/guides/core/building_uis.md (widgets, layout, events, stateful widgets, focus).
- https://raw.githubusercontent.com/mcass19/ex_ratatui/main/guides/runtimes/reducer_runtime.md (Elm-style runtime: `init/update/render/subscriptions`, commands, intents, snapshot/inject_event).
- https://github.com/ndreynolds/ratatouille (Ratatouille: TEA + HTML-like view DSL on termbox via ex_termbox); https://hex.pm/packages/rrex_termbox & https://hexdocs.pm/rrex_termbox (termbox2 NIF fork under Raxol).
- https://github.com/fuelen/owl (Owl: CLI toolkit, explicitly *not* full-screen; lists TermUI, Ratatouille, ExNcurses as full-screen options).
- https://elixirforum.com/t/garnish-a-terminal-ui-framework-for-ssh-based-applications/65455 (Garnish: Ratatouille-style over `:ssh`), Termite (talk: https://www.youtube.com/watch?v=eNbZcWTu0i0) — **search-result snippets only, not read in depth**.

**beam-lisp** (repl worktree `/home/user/code/undefine/beam-lisp--repl`):
- `native/wry_webview/Cargo.toml` (1–40), `native/wry_webview/src/lib.rs` (1–70, 376–400, 535–560): thread-per-window NIF, `OwnedEnv` send, `rustler::init!`.
- `native/bl_json/{Cargo.toml,src/lib.rs}` (1–50): "bl DECIDES; Rust WRITES BYTES" doctrine.
- `priv/lib/wry.bl` (1–183): `defnative`, receiver process, `available?`.
- `priv/std/vm/native.bl` (1–40, 100–135, 275–330): `vm.native/declare`, host-module naming, `build-all!`, `INSTALL-DIR "priv/native"`.
- `priv/lib/loom/{box,ui,parts,token,desktop}.bl` (`loom-and-grammar.bl.md`), `priv/lib/live/{hiccup,diff}.bl`.
- `bin/bl` ≈ lines 405–420: `bl` boot runs `vm.native/build-all!`, "cargo absent → reports and continues".
- `docs/native-bundler.md` §5 (lines 29–40): "The bundler does NOT compile NIFs (v1)"; `priv/native` per target.
- `docs/bl/00-the-cli.md` 100–116: `bl repl --terminal`, `bl doctor` reports native backends.
- `priv/std/proc.bl` + `priv/std/proc/*.bl` (bus fence flow pipeline queue reg sched server super table tick).
- grep of beam-lisp, beam-lisp--repl and `spell` for `ratatui|crossterm`: only hits are in `PLAN-108`, `FUP-050`, `priv/build/deps-compile.bl` (dependency-fetch/compile plumbing, unrelated to a TUI) — i.e. **no existing beam-lisp ratatui work (OBSERVED)**.

**pi TUI (for contrast)**: `research/vendor/pi/packages/tui/src/tui.ts` 117–129 (`Component.render(width): string[]`, `handleInput`, `handleMouse`), `packages/tui/README.md` lines 3, 245–305 (differential rendering, mouse results with `capture/focus/render` flags).

---

## 2. How ratatui works (OBSERVED from ratatui.rs)

**Immediate mode.** Per frame the app calls `terminal.draw(|frame| …)`; inside, every widget is rendered
into an intermediate `Buffer` (a grid of `Cell`s: symbol + fg/bg/modifiers). After the closure returns,
`Terminal::flush()` diffs the *current* buffer against the *previous* one and writes only changed cells
through the backend, then swaps buffers. The buffer is wiped before each frame, so *the app must draw everything every frame*.
Render order matters (later widgets overwrite earlier ones in the same cell) — this is how overlays work.

```rust
pub trait Widget { fn render(self, area: Rect, buf: &mut Buffer); }
pub trait StatefulWidget { type State; fn render(self, area: Rect, buf: &mut Buffer, state: &mut Self::State); }
```

**Layout.** Origin top-left, `u16` coordinates. `Layout::default().direction(Vertical).constraints([…]).split(area)`
returns a `Vec<Rect>`; layouts nest. Constraints: `Length(n)`, `Percentage(n)`, `Ratio(a,b)`, `Min(n)`, `Max(n)`,
`Fill(weight)`. `Flex::{Legacy,Start,End,Center,SpaceBetween,SpaceAround}` places leftover space. Solved with the
**Cassowary** algorithm; when constraints are unsatisfiable the result "can be arbitrary / non-deterministic".
Docs note Taffy (CSS flex/grid) PoCs exist but are not built in.

**Widgets** (built-in list): `Block` (borders, titles), `BarChart`, `Calendar`, `Canvas`, `Chart`, `Clear`, `Gauge`,
`LineGauge`, `List` (selection), `Paragraph` (styled/wrapped), `Scrollbar`, `Sparkline`, `Table` (selection), `Tabs`;
`Span`/`Line`/`Text` are renderable. Stateful widgets (`List`, `Table`) keep selection/scroll in an external `State` that render mutates.

**Events.** ratatui does *not* expose input; the backend crate does (crossterm: key/mouse/resize/focus/paste). ratatui.rs lists
three patterns: centralised handling, centralised catching + message passing, distributed loops.

---

## 3. How beam-lisp does native Rust (OBSERVED)

- **Crates** live in `native/<crate>/` (`bl_json`, `code_embed`, `datom_*`, `lazy_memo`, `wry_webview`), each a `cdylib` using
  `rustler = "0.38"`. `wry_webview` gates heavy deps by `[target.'cfg(target_os = "linux")'.dependencies]` and makes the whole
  `lib.rs` `cfg(target_os = "linux")` so on other OSes the cdylib is empty and `wry/*` "reads as ABSENT instead of failing the build".
- **Declaration** is in beam-lisp: `(defnative "wry_webview" (webview-open 15) (webview-eval 2) (webview-resize 3) (webview-close 1))`.
  `defnative` lowers to `vm.native/declare`, which synthesises a host module named after the namespace
  (`BeamLisp.Native.<CamelNs>`, the `rustler::init!("Elixir.BeamLisp.Native.Wry", load = load)` contract), emits an `@on_load` + one
  `nif_error` stub per signature, links each name as an ordinary var. Missing `.so` ⇒ `(vm.native/available? "wry")` is `false`; **never
  present-but-degraded** (`native_test.bl`). `vm.native/native.bl` header: "The Rust artifact stays; ONLY this policy is beam-lisp now."
- **Build:** `vm.native/build-all!` runs cargo, installs `priv/native/<crate>.so`, skips when the .so is newer than every source; "cargo
  absent → reports and continues". `bl` runs it at boot. The *drop* bundler does not compile NIFs (v1), only asserts per-target objects.
- **Threading/IPC precedent** (`wry_webview`): a GUI toolkit cannot block a NIF, so each `open` spawns a dedicated OS thread owning
  the event loop and hands back a `ResourceArc` handle (an `EventLoopProxy` behind a `Mutex`); NIFs `eval/resize/close` poke the
  proxy. Page→BEAM events go `OwnedEnv::send_and_clear` to a **receiver pid** as `{:wry-ipc body}`; `wry.bl` runs one `ipc-loop`
  process per window that calls a user `:on-message`. A `Window` is `(defrecord Window [handle receiver])`.
- **Doctrine** (`bl_json` doc): *"bl DECIDES; Rust WRITES BYTES."* Policy in beam-lisp, a narrow native loop for what is slow/blocking.
  Per-call BEAM↔NIF overhead is measured there at ~0.7–1.0 µs/call-ish for bl-level traversal, so push *bulk* across the boundary,
  not per-cell chatter (INFER for TUI: ship whole frames, not cells).

---

## 4. Survey of BEAM TUI options

| project | what | model | verdict for omega |
|---|---|---|---|
| **ex_ratatui** (`mcass19/ex_ratatui`, hex `~> 0.16`) | Elixir bindings to ratatui via Rustler NIFs, precompiled NIFs (rustler_precompiled), 25 widgets (Paragraph Block List Table Gauge BarChart Chart Canvas Calendar Tabs TextInput Textarea Markdown Image BigText CodeBlock Viewport3D…), constraint layout exposed (`Layout.split(area, :vertical, [{:length,3},{:min,0}])` computed in Rust, returns `%Rect{}`), events polled by `poll_event` on the **DirtyIo** scheduler, per-process `ResourceArc` terminal with real crossterm backend or headless test backend, Elm-style *reducer* runtime + LiveView-style callback runtime, transports: local tty, SSH, Erlang distribution, "CellSession" (expose the cell buffer to LiveView/framebuffer), `:telemetry`, `inject_event`, `Runtime.snapshot`, focus ring, `Popup`/`Clear` overlays, images via Kitty/Sixel/iTerm2/halfblocks. Widgets are **structs encoded to string-keyed maps across the NIF boundary, decoded to ratatui types**. `render/2` returns `[{widget, rect}]` — the app still computes rects itself. | immediate-mode on Rust side; BEAM sends a widget list per frame | **Strongest prior art and a design template**; same architecture as proposed here. Could even be a *dependency* via a beam-lisp↔Elixir bridge (open Q1). |
| **Ratatouille** (`ndreynolds/ratatouille`, 850★) | declarative TUI kit, "similar to how you write HTML", TEA (`init/update/render`), `view do row do column … end end` DSL, built on termbox via `ex_termbox`; subscriptions, commands; Toby (observer) built on it. | retained-ish: `render(model)` returns a view tree; renderer lays out + paints cells in Elixir | API ideology closest to loom (tree = value, layout by `row`/`column` with sizes), but termbox backend is C, unmaintained-ish (maintained fork: `rrex_termbox`, termbox2 NIF). Good *reference for the tree shape*. |
| **rrex_termbox / Raxol** | termbox2 NIF (v2.0 NIFs; earlier a port helper `termbox_port`) | low-level cells | only if avoiding Rust; no widget/layout layer. |
| **Owl** (`fuelen/owl`) | CLI toolkit: tags/colours, prompts, tables, progress bars, `LiveScreen` live-updating blocks; its README says full-screen apps → use TermUI/Ratatouille/ExNcurses | line-oriented, scrolls in-place | relevant for a **non-fullscreen / inline mode** (like pi's main-screen renderer) – not a loom target. |
| Garnish / Termite | Ratatouille-style framework over `:ssh`; Termite = terminal lib (talk) | — | snippets only, not evaluated; SSH transport is interesting for remote omega. |

NB: the README's claims (widget count, platforms, precompiled NIFs) are the *project's own statements* (OBSERVED from its README);
I did not install or run ex_ratatui.

---

## 5. Where state and rendering live (decision analysis)

Three splits:

| | A. BEAM tree → full widget list per frame (ex_ratatui style) | B. BEAM tree **diffed** → patch ops to a Rust-retained tree | C. Pure-beam-lisp renderer, Rust only for tty I/O + cell flush |
|---|---|---|---|
| state | BEAM | BEAM (+ mirror in Rust) | BEAM |
| layout solving | Rust (`Layout::split`) or BEAM | Rust retained | **BEAM** (ours, deterministic, testable) |
| cell buffer & diff | Rust (ratatui) | Rust | Rust or BEAM |
| NIF traffic | whole frame/tick (encode ~hundreds of terms) | small patches | one cell-grid per frame (or only diff) |
| complexity | low | high (second tree, ids, desync bugs) | medium |
| testability | headless backend exists | hard | **excellent** — everything up to cells is a pure fn → golden tests/`bl test` |
| reuse of `live.diff` | no | yes (ops are the same set) | no |
| fidelity vs ratatui widgets | exact | exact | must re-implement widgets |

**Recommendation (INFER, to confirm with user):** **A with a beam-lisp layout pass in front** — i.e. BEAM owns *all* state and
the loom tree; each render does `lower(tree) → semantic nodes → layout(box tree, terminal size) → [{widget rect}]` in beam-lisp,
and ships a flat widget list to a **thin NIF** that draws it via ratatui's `Buffer` and flushes (ratatui already double-buffers and
diffs cells, so we get terminal-level diffing for free). Reasons: (1) layout in beam-lisp makes loom's flex-like props
(`:grow`, `:gap`, `:justify`, `:pad`) mean what they mean on web — ratatui's `Layout` is a 1-D constraint solver with `Flex`, close
to flexbox but not equal, and its Cassowary result is documented as possibly arbitrary under conflict; (2) it keeps "bl decides,
Rust writes bytes"; (3) stateful widgets (text input, scroll) can keep their *state in BEAM* and be re-sent each frame (cheap at TUI scale),
avoiding the "recreate the state in render silently drops the cursor" mistake ex_ratatui's docs warn about (they use NIF-resident state
for `TextInput`/`Textarea`; we choose differently for inspectability — trade-off in Q4). B is only worth it if profiling shows frame
encode cost matters (unlikely at 80×50 cells; INFER).

**Process shape** (mirrors `loom.desktop` + `wry.bl`, OBSERVED pattern): one *driver* process owns `state`; a *terminal port process*
(receiver) owns the NIF handle and forwards decoded input events `{:tui-event ev}` to the driver; a *tick* process folds `:tick`.
Same `view`/`on-event`/`tick` contract as `d/app` so the two back-ends are interchangeable.

```
 crossterm thread(s)  --OwnedEnv send-->  receiver proc --[:event ev]--> driver proc (state)
        ^                                                                    |  view(state)->hiccup
        | draw(widgets)  <--- NIF (DirtyCpu/Io) <--- lower→layout→widgets ---+
```

---

## 6. loom → ratatui mapping

"Lowering" below = semantic node produced by the TUI back-end after consuming loom hiccup (see §8 for why it must read box props, not CSS).
Cells replace px: INFER default 1 cell ≈ 8 px wide, ≈ 16 px tall; `:space` tokens quantise to {0,1,2,3,4,6,8…} cells (open Q3).

### 6.1 Layout (`loom.box`)

| loom prop | ratatui | note |
|---|---|---|
| `:dir :col/:row` | `Direction::Vertical/Horizontal` | `-reverse` variants: reverse the child list in BEAM |
| `:gap n` | `Layout::spacing(n)` | exact |
| `:pad` | `Block::padding` or shrinking `Rect` | exact; `[y x]` ok |
| `:grow n` (child) | `Constraint::Fill(n)` | exact |
| `:w/:h n` | `Constraint::Length` ; `:full` → `Fill(1)`/`Percentage(100)` | |
| `:basis` | `Length`/`Min` | approximate |
| `:max-w/:min-w` | `Max/Min` | exact |
| `:justify :start/:center/:end/:between/:around` | `Flex::Start/Center/End/SpaceBetween/SpaceAround`; `:evenly` ≈ `SpaceAround` | `:evenly` not in the docs' Flex table (INFER nearest) |
| `:align` (cross axis) | none — ratatui layouts only split the main axis; cross-axis align = place a `Length`-sized `Rect` yourself (`Flex::Center` on a nested 1-child layout) | **partial** |
| `:wrap true` | none | compute row breaks in BEAM, emit nested rows |
| `:grid n / template / :auto-fit` | nested Layouts (row of `Fill(1)` × n); `:auto-fit` = compute columns from width ÷ `:min-col` cells in BEAM | emulated |
| `:at {:md {…}}` | re-evaluate with terminal width in cells against breakpoints (`:sm 480px→60 cols`, `:md 768px→96`…) | feasible; terminal width is data |
| `:bg :fg :radius :shadow :border` | `Style` (fg/bg), `Block` borders (`BorderType::Rounded` ≈ radius ≥ :md, `:plain` otherwise), `:shadow` → none (or dim 1-cell offset — gimmick) | radius/shadow lossy |
| `:on {:hover …}` | **cannot map** except via mouse-move reporting (crossterm can report `moved`, ex_ratatui exposes `Mouse{kind:"moved"}`) — treat as app-level hover state, not CSS | |
| `:style {…raw css…}` (escape hatch) | **no ceiling is impossible**: ignore unknown CSS; provide a parallel `:tui {…}` escape hatch (raw ratatui `Style`/constraint) merged last — keeps loom's *no-ceiling* contract | proposal |
| `:as :section …` | ignored (semantic role kept for introspection) | |

### 6.2 Components (`loom.ui` / `parts` / `desktop`)

| loom | ratatui widget(s) | fidelity |
|---|---|---|
| `heading level` | `Paragraph` + bold/underline; level 1 may use `BigText` (ex_ratatui) | ok |
| `prose` / text | `Paragraph` (`Wrap`), `Line`/`Span` for runs | ok; `:tone` → fg dim |
| `link` | styled `Span` underlined; `:navigate` via key/click; OSC 8 hyperlink if terminal supports (Owl mentions OSC 8) | partial |
| `badge` | `Span` with bg + padding spaces `" ok "` | ok |
| `alert` | `Block` with left border only (`Borders::LEFT`) + tone colour | ok |
| `button` | `Paragraph` in a bordered `Block`/reverse-video `" Save "`; click via mouse hit-test, key via focus ring | ok; disabled = dim + no handler (keeps a11y contract) |
| `field` (input) | `TextInput`/`Textarea` (ex_ratatui) or own widget; label as a `Line` above; error as red `Line`; hint dim | ok; IME/paste caveats |
| `checkbox` | `Span` `"[x] label"` (ex_ratatui has `Checkbox`) | ok |
| `select` | `List` popup (`Popup`+`Clear`) or inline `‹ value ›` cycler | ok |
| `card` | `Block` (rounded border, title) | ok |
| `divider` | `Block` top border / repeated `─` `Line` | ok |
| `skeleton` | dim `░░░` fill / `Throbber` | ok |
| `identity` | initials `Span` in a bg colour; `:agent` square vs `:person` circle → `■` vs `●` glyph | ok |
| `when-day`, `kbd` | `Span`s (`kbd` reverse-video) | ok |
| `progress` | `Gauge`/`LineGauge` (+ caption/label `Line`) | exact |
| `timeline` | vertical list of `Span`s with status glyphs (`✔ ◔ ○ ✘`) | ok |
| `events` | `List`/`WidgetList` rows: who · when · what | ok |
| `tabs` | `Tabs` widget (button shape); link-tabs (`:href`) = `Tabs` whose selection is a `[:navigate url]` | ok |
| `disclosure` | stateful: `▶/▼ summary` line + conditional child; **state must live in the tree/session** (no browser-owned `<details>`) | needs `:assign` (web has it for free) |
| `facts` | two-column `Table` or `Line` pairs in a grid (`:cols n` → nested layout) | ok |
| `table` | `Table` (header, rows, selection `:on-row`, sort marker `▲▼`) | ok; keyed rows irrelevant |
| `dialog` / `drawer` | `Clear` + `Block` in a centred/edge `Rect` (ex_ratatui `Popup`); Esc → `:on-close` | ok; scrim = dim background pass |
| `toast` | transient bottom-right `Block`; timer-driven removal in BEAM | ok |
| `empty-state` / `error-state` | centred `Paragraph`s | ok |
| `dropdown`/`menu-item`/`d/bar` | `Popup` + `List`; "bar" = a 1-row layout at the top/bottom (+ alternate-screen reserve) | window-manager features (layer-shell) N/A |
| `form-for` | pure composition of the above | free |
| hiccup raw tags (`:table :ul :a …`) | tag→node table in the lowerer; unknown ⇒ `:box` of children | extensible via `expand-aliases` |
| `keyframes`/`transition`/animation | none; emulate by tick-driven state (spinners, easing over cells) | cannot map |
| images (`<img>`, canvas/svg charts) | ex_ratatui `Image` (Kitty/Sixel/iTerm2/halfblocks) or ratatui `Canvas`/`Chart`/`Sparkline`/`BarChart` | terminal-dependent; fallback text |
| scrolling regions (`overflow:auto`) | `Scrollbar` + viewport offset in BEAM state; heterogeneous heights need a `WidgetList` (ex_ratatui) | emulated |
| rich text/markdown | `Paragraph` with `Span`s, ex_ratatui `Markdown`/`CodeBlock` | ok |
| fonts, sizes (`:text :3xl`), shadows, gradients, backdrop blur, transparency, `:radius` precision | **cannot map** (only bold/dim/underline/colour, 24-bit colour if terminal supports) | |
| sub-cell geometry, `position:absolute`, z-index | overlays via render order + `Clear`; absolute = explicit `Rect` | partial |
| hover, focus-visible ring, text selection, native context menu, drag | partial: mouse reporting; **focus ring** is app-managed (ex_ratatui `Focus` module precedent) | |

### 6.3 Events

loom events are *data on nodes* (`:on-click [:intent …]`, `:on-input`, `:on-keydown.enter`, `:on-keydown.escape`,
`:on-select`). TUI input arrives as crossterm `Key`/`Mouse`/`Resize`/`Focus`/`Paste`. The back-end must supply what the browser gave
for free:

1. **Hit-testing:** after layout, keep `[{rect node-path event-terms}]`; a mouse `down` at (x,y) selects the topmost rect with `:on-click`.
2. **Focus ring:** Tab/Shift-Tab order over focusable nodes (button, field, checkbox, select, tab, link) in tree order; Enter/Space ⇒ the
   node's `:on-click`; typing ⇒ the focused field's `:on-input` `[term value]` (identical to desktop hook: `input`/`change` become `[term value]`).
3. **Key bindings:** `:on-keydown.enter` / `.escape` keep their meanings (the desktop hook already prefix-matches `data-ev-keydown.enter`).
4. **Resize:** re-run layout; `:at` breakpoints re-evaluate.
5. Output events are the *same terms* (`[:intent …] [:assign …] [:navigate …]`), normalised by `live.socket/normalize-event` → so reducers are identical across back-ends.

---

## 7. beam-lisp mapping

| need | existing (path) | gap |
|---|---|---|
| declare NIF + availability | `defnative`, `vm.native/available?`, `native/<crate>` + `build-all!` (`priv/std/vm/native.bl`) | new crate `native/omega_tui` (rustler 0.38 + `ratatui` + `crossterm`), cfg-gated off-Linux if needed (precedent: wry) |
| event delivery to a process | `OwnedEnv::send_and_clear` + receiver `ipc-loop` (`wry.bl`) | crossterm reader thread (or `poll_event` on DirtyIo as ex_ratatui does) |
| per-terminal handle | `ResourceArc` + `defrecord` (`Window`) | `Terminal` resource (real + headless test backend) |
| tree value, transforms | `loom.*`, `live.hiccup`, `live.diff`, `loom.transform` | **semantic lowering** (this doc §8); tokens→cells |
| process patterns | `proc/{server,tick,bus,super,reg}` | supervise driver+receiver together (`proc/super`) |
| tests/golden frames | `bl test`, `deftest`, `is` (`test/bl/loom/*`) | headless backend ⇒ `(frame->lines cells)` assertions |
| precompiled NIF distribution | drop bundler: "does NOT compile NIFs (v1)" | ship `.so` per target or build via `build-all!` (needs cargo) — ex_ratatui uses rustler_precompiled to avoid a toolchain |
| terminal fallback | `bl repl --terminal` exists (plain loop) | full-screen TUI is new |

---

## 8. Runnable: the two pure-beam-lisp pieces

**Block 1 — a main-axis layout solver** (what the BEAM-side layout pass does before handing `Rect`s to the NIF). Items are
fixed (`:len`) or flexible (`:grow` = ratatui `Fill` weight); a `:gap` is spacing. Pure data in, rects out — golden-testable.

```beam-lisp
(ns omega.research.tui-layout)

(defn split-axis [total gap items]
  (let [n (count items)
        gaps (* gap (max 0 (- n 1)))
        fixed (reduce + 0 (map (fn [i] (get i :len 0)) items))
        wsum (reduce + 0 (map (fn [i] (get i :grow 0)) items))
        free (max 0 (- total gaps fixed))]
    (loop [is items pos 0 out []]
      (if (empty? is)
        out
        (let [i (first is)
              sz (if (contains? i :len) (get i :len)
                     (if (> wsum 0) (quot (* free (get i :grow 1)) wsum) 0))]
          (recur (rest is) (+ pos sz gap) (conj out [pos sz])))))))

(defn layout [node [x y w h]]
  (let [row? (= :row (get node :dir :col))
        spans (split-axis (if row? w h) (get node :gap 0) (get node :kids []))]
    (mapv (fn [kid [off sz]]
            (if row? [(get kid :id) [(+ x off) y sz h]]
                     [(get kid :id) [x (+ y off) w sz]]))
          (get node :kids []) spans)))

;; header(1) / body(fill) / footer(1) on an 80x24 terminal
(def screen (layout {:dir :col :gap 0
                     :kids [{:id :header :len 1} {:id :body :grow 1} {:id :footer :len 1}]}
                    [0 0 80 24]))
(println (pr-str screen))
(assert (= [:body [0 1 80 22]] (nth screen 1)))

;; body: sidebar(20) | main(3 parts) | aside(1 part), 1-cell gaps
(def body (layout {:dir :row :gap 1
                   :kids [{:id :side :len 20} {:id :main :grow 3} {:id :aside :grow 1}]}
                  [0 1 80 22]))
(println (pr-str body))
(assert (= [:side [0 1 20 22]] (first body)))
```

Observed output: `[[:header [0 0 80 1]] [:body [0 1 80 22]] [:footer [0 23 80 1]]]` and
`[[:side [0 1 20 22]] [:main [21 1 43 22]] [:aside [65 1 14 22]]]`. (Integer division leaves a 1-cell remainder; ratatui's
Cassowary solver distributes remainders differently — a real behavioural difference to decide, Q5.)

**Block 2 — lowering real loom output.** Proves the design tension from `loom-and-grammar.bl.md`: `box` bakes `:gap :3` into a *hashed CSS class*,
so a TUI lowerer must either parse the sheet (shown here: it works, `gap:12px` → 1 cell, `flex-direction:row` → `:row`) or, better,
consume box props before `sx`. The `:on-click` event term survives untouched as data.

```beam-lisp
(ns omega.research.tui-lower
  (:require [loom.box :as b] [loom.ui :as ui] [loom.token :as t]))

;; recover {class -> style} from the CSS sheet loom collected (stop-gap)
(defn parse-sheet [css]
  (reduce (fn [m line]
            (let [parts (String/split line "{")]
              (if (< (count parts) 2) m
                (let [head (first parts)
                      cls (String/slice head 1 (- (count head) 1))
                      body (first (String/split (nth parts 1) "}"))
                      decls (reduce (fn [dm d]
                                      (let [kv (String/split d ":")]
                                        (if (< (count kv) 2) dm
                                          (assoc dm (keyword (first kv)) (join ":" (rest kv))))))
                                    {} (String/split body ";"))]
                  (assoc m cls decls)))))
          {} (String/split css "\n")))

;; px -> cells (INFER: 1 cell ~ 8px)
(defn cells [px] (quot (erlang/binary_to_integer (String/replace px "px" "")) 8))

(defn lower [sheet node]
  (cond
    (string? node) [:text node]
    (and (vector? node) (keyword? (first node)))
    (let [tag (first node)
          attrs (if (map? (second node)) (second node) {})
          kids (if (map? (second node)) (drop 2 node) (rest node))
          st (get sheet (get attrs :class) {})
          lk (fn [k] (lower sheet k))]
      (case tag
        :button [:button {:on-click (get attrs :on-click)} (mapv lk kids)]
        :h1     [:heading 1 (mapv lk kids)]
        :div    [:box {:dir (if (= "row" (get st :flex-direction)) :row :col)
                       :gap (if (get st :gap) (cells (get st :gap)) 0)}
                 (mapv lk kids)]
        [:box {} (mapv lk kids)]))
    :else [:text (str node)]))

(def r (t/with-sheet (fn [] (b/row {:gap :3}
          (ui/heading 1 "Tasks")
          (ui/button {:on-click [:intent :task/new {}]} "New")))))
(def sem (lower (parse-sheet (t/sheet-css)) (:tree r)))
(println (pr-str sem))
(assert (= :row (get (second sem) :dir)))
(assert (= 1 (get (second sem) :gap)))
```

Observed output: `[:box {:dir :row, :gap 1} [[:heading 1 [[:text "Tasks"]]] [:button {:on-click [:intent :task/new {}]} [[:text "New"]]]]]`.
(`bl run` exits 0 for this file; first run compiles loom, ≈10–15 s on this host.)

---

## 9. Proposed API sketch (design — NOT run)

Principle: **same `app` contract as `loom.desktop`, same component namespaces**; only the mount differs. omega code never imports
`wry` or `tui` directly in views.

```clojure
;; omega.ui.* : the shared vocabulary (names/opts identical to loom.ui/parts/box).
;; Option (b) of `loom-and-grammar.bl.md` Q1: components emit a SEMANTIC tree; two lowerings consume it.
(ns omega.ui
  (:require [loom.box :as b] [loom.ui :as ui] [loom.parts :as p]))

;; 1. Mount — mirrors loom.desktop/app (:state :view :on-event :tick :title)
(ns omega.tui
  (:require [omega.tui.nif :as nif]))     ; (defnative "omega_tui" …) — thin

(tui/app
  {:title    "omega"
   :state    {:tasks [] :focus :composer}
   :view     (fn [state] (b/col {:gap :1}
                           (ui/heading 1 "Tasks")
                           (p/table {:columns ["Task" "State"] :rows (:tasks state)})
                           (ui/field {:name :composer :on-keydown.enter [:intent :task/new {}]})))
   :on-event (fn [state ev] …)            ; ev = [:intent …] | [:assign …] | [:navigate …] | [:key …]
   :tick     {:every-ms 100 :event [:tick]}
   :theme    brand                        ; same map as loom.token/install-theme!, cell-quantised
   :mouse    true :alt-screen true})      ; → handle {:driver pid :term resource}

(tui/emit app [:inc])  (tui/stop app)     ; = d/emit, d/stop
(tui/snapshot app)     ; => {:state … :tree <hiccup> :semantic <lowered> :rects [...] :cells <rows-of-strings>}
(tui/available?)       ; = (vm.native/available? "omega_tui")  — absent ⇒ fall back to desktop or `bl repl --terminal`

;; 2. Pipeline inside the driver (all pure except the last step)
;;    view → hiccup → lower → layout(size) → widgets → nif/draw
(defn frame [view state {:keys [w h]} theme]
  (-> (view state)
      (lower theme)            ; hiccup/semantic → [:box|:text|:button …]   (pure)
      (layout [0 0 w h])       ; → [{:rect :node :path}]                    (pure, golden-testable)
      (->widgets)))            ; → [[:paragraph rect {…}] [:block rect {…}] …] flat, string-keyed-able

;; 3. NIF surface (≈ 6 fns; "bl decides, Rust writes bytes")
(defnative "omega_tui"
  (term-open 3)      ; (receiver-pid {:alt-screen :mouse :test [w h]}) -> handle   [DirtyCpu]
  (term-draw 2)      ; (handle widgets) -> :ok    ; decode -> ratatui Buffer -> flush (diff in Rust)
  (term-size 1)      ; (handle) -> [w h]
  (term-cells 1)     ; (handle) -> rows-of-strings (test backend / snapshot)
  (term-inject 2)    ; (handle event) -> :ok      ; headless tests, = ex_ratatui inject_event
  (term-close 1))    ; (handle) -> :ok   (also restore tty on resource drop)
;; input: crossterm thread --OwnedEnv--> receiver pid as [:tui-event {:key "a" :mods [...]}]
;;        decoded to loom-style terms by omega.tui/events using the hit-test + focus ring.

;; 4. Hit-test + focus (pure, beam-lisp)
;;    (hit rects x y) → node-path → (get-in tree path :on-click)
;;    (focus-order tree) → [path …]; Tab cycles; Enter ⇒ :on-click; chars ⇒ [:on-input-term value]

;; 5. Escape hatch (keeps the "no ceiling" promise): raw ratatui style/constraint merged last
(b/box {:dir :row :tui {:constraint [:length 12] :style {:fg [:rgb 255 100 0] :mods [:bold]}}} …)
```

Where the semantic tree lives (recommended, cf. `loom-and-grammar.bl.md` Q1): `omega.ui` functions return `[:box {:dir :row :gap :3 …} …]`-style
semantic nodes (tokens unresolved) and **two** thin lowerings exist: `omega.web/lower` (adds `sx` classes, i.e. today's loom) and
`omega.tui/lower` (tokens → cells). If the user prefers to keep loom untouched, Block 2's sheet-parsing path is the fallback
(works today but couples to CSS property names).

---

## 10. Interactions and observability

How a human/agent develops and drives the TUI:

- **Everything before the NIF is pure data.** `(tui/snapshot app)` → state, hiccup, semantic tree, rects, and `:cells` (rows of strings).
  An agent can read the *screen as text* without a terminal. Block 1/2 style pure fns are testable with `bl test` and golden files.
- **Headless backend:** `term-open` with `:test [w h]` (precedent: ex_ratatui `test_mode: {w,h}` + `Runtime.inject_event`; its Testing/Debugging
  guides were listed but I did not read them in full) ⇒ CI-friendly: inject `[:key "tab"]`, assert on `:cells`.
- **Driver introspection:** make the driver a `proc/server` (not a bare `spawn`+`receive` as `loom.desktop` is) so `sys`-style state inspection,
  supervision (`proc/super`), tracing and `bl`'s daemon/REPL attach all work; ex_ratatui's `Runtime.snapshot/enable_trace` is the model
  (state transitions, render_count, subscriptions).
- **Remote:** ex_ratatui serves the same app over SSH or Erlang distribution (client holds the terminal NIF, server holds state).
  For omega this means "attach a TUI to a running task node" — plausible with pids + `:ssh`; INFER, not designed here.
- **Recording:** since frames are values, store `(state, event)` log → replay (the grammar's time-travel claim) and asciinema-style frame dumps.
- **Live reload:** `bl`'s hot-reload (`priv/std/reload.bl`, not read) could swap `view` without dropping `state` since state lives in the driver (INFER).
- **Dev loop for humans:** `bl run examples/tui/hello.bl` in a real terminal; `(tui/emit app …)` from a second REPL; `bl doctor` to see native backends.

---

## 11. What omega should take / adapt / drop (summary)

- **Take:** ex_ratatui's *architecture* (NIF-encoded widget list; terminal as `ResourceArc`; headless backend; reducer runtime with commands/subscriptions;
  focus ring; `Popup`/`Clear`; `inject_event`/`snapshot`; transports idea). Take ratatui itself for cell buffer + diff + Unicode width + styling.
- **Take from loom:** `app` contract, component names/opts, event vocabulary, tokens (as data), `loom.transform` (works on any tree).
- **Adapt:** layout solved in beam-lisp (loom props are flex-like), tokens quantised to cells, state for stateful widgets in BEAM (not NIF) unless perf says otherwise,
  `disclosure`/tabs selection to explicit state, `hover/transition/shadow/blur` reduced to nothing or tick-driven emulation.
- **Drop:** CSS-specific machinery in the TUI path (`sx`, sheet, `keyframes`, `:style` strings), `d/bar` layer-shell, anything requiring pixels. Don't re-implement Ratatouille/termbox.
- **Don't build from scratch what exists:** unless the user wants a *dependency-free* stack (Q1), reuse ratatui (Rust) and either bind it ourselves (small NIF) or consume ex_ratatui.

---

## 12. Open questions for the user

1. **Bind ratatui ourselves, or reuse ex_ratatui?** (a) Own thin crate `omega_tui` (~6 NIFs, flat widget list, `defnative`): minimal, fits `vm.native`, no Elixir dep,
   but we maintain widget decoding + terminal restore + input thread. (b) Depend on `ex_ratatui` (Hex, precompiled NIFs, 25 widgets, SSH/dist transports, images, tests)
   from beam-lisp (needs Elixir-dep interop; beam-lisp is on the BEAM so calling `ExRatatui.draw/2` is possible but the dep story — `bl deps` / Mix-free fetch, FUP-050 — must be checked, and widgets are Elixir structs so we'd build maps/structs from bl). (c) Pure beam-lisp renderer + a tiny raw-tty NIF (no ratatui): max control and testability, but re-implement widgets/Unicode width. Tradeoff: effort vs control vs dependency weight.
2. **Where does the semantic tree come from?** (`loom-and-grammar.bl.md` Q1) — parse loom's CSS sheet (works today, brittle), change `loom.box`/`ui` to emit a semantic form, or add an `omega.ui` façade. This gates everything.
3. **Cell quantisation of tokens** (`:space :4` = 16px ⇒ 2 cells? 1?). Fixed ratio (1 cell = 8×16px) or a separate terminal scale in the theme? Aesthetics from impeccable.style must be re-expressed in terminal terms: 24-bit colour always, or degrade to 256/16?
4. **Stateful widgets:** text input/textarea state in BEAM (inspectable, replayable, re-sent each frame; we must implement cursor/IME/undo/kill-ring — `pi/packages/tui` already has `editor-component.ts`, `kill-ring.ts`, `undo-stack.ts` to crib from) or in the NIF like ex_ratatui (less code, opaque state, the "recreate in render" trap).
5. **Layout fidelity:** own flexbox-ish solver in bl (Block 1; deterministic, matches loom/web) vs ratatui `Layout` (Cassowary; documented non-determinism under conflicts) vs Taffy via Rust (real CSS flex/grid, PoC only per ratatui docs). Do we need web/TUI layouts to *agree*?
6. **Full-screen alt-screen vs inline/scrollback mode.** Coding agents (pi's TUI has both "main screen" and "alt screen" renderers per `packages/tui/src/tui-main-screen.ts` / `tui-alt-screen.ts` — file names observed, content not read) often want native scrollback for transcripts. ratatui supports inline viewports (`Viewport`, mentioned in the rendering doc); Owl does line-oriented live blocks. Which modes for omega?
7. **Input model:** keyboard-first with focus ring + optional mouse; do we support mouse hover (needs any-event mouse mode) or only click/scroll? Keybinding scheme (pi has `keybindings.ts`) — reuse?
8. **Images and rich media:** accept terminal-dependent image protocols (Kitty/Sixel/iTerm2/halfblocks via ex_ratatui/ratatui-image) or a text-only contract so views are portable?
9. **Distribution:** the drop bundler "does not compile NIFs (v1)". Ship a prebuilt `omega_tui.so` per target, require cargo at first run (`build-all!`), or use precompiled artifacts as ex_ratatui does?
10. **One driver for both back-ends?** Unify `loom.desktop`'s driver and the TUI driver into one `omega.app` (back-end = pluggable `{:open :draw :events}`), so a task can be viewed in both at once (two viewers of one state — the `live` multi-viewer property). Do we want that, and does it imply the driver becomes a `proc/server` owned by the *task*, with front-ends as subscribers (stigmergy-friendly)?
11. **Remote/SSH attach** (ex_ratatui/Garnish precedent): is "attach a TUI to a task running elsewhere" in scope for omega v1?
12. **Accessibility in TUI:** keep the loom a11y contract as a semantic dump (roles/labels) for agents and screen-reader users, even if there is no ARIA — yes/no, and in which format?
