# PELAGIC research: Overtone and Shadertone on Beam Lisp

2026-10-07. This investigation resulted in the independent `pelagic` package,
not a proposed architecture. The original upstream repositories are retained
under `vendor/` with their MIT notices and exact commits in
[`UPSTREAM.json`](vendor/UPSTREAM.json). They are reference/source dependencies;
the browser executes the compatibility port in `pelagic/*.bl`.

## The upstream contracts that matter

Overtone combines synthesis, musical abstractions and scheduling through
SuperCollider. Its [README](https://github.com/overtone/overtone) establishes that
architecture. Four source areas were inspected in detail:

- [`studio/inst.clj`](vendor/overtone/src/overtone/studio/inst.clj): `definst`
  accepts name/default pairs and builds a player supporting positional arguments
  followed by keyword overrides. An instrument's signal gets an output wrapper.
- [`sc/synth.clj`](vendor/overtone/src/overtone/sc/synth.clj): synth parameter
  construction and UGen graph compilation separate a reusable graph from an
  instantiated node. This is the key idea to preserve across runtimes.
- [`music/pitch.clj`](vendor/overtone/src/overtone/music/pitch.clj): named notes,
  scale/chord intervals and MIDI-frequency conversion. MIDI 69 is A4 / 440 Hz;
  C4 is MIDI 60. Chord vectors retain their extended intervals.
- [`music/rhythm.clj`](vendor/overtone/src/overtone/music/rhythm.clj) and
  [`sc/server.clj`](vendor/overtone/src/overtone/sc/server.clj): a metronome maps
  beat numbers to millisecond timestamps; `at` groups already evaluated server
  messages under a timestamp. It does not defer arbitrary language evaluation.

The upstream source includes JVM imports, mutable refs, thread-local dynamic
bindings, OSC networking and SuperCollider-specific UGens. Copying `.clj` files
into a browser build cannot make those facilities exist. Vendoring preserves the
reference; translating the graph and message values preserves a useful contract.

Shadertone's [README](https://github.com/overtone/shadertone) describes the
visual contract. The inspected implementation in
[`tone.clj`](vendor/shadertone/src/shadertone/tone.clj) captures SuperCollider audio
into a two-row texture: spectrum then waveform. Its
[`shader.clj`](vendor/shadertone/src/shadertone/shader.clj) creates LWJGL/OpenGL
programs, binds uniforms and textures, and replaces programs after source changes.
The browser backend keeps those conventions while replacing LWJGL and the watcher.
The supplied fragment is original; no third-party Shadertoy artwork is copied.

## Beam Lisp investigation

The sibling Beam Lisp checkout's
`docs/self/the-language-compiles-itself.bl.md`, `priv/lib/js/eval.bl`,
`priv/lib/js/build.bl`, and the editor's compiled `repl.mjs` / `boot.mjs` were
inspected. The browser already contains the real reader, compiler, emitter and
macro evaluator. `readForms` + `evalForm` are sufficient. No private Lisp reader,
JavaScript expression evaluator, or new language runtime is required.

Build-time macro helper functions must be statically reachable top-level `defn`
values. The pinned builder discovers top-level ordinary `def` forms, so static
score definitions use `(def tide (o/instrument tide …))`, whose macro expands to
the graph/player value. At runtime the same helper implements ordinary
`(o/definst glass [freq 440 amp 0.1] …)` through the self-hosted compiler.

Two concrete compatibility boundaries emerged during implementation:

1. Runtime floats are tagged `Flt` values. They need explicit conversion at the
   host edge; string interpolation of a fractional layout weight likewise does
   not yield a CSS number. The package uses integer fractional weights, and the
   generic JSON bridge handles tagged floats.
2. Evaluating a namespace declaration in this pinned browser image reaches an
   unavailable `Elixir.String/to_atom` leaf. Installing a namespace through the
   existing VM's `Env.in_ns` and evaluating its body avoids that host dependency.
   A quoted-symbol-keyed map also exposed a comparator issue in dynamic compile;
   the graph macro's operator dispatch uses ordinary `cond` comparisons instead.
   These are adapter choices, not changes to Beam Lisp or its pin.

The package functions and score are pure BL. Only `:package-host` effects and
`:host` view models cross into browser IO. No music vocabulary enters `ed.*`.
The generic optional resource adapter is documented in `vendor/bl-ed/VENDOR.md`.

## Backend choice and timing

The [Web Audio specification](https://www.w3.org/TR/webaudio/) provides audio
routing, parameter automation, scheduled sources, analysis and offline rendering.
Those facilities allow the graph interpreter to use native DSP nodes instead of
running sample synthesis on the editor's JavaScript thread. The
[WebGL specification](https://registry.khronos.org/webgl/specs/latest/1.0/) provides
shader program compilation/linking and textures for the visual backend.

The audio context's clock drives the score. A 25 ms timer fills a 160 ms
lookahead; it never determines the onset directly. Every onset is scheduled on an
AudioNode. Swing offsets odd sixteenths. If the browser misses a large deadline,
the scheduler skips stale steps instead of emitting a burst. This is a prototype
scheduler: browser throttling or long main-thread work can still omit events.
A worker / AudioWorklet clock would be the next improvement for unattended shows.

At a bar boundary, a validated live pattern replaces one stem. Full-buffer
language evaluation uses a fresh staging namespace and creates pure plans.
Top-level instrument calls, bundles and controls are collected, validated, then
committed; errors preserve the current playback. Shader compilation uses a
candidate program before replacing the last good one. A temporary validation
context verifies all nested shader requests before a session commits.

The offline exporter initially constructed the entire concert graph at once.
That made every quantum traverse thousands of future silent nodes. Export now
suspends ahead of eight-second windows, fills the next horizon, and resumes DSP.
The live path and offline path use the same `score/step` and UGen interpreter.
Noise and reverb impulses are seeded; export is repeatable within a browser/DSP
implementation, with small backend-dependent floating-point differences possible.

## Compatibility boundary

| Area | Implemented behavior | Deliberate boundary |
|---|---|---|
| `definst`, `defsynth` | Name/default pairs; positional + keyword arguments; graph arithmetic; callable player values | No optional docstring syntax, metadata-rich controls, SC groups, buses or arbitrary multichannel expansion |
| UGens | Sine, saw, square pulse, triangle, white/pink noise, arithmetic/mix, low/high/resonant filters, pan, linear/exponential ramps, perc/ADSR envelopes | Web Audio DSP is not numerically identical to SC; square pulse has fixed duty cycle; no complete UGen catalog |
| Pitch | Named notes, MIDI conversion, four scale families, eight chord families | Note spelling currently uses a single nonnegative octave digit; integer MIDI pitches; explicit errors for unsupported quality |
| Time | Relative millisecond metronome; `at` bundles; `play`; quantized repeating patterns | Zero-argument metronome starts at beat zero; no wall-clock/global mutable metronome, `apply-at`, OSC or external clock sync |
| Nodes | Graph descriptors; host resolves played descriptors for `ctl` / `kill` | Controls support exposed amp/freq/cutoff/pan, not arbitrary graph rebuilding; use `play` to retain multiple calls nested in one expression |
| Shadertone | `start`, `stop`, user uniforms, `main` / `mainImage`, resolution/time/mouse/date, spectrum/waveform, previous-frame texture | Inline shader source; no filesystem watcher, image/cube texture loader or arbitrary atom watchers; only audio and feedback channels are populated |
| DJ decks | Local file import, manual source BPM, synced playback rate, cue/set cue, loops, jog, volume, three-band EQ, equal-power crossfade | Rate sync changes pitch; no automatic beat detection, key lock, scratch emulator, headphone hardware routing or playlist management |
| Capture | Live canvas + audio WebM; original-score stereo WAV; deterministic audiovisual film proof | WAV exports the original score with mixer settings, excluding imported files and custom live patterns; REC captures the actual live session |

This is an executable Overtone-shaped subset and Shadertone browser port,
with both upstream trees vendored. It does not execute the Clojure/JVM projects
or claim full Overtone, SuperCollider, Shadertone or commercial DJ parity.
A native SC backend could consume the same graph/message values: the next slice
would encode SynthDefs and OSC messages and map unsupported UGens explicitly.
That backend has not been implemented here.

## The original musical and visual decisions

The first version below is retained as research history. The implemented score
and shader were subsequently reworked into [CURRENT CLUB](club.bl.md):
122 BPM, four-on-the-floor rhythm, breakdowns and four distinct VJ scenes driven
by measured bass/mid/treble and short-window amplitude attacks.

### First version

The original score is 64 bars at 108 BPM: 142.22 seconds plus a ten-second tail.
Four sixteen-bar movements share a D-minor-centered sequence of extended chords:
Dm9 → B♭maj9 → Fmaj9 → Csus2. Pads last across the chord changes; seeded pink
noise and a stereo impulse response give depth. Bell partials are slightly
inharmonic. The pulse enters late, then develops syncopated bass, offbeat hats
and a restrained backbeat. Kick onsets duck the atmospheric deck. The last four
bars remove the rhythm, leaving the harmonic tail.

The shader is a per-pixel sculpture: folded toroidal membranes and orbiting beads
around an iridescent, moving core. Cool cyan deepens into gold, then violet.
Measured audio contributes volume, diffraction and a waveform engraving, while
beat energy supplies a restrained pulse. The film derives each frame's FFT and
waveform from the rendered soundtrack, keeping picture and score aligned even
when software WebGL cannot maintain realtime frame rates.

Measured results and reproducible proof are in [`pelagic.bl.md`](pelagic.bl.md).
