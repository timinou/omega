# PELAGIC performance instrument

PELAGIC now has a continuous performance mode, quantized audio/visual revisions,
playable scene transitions, undo and snapshots, local audio references, and live
recording that writes chunks to local storage. It remains one independent bl-ed
package. The [implementation plan](../../!tasks/plans/PLAN-008-pelagic-playable-av-instrument.org)
sets the scope and provisional performance gates.

Build and open the [existing studio](pelagic.bl.md#run-it), then press **PERFORM**
(or `g P`). **Play the descent** still plays the original finite composition.
Continuous mode retains its opening and then cycles the developing middle acts;
it does not stop at bar 64. Code, gestures and scenes can change its direction.

## Three implemented workstreams

1. **Playable visuals.** Four named scenes, a second overlay, three transitions
   (crossfade, dissolve, iris), beat/bar/phrase launches, controllable intensity,
   symmetry, palette and feedback. Each layer uses its own scene value; the
   compositor owns one WebGL context and three fixed render targets. Stem
   activity and measured audio features drive geometry rather than only elapsed
   time. Imported decks and the master output provide measured level and bands.
2. **Safe performance changes.** Beam Lisp owns current, pending and historical
   values. Source evaluation stages requests in a fresh namespace, validates
   audio graphs and prepares GLSL in the actual rendering context. A failed
   candidate leaves the active revision intact. Accepted changes show QUEUED,
   ARMED, then ACTIVE at a musical boundary. Undo/redo retain 32 revisions;
   sixteen named snapshots retain patterns, configuration, scene definitions,
   visual controls, variation seed and audio asset hashes.
3. **Sustained operation and proof.** Bounded voices, intent history, shader
   programs, namespaces, event logs and recording backlog; pause/resume, panic,
   GPU loss recovery, session files, local audio deduplication, recording
   recovery and diagnostics. The rehearsal runner distinguishes deterministic
   stress actions from an agent-operated live set and evaluates the original
   acceptance gates without silently relaxing them.

## Code in the real source pane

The existing self-hosted Beam Lisp compiler evaluates these forms. `o` is the
studio's Overtone alias; `av` supplies performance requests. C-Enter evaluates
the document. The commands below can be separate evaluations.

```clojure
(o/definst glass [freq 440 amp 0.055 dur 1.8]
  (* amp (o/env-gen (o/perc 0.008 dur))
     (o/mix [(o/sin-osc freq)
             (* 0.18 (o/sin-osc (* freq 2.01)))])))
(def metro (o/metronome 122))
(av/commit
  {:quantize :bar
   :edits [(av/configure {:space 0.52 :echo 0.34})
           (av/pattern :melody 8
             (o/play
               (o/at (metro 0) (glass :freq (o/midi->hz 74)))
               (o/at (metro 1.5) (glass :freq (o/midi->hz 69)))
               (o/at (metro 4) (glass :freq (o/midi->hz 77)))
               (o/at (metro 6.5) (glass :freq (o/midi->hz 76)))))
           (av/launch :cathedral {:transition :iris :beats 8})
           (av/visual {:symmetry 8 :feedback 0.12})]})
```

```clojure
(av/snapshot :home)
(av/gesture :break)
(av/gesture :build)
(av/gesture :drop)
(av/undo)
(av/redo)
(av/recall :home)
(av/pattern-stop :melody)
(av/cancel)
```

`pattern-stop` installs an empty lane override: it suppresses the original score
for that lane too. Density and transposition apply deterministically; a snapshot
retains the seed. A pending edit coalesces with subsequent edits until superseded
or cancelled. Already audible sound cannot be undone; revision changes preserve
existing tails, while panic stops them.

```clojure
(av/commit {:quantize :phrase
            :edits [(av/variation {:density 0.8 :transpose 12 :seed 93})
                    (av/layer :afterglow 0.25)
                    (av/launch :current {:transition :dissolve :beats 16})]})
```

Scenes can contain inline GLSL and explicit signal mappings. This small example
shows the schema; the built-in scenes use the richer original
[pelagic.glsl](shaders/pelagic.glsl).

```clojure
(av/session
  (av/scene :pulse
    {:shader "uniform float iZoom;
              void mainImage(out vec4 c,in vec2 p){
                vec2 uv=(p-.5*iResolution.xy)/iResolution.y;
                float r=length(uv)*(1.-iZoom);
                float ring=.003/(abs(r-.25-iAudioBass*.12)+.003);
                c=vec4(vec3(.1,.9,.8)*ring,1.);
              }"
     :mappings {:zoom {:signal [:stem :bass :level] :amount 0.2}}})
  (av/launch :pulse {:transition :crossfade :beats 4}))
```

Mapping scopes are `:stem`, `:deck` and `:master`; features are `:level`, `:onset`,
`:pitch`, `:bass`, `:mid` and `:high`. Musical stems expose level/onset/pitch;
decks/master expose measured level/onset/bands. A feature absent from its scope
contributes zero. Onset is an amplitude attack estimate, not beat detection.
Targets are zoom, accent, intensity, symmetry, feedback and palette. Controls are
clamped. Muting a stem removes its onset contribution. `iChannel0` remains the
FFT/wave texture; `iChannel1` is that layer's preceding frame.

## Sessions and recording

Import audio with either deck's **AUDIO** control. Set its source BPM, cue and
beat loop; use the equal-power crossfade and three-band EQ. Session JSON stores
content hashes, BPM, cue and loop settings. Audio files stay in this browser's
IndexedDB, deduplicated by SHA-256. Moving JSON to another device does not move
its audio: a missing asset is reported and the current track is retained.
Session and snapshot recall decode available assets before queuing the change;
a superseded asynchronous load cannot replace a newer request.

**REC** captures the actual canvas and mixed output, including imported audio
and live patterns. Two-second MediaRecorder chunks are stored incrementally;
a 16 MB pending-write cap stops capture on storage failure. Small takes download
automatically. Larger takes stay local for explicit recovery/export, and the
proof runner exports each stored chunk in order without assembling the whole
recording in JavaScript memory. Explicit browser download may assemble a Blob;
recording itself does not retain the full take in RAM. **RECOVER LAST TAKE** can
recover the latest completed take in the same browser profile. Storage quota
errors remain visible; recovery cannot promise chunks that were never written.
**SCORE WAV** exports the original composition with current mixer settings,
not a live take.

**PAUSE/RESUME** preserve beat phase and elapsed visual time. **PANIC** cancels
pending changes and stops voices. GPU context loss pauses transport and capture;
restoration rebuilds graphics resources and requires an explicit resume. Removing
the package closes its AudioContext, disposes GPU resources, removes controller
listeners and returns the existing editor layout/source without a private page.

## Measurement and limits

The stage targets 30 fps. Recording uses VP8 when available; scene geometry is
rendered at 960×540 and composited into a 1280×720 capture. Diagnostics report
both sizes. Inactive GLSL scene branches and duplicate layer draws
are skipped. Revision graphics submit before status-display updates, so editor
painting does not delay the first changed visual frame. Diagnostics count missed
scheduler steps, whole-run frame interval distributions, revision-to-first-draw
submission delay, voice/node/program counts, history and namespace sizes, storage
backlog and post-GC heap checkpoints. Startup and deliberate GC pauses remain
in the reported measurements.

An AudioWorklet receives silent sample-onset probes scheduled by the same
AudioContext as kicks. It measures the browser sample timeline. Neither that
probe nor the graphics submission measurement measures physical speaker/display
latency or proves an absence of device underruns. Physical MIDI hardware and
mobile sustained-performance testing are outside this proof; the MIDI adapter
is exercised with synthetic messages and retains keyboard/code alternatives.

This is still an Overtone-shaped browser subset, not Overtone running on a JVM
or SuperCollider. Beam Lisp compiles to JavaScript; native Web Audio renders
synthesis, and WebGL compiles GLSL on the GPU. Vendored upstream trees remain
reference material. See [compatibility and provenance](research.bl.md) for the
implemented operators and exclusions. There is no pitch-preserving time stretch,
headphone prelisten, arbitrary UGen parity or portable embedded sample archive.

## Reproduce the proof

```sh
spikes/pelagic/build.sh
node --test spikes/pelagic/test/*.test.mjs
python spikes/pelagic/test/performance-browser.py
python spikes/pelagic/test/run-live.py --kind soak --seconds 1200 --port 8813
python spikes/pelagic/test/run-live.py --kind set --seconds 1200 --port 8814
```

Use an offline editor on 8812; never use the running world on 8790. The set runner
has no musical action script: its local HTTP control endpoint accepts live edits,
requests, imports and screenshots. The soak runner's actions are deterministic.
Each writes source commit, browser/GPU facts, timestamped actions, session values,
checkpoints, gates and cleanup evidence. A failed gate produces `needs-review`
and a nonzero exit; it must be reported as such.
