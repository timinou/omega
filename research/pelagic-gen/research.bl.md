# Two prototypes for a generative music Lisp machine

2026-10-21. Prototype 1 joins Pelagic's performance lifecycle to structural
attention and generation. Prototype 2 separately probes the stronger analysis
path. The [instrument walkthrough](../../spikes/pelagic/gen.bl.md) describes the
running UI; the [plan](../../!tasks/plans/PLAN-023-pelagic-generative-instrument.bl.org)
records the acceptance work and remaining integration.

Current experience priority: [ordinary editing and local generation](experience.bl.org),
including mixed selections and inline/split component presentations. The richer
evidence experience is retained as a [deferred follow-up](evidence-follow-up.bl.org).
The integration outline below is research context, not the next UI priority.

## Evidence read before implementation

The Beam Lisp REPL checkout at `/home/user/code/undefine/beam-lisp--repl` contains:

- `priv/lib/gen/code.bl`: a working text → extraction → static arity → compile/
  intern → callable-function loop, with three attempts. Its `candidate` already
  interns in shared `gen.generated`; it is not a side-effect-free proposal API.
  Its memo cache is intentionally absent. The old example's “memo hit” comment
  does not describe current implementation behavior.
- `!tasks/plans/PLAN-129-gen-code-proof-constrained-llm-code-gene.org`: the larger
  spec/context/type/codebase/semantic-neighbor/proof/cache design. Those tiers
  must not be advertised as already integrated into Gen's spike.
- `research/workspace-spike/play/gen.bl`, `gen_test.bl`, `README.md`: owned
  conversations, visible repair, version addresses, persistence, cancellation
  epochs, and separate made/saved/live decisions. Loading a ledger never calls
  the model. The actual generator uses structural change constructors.
- `docs/design/form-first-interaction.md`: selection first; exact half-open
  spans; specified tree motions and boundary behavior; explicit evaluation;
  browser key conflicts; revision-owned asynchronous results. The document
  explicitly distinguishes the design from older highlighter-only prototypes.
- `docs/design/workspace-editor.md`: source-first frame, contextual inspector,
  focused activity/history, and independent source/runtime lifecycle decisions.

Omega already has the structural reader/motions in `vendor/bl-ed/ed/forms.bl`
and `ed/commands.bl`. Reusing them avoids introducing another parser/navigation
implementation. Pelagic's `audition.bl`, `performance.bl`, browser evaluator and
revision scheduler supply the execution boundary. The new package code supplies
the missing target → request → candidate connection.

## Prototype 1: complete interaction, narrow language

The generated artifact is real Beam Lisp, not a fabricated list of UI changes.
Its first profile is intentionally restricted to a finite melody-returning
function. Arithmetic is interpreted over closed syntax for validation; a
second check uses the actual browser compiler and audio graph validator.
No callback to a model occurs in the music scheduler or generated function.

Source selection and runtime selection share a source span. A request freezes
the full unsaved draft, selected range, exact selected text, complete melody
definition, prompt and identity. A replacement is spliced only into that range.
Changing the draft invalidates the proposal. Moving attention while a request
runs does not retarget its result. Requests made from a function argument list
or symbol may fail the narrow profile visibly; they cannot widen to a hidden
whole-document rewrite. This is preferable to pretending every selected form
has the same useful generation contract.

Passing validation produces a candidate. It does not save or change active
audio. Audition checks the current performance basis; commit uses that basis
again. Queued/active receipts and source draft state remain separate. Current
versions are session values; durable conversation/accepted-source history is
an explicit next step, not an implication of the version tabs.

## Prototype 2: executable stronger-check probe

Run this separately, without a model or editor world:

```sh
bin/bl --cold run -p research research/pelagic-gen/run.bl
```

`prototype2.bl` accepts source for a scalar `pitch [root offset]` helper. It
indexes that source into a fresh `codebase` connection, reports unknown callees
and arity mismatches, runs `system.typecheck/check-source`, and asks the real
`system.smt` ANF translator and `oracle`/Z3 to find an integer input producing
a pitch outside 36–96. A clamped helper should produce `unsat`; an unclamped
helper should produce `sat` and an actual root/offset witness. Unsupported
translation, solver unknown and transport error remain separate outcomes.
The probe does not install a generated helper into any live image.

Executed result: the clamped helper passed the codebase and type-diagnostic
checks; the solver answered `unsat`. The unclamped helper passed the same
structural checks but produced `sat` with `root = 97, offset = 0`. The retained
[raw run](proof/prototype2.log) includes both verdict records and the actual
witness. This demonstrates why an empty diagnostics list cannot replace the
requested semantic property.

An additional coverage probe found that this pinned `system.typecheck` pass
does not warn for ordinary `(+ "not-a-note" 1)`: it is an additive checker for
resolved host operations. The cross-function `erlang/+` case is tested separately.
Prototype 2 must combine its evidence with the local `typed` checker and explicit
signature checks before treating that tier as a general generation gate.

This is an experiment with the original plan's modules, not a complete Gen
implementation or a proof about audiovisual scheduling. The collection-valued
melody is outside the scalar translator's general proof vocabulary. Beginning
with a scalar helper establishes a useful supported fragment and a real repair
witness before widening the UI's claims. Type diagnostics are warnings from the
upstream checker; an empty list is not complete signature conformance.

## How prototype 2 would join the instrument

1. **Normalize a captured request into a spec.** Include target role, resolved
   symbol, argument/return contracts, effects, selected source basis, required
   dependencies, musical assumptions and requested properties. Spec derivation
   itself is a proposal: retain the operator's original wording and display
   assumptions as inspectable constraints.
2. **Build context from the actual runtime.** Query codebase/system facts from
   the pinned BEAM environment and Pelagic browser exports. Resolve aliases,
   macros, signatures and supported host capabilities. A function existing on
   the BEAM does not establish that it is available in the browser. Attach the
   compiler and capability identities to each context snapshot.
3. **Run an ordered battery.** Reader and target/shape; arity and resolved-call
   facts; explicit signature conformance and type diagnostics; effects/purity;
   actual browser compilation; musical graph/resource checks; supported scalar
   properties; optional semantic-neighbor suggestions. A duplicate suggestion
   should be a warning, not an automatic replacement. Stop cheap failures early.
4. **Return structured verdicts.** Each check names the exact source digest,
   assumptions, status, cost and evidence. `passed`, `failed`, `unsupported`,
   `unknown`, `timeout` and `error` are distinct. The candidate inspector may
   use green marks only for completed named checks; unrun checks are neutral.
5. **Repair with witnesses.** Return undefined symbols, bad arities, compiler
   diagnostics and solver inputs as concrete repair context. Preserve the
   rejected source and results. Bound attempts, wall time and output size;
   cancellation epochs prevent late results from becoming current candidates.
6. **Keep installation separate.** Validate in request-owned staging contexts;
   do not use shared `gen.generated` as the candidate namespace. New reusable
   helpers need dependency edits reviewed alongside the selected replacement.
   Save remains a basis-guarded editor write; Make Live remains a Pelagic action.
7. **Persist before caching.** Store request, spec, source, verdicts, versions
   and decisions as data under one owner. A cache key includes normalized spec,
   captured dependencies, compiler/browser capability identities, battery
   version and model policy. Cache hits rerun the cheap current checks. Never
   call a model from build-time initialization or replaying accepted source.

UI placement remains the same: phrase marks, source outline, candidate lane and
two musical actions. Richer evidence opens from the candidate's check strip in
a contextual inspector. Scalar counterexamples become selectable values that
can populate a small test/evaluation action. This extends the same object and
command vocabulary used by the human, rather than creating an agent-only UI.

## Limits and questions for the next discussion

- Should whole-instrument transformations use a second generation profile, or
  require an explicit dependency proposal? They cannot be smuggled through a
  melody-only request.
- A generated function may be correct for fixed demo inputs but unsafe across
  an exposed parameter's range. Prototype 2 needs parameter-domain assumptions
  and proofs or explicit bounded testing over those domains.
- Pelagic's existing long-run performance report retains open timing gates.
  Solver correctness cannot close those gates. Analysis must run outside audio
  work, and integrated stress/rehearsal evidence is still required.
- Universal DOM presentation and typed object acceptance remain later generic
  editor work. This first package proves concrete melody/event presentations
  without claiming arbitrary canvas pixels already have source identity.
